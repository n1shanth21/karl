// Disputes: one side says the handoff happened, the other says it didn't. Karl can't see in-person handoffs, so he never
// cancels on a bare 👎 after a claim. State lives in "dispute" events (phase asked → disagreed → resolved), so it survives restarts.
// Also records "deal_ended" events so my_stuff can show deals that ended in the last 24 h. Owner: Nishanth.

import { db } from "../db";
import type { Ref } from "../spectrum/refs";
import { clearLastRef, lastRefTo, sendTo } from "../spectrum/send";
import type { User } from "../types";
import { itemName } from "./format";
import { displayName } from "./names";
import { completeDeal, loadMatch, type Ctx } from "./match";

type Phase = "asked" | "disagreed" | "resolved";
const OPEN = ["accepted", "meetup_set"];
const HOUR_MS = 3_600_000;
const HOLD_EXTENSION_MS = 3 * 24 * HOUR_MS;

const DOUBLE_CHECK = "they said it didn't happen. i asked them to double check, i'll let you know";
const DISAGREE =
  "you two don't agree on this one, and i can't check in-person handoffs. if it sold, either of you text 'sold'. if not, text 'deal's off' and i'll relist it.";

// Whole short answers only: ordinary chat ("sure, when are you free", "i have class at 5") must never settle a deal.
const NO = /^(n|no|nope|nah)[.!\s]*$|\b(didn'?t happen|did not happen|never got it|don'?t have it)\b|👎/i;
const YES = /^(y|yes|yeah|yep|yup|ya|yea)[.!\s]*$|\b(i (got|have) it|it happened|we met)\b|👍|❤️/i;

/** "didn't happen" → false, "yeah" / "i have it" → true, anything else (chat, mixed signals) → null. */
export function parseDisputeAnswer(text: string): boolean | null {
  const t = text.trim();
  if (t.split(/\s+/).length > 12) return null;
  const [no, yes] = [NO.test(t), YES.test(t)];
  return no === yes ? null : yes;
}

export async function disputeState(matchId: string): Promise<{ phase: Phase; userId: string | null } | null> {
  const [e] = await db.findEvents("dispute", { payload: { matchId }, limit: 1 });
  return e ? { phase: e.payload.phase as Phase, userId: e.userId } : null;
}

const setPhase = (ctx: Ctx, disputedId: string, phase: Phase) =>
  db.logEvent("dispute", { userId: disputedId, listingId: ctx.listing.id, payload: { matchId: ctx.match.id, phase } });

const other = (ctx: Ctx, user: User) => (user.id === ctx.buyer.id ? ctx.seller : ctx.buyer);

/** Send an untagged text, and forget any older pending question so the next reply isn't read as an answer to it. */
async function say(user: User, text: string, ref?: Ref): Promise<void> {
  await sendTo(user, text, ref ? { ref } : {});
  if (!ref) clearLastRef(user.id);
}

const askText = (ctx: Ctx, claimer: User) => {
  const name = displayName(claimer, claimer.id === ctx.buyer.id ? "the buyer" : "the seller");
  return `heads up, ${name} says you met and the ${itemName(ctx.listing)} changed hands. 👍 if you got it, or reply 'didn't happen' if not`;
};

/** Record that a deal ended (for both people) so my_stuff can show it for the next 24 h. */
export async function logDealEnded(ctx: Ctx, how: string): Promise<void> {
  for (const u of [ctx.buyer, ctx.seller]) {
    await db.logEvent("deal_ended", { userId: u.id, listingId: ctx.listing.id, payload: { matchId: ctx.match.id, how } });
  }
}

/** `disputer` answered no/👎 to "did it happen?" after the other side claimed it did. Returns the question to put to the disputer. */
export async function openDispute(ctx: Ctx, disputer: User, endMatch: () => Promise<string>): Promise<string> {
  const state = await disputeState(ctx.match.id);
  if (state && state.phase !== "resolved") {
    if (state.userId !== disputer.id) return endMatch();
    return (await answerDispute(disputer, ctx.match.id, false)) ?? DISAGREE; // asked again: that's their second no
  }
  const claimer = other(ctx, disputer);
  await setPhase(ctx, disputer.id, "asked");
  await say(claimer, DOUBLE_CHECK);
  return askText(ctx, claimer);
}

/** The disputed side answers the dispute question. yes → sold. no → the two disagree: listing stays held, match stays open. */
export async function answerDispute(user: User, matchId: string, yes: boolean): Promise<string | null> {
  const ctx = await loadMatch(matchId, user.id);
  if (!ctx) return null;
  const state = await disputeState(matchId);
  const { match, listing } = ctx;
  if (match.status === "completed") return "that one's already marked sold, all good";
  if (state?.phase !== "asked" || state.userId !== user.id) return "that one's already sorted. if it sold text 'sold', if not text 'deal's off'";
  const claimer = other(ctx, user);
  const open = OPEN.includes(match.status);

  if (yes) {
    if (!open && listing.status !== "active") return `the ${itemName(listing)} isn't available to reopen anymore`;
    await setPhase(ctx, user.id, "resolved");
    return completeDeal(ctx, user);
  }
  if (!open) {
    await setPhase(ctx, user.id, "resolved");
    await say(claimer, `they said it didn't happen, so the ${itemName(listing)} deal stays cancelled`);
    return "ok, noted. it stays cancelled";
  }
  await setPhase(ctx, user.id, "disagreed");
  if (match.status === "accepted") await db.updateMatch(match.id, { holdExpiresAt: new Date(Date.now() + HOLD_EXTENSION_MS) });
  await say(claimer, DISAGREE);
  return DISAGREE;
}

/** A typed answer to a pending dispute question ("didn't happen", "yeah i have it"). False = not an answer, carry on. */
export async function answerDisputeText(user: User, text: string, threaded?: Ref): Promise<string | null> {
  const ref = threaded ?? lastRefTo(user.id); // a reply threaded to anything else is not an answer to the dispute
  const yes = parseDisputeAnswer(text);
  return ref?.kind === "dispute" && yes !== null ? answerDispute(user, ref.matchId, yes) : null;
}

/**
 * Tool: the user says the other side is wrong about what happened. Re-asks the OTHER side (once per 6 h per match).
 * Open deal: the claimer asks again. Ended deal: reopens only if the other side now says 👍 and the item is still listed.
 */
export async function recheckDeal(user: User, matchId: string): Promise<{ ok: boolean; message: string }> {
  const ctx = await loadMatch(matchId, user.id);
  if (!ctx) return { ok: false, message: "no such deal for this user" };
  const { match, listing } = ctx;
  const target = other(ctx, user);
  const state = await disputeState(matchId);
  const open = OPEN.includes(match.status);

  if (match.status === "completed") return { ok: false, message: "this deal is already marked sold, nothing to recheck" };
  if (open && (!state || state.phase === "resolved" || state.userId === user.id)) {
    return { ok: false, message: `${displayName(target, "the other person")} hasn't disputed this deal, so there is nothing to recheck` };
  }
  if (!open && !["cancelled", "expired"].includes(match.status)) return { ok: false, message: "this deal can't be rechecked" };
  if (!open && listing.status !== "active") return { ok: false, message: `the ${itemName(listing)} is no longer available, so the deal can't be reopened` };

  // One recheck per deal, ever: it puts "<you> says it happened" in Karl's voice, so it must not become a spam lever.
  const [last] = await db.findEvents("dispute_recheck", { payload: { matchId }, limit: 1 });
  if (last) return { ok: false, message: "already re-asked them once for this deal, karl won't ask again. tell the user they can text 'sold' or 'deal's off'" };
  if (!open) {
    // Only reopen a deal that ended in the last 24 h BECAUSE the other side said it didn't happen (not a back-out).
    const ended = (await db.findEvents("deal_ended", { userId: user.id, limit: 10 })).find((e) => String(e.payload.matchId) === matchId);
    const recent = ended && Date.now() - ended.ts.getTime() < 24 * HOUR_MS;
    if (!recent || !String(ended.payload.how ?? "").includes("didn't happen")) {
      return { ok: false, message: "this deal ended for another reason or too long ago, so karl can't reopen it. the user can relist or start a new deal" };
    }
  }

  await db.updateMatch(matchId, user.id === ctx.buyer.id ? { buyerConfirmed: true } : { sellerConfirmed: true }); // calling this = claiming it happened
  await setPhase(ctx, target.id, "asked");
  await db.logEvent("dispute_recheck", { userId: user.id, listingId: listing.id, payload: { matchId } });
  await say(target, askText(ctx, user), { kind: "dispute", matchId });
  return { ok: true, message: `asked ${displayName(target, "the other person")} again. karl will text the user when they answer. nothing else was done` };
}

/** my_stuff lines for deals that ended in the last 24 h, so Gemini can see them. */
export async function recentlyEnded(user: User): Promise<string[]> {
  const since = Date.now() - 24 * HOUR_MS;
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const e of await db.findEvents("deal_ended", { userId: user.id, limit: 10 })) {
    const id = String(e.payload.matchId);
    if (e.ts.getTime() < since || seen.has(id)) continue;
    seen.add(id);
    const match = await db.getMatch(id);
    const [listing, who] = match ? await Promise.all([db.getListing(match.listingId), db.getUser(match.buyerId === user.id ? match.sellerId : match.buyerId)]) : [null, null];
    if (!match || !listing) continue;
    const mins = Math.max(1, Math.round((Date.now() - e.ts.getTime()) / 60_000));
    const ago = mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`;
    lines.push(`[${id}] ${match.buyerId === user.id ? "buying" : "selling"} ${itemName(listing)} ${match.buyerId === user.id ? "from" : "to"} ${who ? displayName(who, "someone") : "someone"} (${match.status} ${ago}: ${e.payload.how})`);
  }
  return lines;
}
