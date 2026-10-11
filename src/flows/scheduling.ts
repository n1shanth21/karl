// Meetup scheduling by OVERLAP: after a deal, both people say when they're free, Karl proposes a shared slot to BOTH
// and locks it (status meetup_set) only when both agree to the SAME slot. State lives in the events table ("sched"),
// so a restart mid-scheduling loses nothing. Owner: Nishanth.

import { db } from "../db";
import type { Ref } from "../spectrum/refs";
import { sendTo } from "../spectrum/send";
import type { User } from "../types";
import { describeWindows, overlapSlots, parseAvailability, type Slot, type Window } from "./availability";
import { loadMatch, type Ctx } from "./match";
import { describeTime, meetupTimeProblem } from "./meetup";

export const SCHEDULING_HOLD_MS = 12 * 3_600_000; // the hold must outlast an overnight "when are you free?"
const ASK = "when are you free to meet in the next couple days? (like 'tmr after 2' or 'sat 11-3')";
const NO_MATCH = "i can't find that one. text 'my stuff' to see what's active";
const HOUR = 3_600_000;

type Side = "buyer" | "seller";
type Says = { buyer: string; seller: string };
type Sched = {
  buyerWindows?: Window[];
  sellerWindows?: Window[];
  spotPrefs: string[];
  proposed: Slot[];
  idx: number;
  votes: { buyer?: boolean; seller?: boolean };
  rejected: string[]; // slots somebody said no to ("<iso>|<spot>")
};
type WireWin = { start: string; end: string };
type Wire = Omit<Sched, "buyerWindows" | "sellerWindows" | "proposed"> & { buyerWindows?: WireWin[]; sellerWindows?: WireWin[]; proposed: { start: string; spot: string }[] };

const fresh = (): Sched => ({ spotPrefs: [], proposed: [], idx: 0, votes: {}, rejected: [] });
const dates = (list?: WireWin[]) => list?.map((w) => ({ start: new Date(w.start), end: new Date(w.end) }));
const key = (slot: Slot) => `${slot.start.toISOString()}|${slot.spot}`;

async function loadState(matchId: string): Promise<Sched> {
  const [row] = await db.findEvents("sched", { payload: { matchId }, limit: 1 });
  const wire = row?.payload.state as Wire | undefined;
  if (!wire) return fresh();
  return { ...fresh(), ...wire, buyerWindows: dates(wire.buyerWindows), sellerWindows: dates(wire.sellerWindows), proposed: wire.proposed.map((p) => ({ start: new Date(p.start), spot: p.spot })) };
}
async function saveState(matchId: string, state: Sched): Promise<void> {
  await db.logEvent("sched", { payload: { matchId, state: JSON.parse(JSON.stringify(state)) } });
  const m = await db.getMatch(matchId); // scheduling activity keeps the hold alive, so a deal isn't expired mid-conversation
  if (m?.status === "accepted") await db.updateMatch(matchId, { holdExpiresAt: new Date(Math.max(m.holdExpiresAt?.getTime() ?? 0, Date.now() + SCHEDULING_HOLD_MS)) });
}

// Two texts about the same match at once (both people answering together) must not trample each other's state.
const chains = new Map<string, Promise<unknown>>();
function exclusive<T>(matchId: string, work: () => Promise<T>): Promise<T> {
  const run = (chains.get(matchId) ?? Promise.resolve()).catch(() => {}).then(work);
  chains.set(matchId, run);
  return run;
}

// A reply that is itself a question needs its Ref (so a tapback or a typed "no" finds it); the inbound pipeline attaches it.
const followUps = new Map<string, Ref>();
export function takeFollowUp(userId: string): Ref | undefined {
  const ref = followUps.get(userId);
  followUps.delete(userId);
  return ref;
}

const other = (ctx: Ctx, side: Side) => (side === "buyer" ? ctx.seller : ctx.buyer);
const mine = (ctx: Ctx, side: Side) => (side === "buyer" ? ctx.buyer : ctx.seller);
const first = (user: User, fallback: string) => user.firstName ?? fallback;
const slotRef = (matchId: string, slot: Slot): Ref => ({ kind: "meetup_slot", matchId, start: slot.start.toISOString(), spot: slot.spot });
const when = (slot: Slot, now: Date) => `${slot.spot} ${describeTime(slot.start, now)}`;

/** Text to the other person (with `ref` so their answer finds it); returns the actor's own text for the caller to send. */
async function tell(ctx: Ctx, actor: Side, say: Says, ref?: Ref): Promise<string> {
  await sendTo(other(ctx, actor), say[actor === "buyer" ? "seller" : "buyer"], ref ? { ref } : {});
  if (ref) followUps.set(mine(ctx, actor).id, ref);
  return say[actor];
}
const same = (text: string): Says => ({ buyer: text, seller: text });

/** Accept just happened: ask BOTH when they're free. `by` said yes; the leads are what each side hears first. */
export function askAvailability(ctx: Ctx, by: Side, leads: { actor: string; other: string }): Promise<string> {
  const say = { [by]: `${leads.actor} ${ASK}`, [by === "buyer" ? "seller" : "buyer"]: `${leads.other} ${ASK}` } as Says;
  return tell(ctx, by, say, { kind: "availability", matchId: ctx.match.id });
}

const intersections = (a: Window[], b: Window[]) =>
  a.flatMap((x) => b.map((y) => ({ start: new Date(Math.max(+x.start, +y.start)), end: new Date(Math.min(+x.end, +y.end)) }))).filter((w) => w.end > w.start);

/** Nothing (more) to propose: each side hears the other's windows (times only) and is asked for more. */
async function needMoreTimes(ctx: Ctx, actor: Side, s: Sched, now: Date): Promise<string> {
  s.proposed = [];
  s.idx = 0;
  s.votes = {};
  await saveState(ctx.match.id, s);
  const ref: Ref = { kind: "availability", matchId: ctx.match.id };
  if (!s.buyerWindows || !s.sellerWindows) {
    const missing: Side = s.buyerWindows ? "seller" : "buyer";
    const waiting = `ok, waiting on ${first(other(ctx, missing), "them")}'s times`;
    await sendTo(mine(ctx, missing), `ok, ${ASK}`, { ref });
    if (actor === missing) followUps.set(mine(ctx, missing).id, ref);
    return actor === missing ? `ok, ${ASK}` : waiting;
  }
  const lead = s.rejected.length ? "that's all the overlap i've got." : "no shared time yet.";
  const line = (name: string, w: Window[]) => `${lead} ${name} is free ${describeWindows(w, now)}. any other times work for you?`;
  return tell(ctx, actor, { buyer: line(first(ctx.seller, "they"), s.sellerWindows), seller: line(first(ctx.buyer, "they"), s.buyerWindows) }, ref);
}

/** Put the current slot (s.idx) in front of BOTH. `lead` opens the text. */
async function present(ctx: Ctx, actor: Side, s: Sched, lead: string, now: Date): Promise<string> {
  const slot = s.proposed[s.idx]!;
  await saveState(ctx.match.id, s);
  return tell(ctx, actor, same(`${lead} ${when(slot, now)}? 👍 or 👎 for another option`), slotRef(ctx.match.id, slot));
}

/** Both windows known: find shared slots (skipping ones already turned down) and present the first. */
async function propose(ctx: Ctx, actor: Side, s: Sched, now: Date): Promise<string> {
  const slots = overlapSlots(s.buyerWindows ?? [], s.sellerWindows ?? [], now, { spotPrefs: s.spotPrefs, limit: 3 + s.rejected.length });
  s.proposed = slots.filter((slot) => !s.rejected.includes(key(slot))).slice(0, 3);
  s.idx = 0;
  s.votes = {};
  if (!s.proposed.length) return needMoreTimes(ctx, actor, s, now);
  const slot = s.proposed[0]!;
  const hit = intersections(s.buyerWindows!, s.sellerWindows!).find((w) => w.start <= slot.start && slot.start < w.end);
  return present(ctx, actor, s, `you're both free ${describeWindows([hit ?? { start: slot.start, end: new Date(+slot.start + HOUR) }], now)}.`, now);
}

/**
 * A person's free-form answer to "when are you free?" (or a new time/spot after a proposal).
 * `soft`: this text might just be chat, so return null when no time or spot can be read instead of re-asking.
 */
export async function onAvailability(user: User, matchId: string, text: string, soft = false): Promise<string | null> {
  return exclusive(matchId, async () => {
    const ctx = await loadMatch(matchId, user.id);
    if (!ctx || !["accepted", "meetup_set"].includes(ctx.match.status)) return null; // expired/cancelled: not ours, let the text fall through
    const side: Side = user.id === ctx.buyer.id ? "buyer" : "seller";
    const now = new Date();
    const { windows, spot } = await parseAvailability(text, now);
    if (!windows.length && !spot) {
      if (soft || text.includes("?") || text.trim().split(/\s+/).length > 6) return null; // chat or a question: relay it
      followUps.set(user.id, { kind: "availability", matchId });
      return "didn't catch a time there. try something like 'tmr after 2' or 'sat 11-3'";
    }
    const s = await loadState(matchId);
    if (spot && !s.spotPrefs.includes(spot)) s.spotPrefs.push(spot);
    if (windows.length) s[`${side}Windows`] = windows;
    if (!s[`${side}Windows`]) {
      await saveState(matchId, s);
      followUps.set(user.id, { kind: "availability", matchId });
      return `${spot}, got it. ${ASK}`;
    }
    if (!s.buyerWindows || !s.sellerWindows) {
      await saveState(matchId, s);
      return `got it, waiting on ${first(other(ctx, side), "their")}'s times`;
    }
    return propose(ctx, side, s, now);
  });
}

/** Both said yes to the SAME slot: now (and only now) the meetup is set. */
async function lock(ctx: Ctx, side: Side, s: Sched, slot: Slot, now: Date): Promise<string> {
  const problem = meetupTimeProblem(slot.start, now);
  if (problem) {
    s.rejected.push(key(slot));
    return needMoreTimes(ctx, side, s, now);
  }
  await db.updateMatch(ctx.match.id, { status: "meetup_set", meetupSpot: slot.spot, meetupAt: slot.start });
  Object.assign(s, { proposed: [], idx: 0, votes: {} });
  await saveState(ctx.match.id, s);
  const base = `locked in: ${when(slot, now)}.`;
  // Tagged "relay" so both people's lastRef moves on from the scheduling question: later chat is relayed, not read as times.
  return tell(ctx, side, { buyer: `${base} only pay once you have it in hand`, seller: `${base} i'll pass messages along` }, { kind: "relay", matchId: ctx.match.id });
}

/** One person's 👍/👎 on the slot on the table. Locks only when both said yes; a no moves both to the next option. */
async function vote(ctx: Ctx, side: Side, s: Sched, yes: boolean, now: Date): Promise<string> {
  const slot = s.proposed[s.idx]!;
  if (yes) {
    s.votes[side] = true;
    if (s.votes.buyer && s.votes.seller) return lock(ctx, side, s, slot, now);
    await saveState(ctx.match.id, s);
    followUps.set(mine(ctx, side).id, slotRef(ctx.match.id, slot));
    return `got it, waiting on ${first(other(ctx, side), "them")} to confirm`;
  }
  s.rejected.push(key(slot));
  s.votes = {};
  s.idx += 1;
  if (s.idx < s.proposed.length) return present(ctx, side, s, "no problem.", now);
  if (s.buyerWindows && s.sellerWindows) return propose(ctx, side, s, now);
  return needMoreTimes(ctx, side, s, now);
}

/** 👍/👎 (or a typed yes/no) on a proposed slot. `slot` is the one the answered message named; an older one is stale. */
export async function onSlotVote(user: User, matchId: string, yes: boolean, slot?: { start: string; spot: string }): Promise<string | null> {
  return exclusive(matchId, async () => {
    const ctx = await loadMatch(matchId, user.id);
    if (!ctx || !["accepted", "meetup_set"].includes(ctx.match.status)) return null; // expired/cancelled: let the text fall through
    const s = await loadState(matchId);
    const now = new Date();
    const cur = s.proposed[s.idx];
    if (!cur) {
      return ctx.match.meetupSpot && ctx.match.meetupAt ? `already locked in: ${ctx.match.meetupSpot} ${describeTime(ctx.match.meetupAt, now)}` : `nothing to confirm right now. ${ASK}`;
    }
    if (slot && (slot.start !== cur.start.toISOString() || slot.spot !== cur.spot)) {
      followUps.set(user.id, slotRef(matchId, cur));
      return `that one changed, the latest is ${when(cur, now)}? 👍 or 👎`;
    }
    return vote(ctx, user.id === ctx.buyer.id ? "buyer" : "seller", s, yes, now);
  });
}

/** Someone names a spot and time (the set_meetup tool): it's a proposal the OTHER person must 👍, never a unilateral lock. */
export async function suggestSlot(user: User, matchId: string, spot: string, at: Date): Promise<string> {
  return exclusive(matchId, async () => {
    const ctx = await loadMatch(matchId, user.id);
    if (!ctx || !["accepted", "meetup_set"].includes(ctx.match.status)) return NO_MATCH;
    const side: Side = user.id === ctx.buyer.id ? "buyer" : "seller";
    const [s, now, slot] = [await loadState(matchId), new Date(), { start: at, spot }];
    const cur = s.proposed[s.idx];
    if (cur && key(cur) === key(slot)) return vote(ctx, side, s, true, now); // the other side already proposed this exact one
    Object.assign(s, { proposed: [slot], idx: 0, votes: { [side]: true } });
    const them = other(ctx, side);
    await saveState(matchId, s);
    await sendTo(them, `${first(user, "they")} suggests ${when(slot, now)}. works for you? 👍 or 👎`, { ref: slotRef(matchId, slot) });
    return `asked ${first(them, "them")} if ${when(slot, now)} works, i'll lock it in once they say yes`;
  });
}

/** Is this scheduling question still live? Only while accepted; once locked, only with a slot on the table (a reschedule) or a direct "when are you free?". */
export async function schedulingOpen(matchId: string, ref: Ref): Promise<boolean> {
  const m = await db.getMatch(matchId);
  if (m?.status === "accepted") return true;
  if (m?.status !== "meetup_set") return false;
  const s = await loadState(matchId);
  return ref.kind === "availability" || !!s.proposed[s.idx];
}

/** What this person still owes on one of their matches (a time, or a 👍/👎), if exactly one match needs something. */
export async function awaitingRef(userId: string): Promise<Ref | undefined> {
  const found: Ref[] = [];
  for (const m of await db.activeMatchesForUser(userId)) {
    if (m.status !== "accepted" && m.status !== "meetup_set") continue;
    const s = await loadState(m.id);
    const side: Side = m.buyerId === userId ? "buyer" : "seller";
    const cur = s.proposed[s.idx];
    if (cur && s.votes[side] === undefined) found.push(slotRef(m.id, cur));
    else if (!cur && m.status === "accepted" && !s[`${side}Windows`]) found.push({ kind: "availability", matchId: m.id });
  }
  return found.length === 1 ? found[0] : undefined;
}
