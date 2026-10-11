// Meetup scheduling by overlap: both are asked when they're free, Karl proposes one slot to BOTH,
// and the meetup locks only when both say yes to the SAME slot. Uses the real availability engine (no Gemini).
import { afterEach, beforeEach, expect, mock, setSystemTime, spyOn, test } from "bun:test";
import type { Message } from "spectrum-ts";
import * as loop from "../../src/agent/loop";
import { LIMITS } from "../../src/config";
import { resetGeminiForTests, setGeminiForTests } from "../../src/agent/gemini";
import { db } from "../../src/db";
import { proposeMatch, respondToMatch, setMeetup } from "../../src/flows/match";
import * as photo from "../../src/flows/photo";
import * as relay from "../../src/flows/relay";
import { onAvailability, onSlotVote } from "../../src/flows/scheduling";
import * as safety from "../../src/safety";
import { handleInbound } from "../../src/spectrum/inbound";
import { lookupRef } from "../../src/spectrum/refs";
import { lastRefTo, sendTo } from "../../src/spectrum/send";
import type { Listing, User } from "../../src/types";
import { fakeSpace, fakeUser, lastTextTo, resetAll, sentTo } from "./helpers";

const NOW = new Date("2026-10-11T01:27:00Z"); // Saturday Oct 10, 9:27 PM EDT: "tmr" is Sunday Oct 11
let buyer: User;
let seller: User;
let matchId: string;

beforeEach(async () => {
  setSystemTime(NOW);
  LIMITS.debounceMs = 0;
  await resetAll();
  buyer = await fakeUser("Maya", "+15550001111");
  seller = await fakeUser("Sam", "+15550002222");
  spyOn(safety, "scanRelayMessage").mockResolvedValue({ action: "allow" });
  spyOn(photo, "photoAttachment").mockResolvedValue(null);
  const draft = { title: "Mini fridge", description: "works", category: "fridge", condition: "good" as const, priceCents: 4500, confidence: 0.9 };
  const listing: Listing = await db.updateListing((await db.createListing({ sellerId: seller.id, draft, photoId: null })).id, { status: "active" });
  await proposeMatch(buyer, listing);
  matchId = (await db.activeMatchesForUser(buyer.id))[0]!.id;
  await respondToMatch(seller, matchId, true);
});

afterEach(() => {
  mock.restore();
  setSystemTime();
  resetGeminiForTests();
});

const matchNow = () => db.getMatch(matchId).then((m) => m!);
const slotId = (user: User) => sentTo(user).findLast((s) => lookupRef(s.id)?.kind === "meetup_slot")!.id;
/** Both people share tmr 12-6, so Karl offers 12pm, 2pm, 4pm at the Pit. */
async function bothFree() {
  await onAvailability(buyer, matchId, "tmr 12-6");
  await onAvailability(seller, matchId, "tmr 12-6");
}

test("accept asks BOTH when they're free (availability ref) and holds for 12 hours", async () => {
  expect(lastTextTo(buyer)).toBe("Sam said yes, the mini fridge is held for you. when are you free to meet in the next couple days? (like 'tmr after 2' or 'sat 11-3')");
  expect(lookupRef(sentTo(buyer).at(-1)!.id)).toEqual({ kind: "availability", matchId });
  expect(lastRefTo(buyer.id)).toEqual({ kind: "availability", matchId });
  const m = await matchNow();
  expect(m.status).toBe("accepted");
  expect(m.holdExpiresAt!.getTime() - NOW.getTime()).toBe(12 * 3_600_000);
});

test("the first answer waits; the second answer sends the SAME proposal to both", async () => {
  expect(await onAvailability(buyer, matchId, "tmr after 2")).toBe("got it, waiting on Sam's times");
  expect(sentTo(seller)).toHaveLength(1); // nothing new for Sam yet
  const reply = await onAvailability(seller, matchId, "tmr 1-5");
  expect(reply).toContain("you're both free tomorrow 2–5pm");
  expect(reply).toContain("the Pit tomorrow at 2pm? 👍 or 👎 for another option");
  expect(lastTextTo(buyer)).toBe(reply!);
  expect(lookupRef(sentTo(buyer).at(-1)!.id)).toMatchObject({ kind: "meetup_slot", matchId, spot: "the Pit" });
  expect((await matchNow()).status).toBe("accepted");
});

test("one 👍 never locks; both 👍 on the same slot lock it", async () => {
  await bothFree();
  expect(await onSlotVote(buyer, matchId, true)).toBe("got it, waiting on Sam to confirm");
  expect((await matchNow()).status).toBe("accepted");
  const sellerText = await onSlotVote(seller, matchId, true);
  expect(sellerText).toBe("locked in: the Pit tomorrow at 12pm. i'll pass messages along");
  expect(lastTextTo(buyer)).toBe("locked in: the Pit tomorrow at 12pm. only pay once you have it in hand");
  expect(await matchNow()).toMatchObject({ status: "meetup_set", meetupSpot: "the Pit", meetupAt: new Date("2026-10-11T16:00:00Z") });
});

test("a 👎 from either side moves BOTH to the next slot and resets the votes", async () => {
  await bothFree();
  await onSlotVote(buyer, matchId, true);
  const next = await onSlotVote(seller, matchId, false);
  expect(next).toBe("no problem. the Pit tomorrow at 2pm? 👍 or 👎 for another option");
  expect(lastTextTo(buyer)).toBe(next!);
  expect(await onSlotVote(seller, matchId, true)).toBe("got it, waiting on Maya to confirm"); // Maya's old 👍 doesn't count
  expect((await matchNow()).status).toBe("accepted");
  await onSlotVote(buyer, matchId, true);
  expect((await matchNow()).meetupAt).toEqual(new Date("2026-10-11T18:00:00Z")); // 2pm
});

test("an old message's 👍 can't confirm a slot that has moved on", async () => {
  await bothFree();
  const first = lookupRef(slotId(buyer)) as { start: string; spot: string };
  await onSlotVote(seller, matchId, false);
  expect(await onSlotVote(buyer, matchId, true, first)).toContain("that one changed");
  expect((await matchNow()).status).toBe("accepted");
});

test("no overlap: each side hears the other's windows (times only) and is asked for more", async () => {
  await onAvailability(buyer, matchId, "tmr 10-12");
  const reply = await onAvailability(seller, matchId, "tmr 3-5");
  expect(reply).toContain("no shared time yet. Maya is free tomorrow 10am–12pm");
  expect(lastTextTo(buyer)).toContain("Sam is free tomorrow 3–5pm");
  for (const text of [reply!, lastTextTo(buyer)]) expect(text).not.toMatch(/\+?\d{7,}/);
  expect(lastRefTo(buyer.id)).toEqual({ kind: "availability", matchId });
  expect((await matchNow()).status).toBe("accepted");
  // a new answer replaces that person's windows and recomputes
  expect(await onAvailability(buyer, matchId, "tmr 3-6")).toContain("you're both free tomorrow 3–5pm");
});

test("running out of slots asks both for more times instead of repeating", async () => {
  await onAvailability(buyer, matchId, "tmr 1-3");
  await onAvailability(seller, matchId, "tmr 1-3"); // only 1pm
  const out = await onSlotVote(buyer, matchId, false);
  expect(out).toContain("that's all the overlap i've got. Sam is free tomorrow 1–3pm");
  expect(lastTextTo(seller)).toContain("Maya is free tomorrow 1–3pm");
});

test("the real two-phone sequence never ends with two different meetups", async () => {
  expect(await onAvailability(seller, matchId, "pit tmr at 1pm")).toBe("got it, waiting on Maya's times");
  const clash = await onAvailability(buyer, matchId, "union tmr at 4pm");
  expect(clash).toContain("no shared time yet");
  expect(lastTextTo(seller)).toContain("Maya is free tomorrow 4–5pm");
  expect(await matchNow()).toMatchObject({ status: "accepted", meetupSpot: null, meetupAt: null });

  const fix = await onAvailability(buyer, matchId, "tmr 12-2");
  expect(fix).toContain("the Pit tomorrow at 1pm?"); // seller named the Pit first
  await onSlotVote(buyer, matchId, true);
  await onSlotVote(seller, matchId, true);
  expect(await matchNow()).toMatchObject({ status: "meetup_set", meetupSpot: "the Pit", meetupAt: new Date("2026-10-11T17:00:00Z") });
});

test("set_meetup (the tool path) proposes to the OTHER side and only locks on their 👍", async () => {
  const at = new Date("2026-10-11T18:00:00Z"); // 2pm tomorrow
  expect(await setMeetup(buyer, matchId, "the pit", at)).toContain("asked Sam if the Pit tomorrow at 2pm works");
  expect(lastTextTo(seller)).toBe("Maya suggests the Pit tomorrow at 2pm. works for you? 👍 or 👎");
  expect(await matchNow()).toMatchObject({ status: "accepted", meetupSpot: null });
  expect(await onSlotVote(seller, matchId, true)).toContain("locked in: the Pit tomorrow at 2pm");
  expect((await matchNow()).meetupAt).toEqual(at);
});

test("both suggesting the same slot with the tool locks it", async () => {
  const at = new Date("2026-10-11T18:00:00Z");
  await setMeetup(buyer, matchId, "the Pit", at);
  expect(await setMeetup(seller, matchId, "the Pit", at)).toContain("locked in");
  expect((await matchNow()).status).toBe("meetup_set");
});

test("scheduling state survives in the events table (no in-memory cache needed)", async () => {
  await onAvailability(buyer, matchId, "tmr after 2");
  const [row] = await db.findEvents("sched", { payload: { matchId }, limit: 1 });
  expect(row!.payload.state).toMatchObject({ spotPrefs: [], proposed: [], idx: 0 });
  expect(JSON.stringify(row!.payload.state)).toContain("2026-10-11T18:00:00.000Z");
});

// ---- through handleInbound ------------------------------------------------------------------------------------

let n = 0;
const read = mock(async () => {});
const msg = (user: User, content: unknown) => ({ id: `s${++n}`, direction: "inbound", sender: { id: user.phone }, content, read }) as unknown as Message;
const say = (user: User, t: string) => handleInbound(fakeSpace(user.spaceId), msg(user, { type: "text", text: t }));
const tapback = (user: User, emoji: string, targetId: string) => handleInbound(fakeSpace(user.spaceId), msg(user, { type: "reaction", emoji, target: { id: targetId } }));

test("a typed availability answer is never relayed or sent to Gemini; then 👍 tapbacks lock it", async () => {
  const routed = spyOn(relay, "routeMessage");
  await say(seller, "tmr 1-3");
  expect(lastTextTo(seller)).toBe("got it, waiting on Maya's times");
  await say(buyer, "tmr 1-3");
  expect(routed).not.toHaveBeenCalled();
  expect(lastTextTo(seller)).toContain("the Pit tomorrow at 1pm? 👍 or 👎");
  expect(lastTextTo(buyer)).toContain("the Pit tomorrow at 1pm? 👍 or 👎");

  await tapback(buyer, "👍", slotId(buyer));
  expect((await matchNow()).status).toBe("accepted");
  await say(seller, "yes");
  expect(await matchNow()).toMatchObject({ status: "meetup_set", meetupSpot: "the Pit" });
  expect(lastTextTo(seller)).toContain("locked in");
});

test("a new time typed instead of 👍/👎 replaces that person's availability", async () => {
  await bothFree();
  await say(buyer, "union tmr 3-6");
  expect(lastTextTo(seller)).toContain("Student Union lobby tomorrow at 3pm");
  expect((await matchNow()).status).toBe("accepted");
});

test("a chatty text after a relay buried the question still finds the owed availability, chat still relays", async () => {
  await sendTo(seller, "**Maya · mini fridge**\nhey!", { ref: { kind: "relay", matchId } });
  await say(seller, "omw soon"); // soft: no time in it, so it's chat
  expect((await db.recentMessages(buyer.id, 5)).at(-1)!.text).toBe("**Sam · mini fridge**\nomw soon");
  await sendTo(seller, "**Maya · mini fridge**\nhey again", { ref: { kind: "relay", matchId } });
  await say(seller, "tmr after 2");
  expect(lastTextTo(seller)).toBe("got it, waiting on Maya's times");
});

test("commands like cancel are not swallowed as availability", async () => {
  const routed = spyOn(relay, "routeMessage").mockResolvedValue("relayed");
  await say(seller, "cancel");
  expect(routed).toHaveBeenCalled();
});

// ---- after the lock, and chat during scheduling -------------------------------------------------------------------

async function lockedViaTexts() {
  await bothFree();
  await tapback(buyer, "👍", slotId(buyer));
  await say(seller, "yes"); // second voter locks the Pit tomorrow 12pm
  expect((await matchNow()).status).toBe("meetup_set");
}
const lastIn = async (user: User) => (await db.recentMessages(user.id, 5)).at(-1)!.text;

test("after the lock, BOTH people's chat (even with a time in it) is relayed, not read as availability", async () => {
  await lockedViaTexts();
  expect(lastRefTo(buyer.id)).toEqual({ kind: "relay", matchId }); // first voter's stale meetup_slot ref is gone
  expect(lastRefTo(seller.id)).toEqual({ kind: "relay", matchId });
  await say(buyer, "be there at 11:45, wearing a red jacket");
  expect(await lastIn(seller)).toBe("**Maya · mini fridge**\nbe there at 11:45, wearing a red jacket");
  await say(seller, "ok see you at 12");
  expect(await lastIn(buyer)).toBe("**Sam · mini fridge**\nok see you at 12");
  await say(buyer, "ok cool");
  expect(await lastIn(seller)).toBe("**Maya · mini fridge**\nok cool");
  expect(await matchNow()).toMatchObject({ status: "meetup_set", meetupAt: new Date("2026-10-11T16:00:00Z") });
  const proposals = (await db.recentMessages(buyer.id, 50)).filter((m) => m.direction === "out" && m.text.includes("you're both free"));
  expect(proposals).toHaveLength(1); // only the original proposal, no bogus re-proposal
});

test("a stale meetup_slot/availability ref on a locked match is ignored (chat is relayed)", async () => {
  await lockedViaTexts();
  spyOn(loop, "runAgentTurn").mockResolvedValue("agent reply");
  await sendTo(buyer, "old", { ref: { kind: "availability", matchId } });
  await sendTo(seller, "old", { ref: { kind: "meetup_slot", matchId, start: "2026-10-11T16:00:00.000Z", spot: "the Pit" } });
  await say(seller, "ok");
  expect(lastTextTo(seller)).not.toContain("already locked in"); // "ok" is a plain yes: Karl's, not a scheduling vote
  await say(seller, "see you there");
  expect(await lastIn(buyer)).toBe("**Sam · mini fridge**\nsee you there");
  expect(await matchNow()).toMatchObject({ status: "meetup_set", meetupAt: new Date("2026-10-11T16:00:00Z") });
});

test("a question while 'when are you free?' is open falls through (no 'didn't catch', no Gemini time extraction)", async () => {
  const extract = mock(async () => ({ windows: [], spot: null }));
  setGeminiForTests({ extractAvailability: extract });
  const agent = spyOn(loop, "runAgentTurn").mockResolvedValue("agent reply");
  await say(buyer, "does it come with the shelf?");
  await say(buyer, "hey is it still in good shape");
  expect(agent).not.toHaveBeenCalled(); // chat during scheduling is relayed to the other side
  const sellerSaw = (await db.recentMessages(seller.id, 20)).filter((m) => m.direction === "out").map((m) => m.text);
  expect(sellerSaw.some((t) => t.includes("does it come with the shelf?"))).toBe(true);
  expect(sentTo(buyer).some((m) => m.text.includes("didn't catch"))).toBe(false);
  expect(extract).not.toHaveBeenCalled();
});

test("a short unreadable answer still gets the 'didn't catch a time' nudge", async () => {
  await say(buyer, "hmm");
  expect(lastTextTo(buyer)).toContain("didn't catch a time");
});

test("once the hold expired, a stale scheduling ref does not hijack 'yes'", async () => {
  await bothFree();
  await db.updateMatch(matchId, { status: "expired" });
  const agent = spyOn(loop, "runAgentTurn").mockResolvedValue("agent reply");
  await say(buyer, "yes");
  expect(agent).toHaveBeenCalledTimes(1);
  expect(sentTo(buyer).some((m) => m.text.includes("can't find that one"))).toBe(false);
});

test("scheduling activity extends the hold, so an overnight deal isn't expired mid-conversation", async () => {
  setSystemTime(new Date(NOW.getTime() + 10 * 3_600_000)); // 7:27am, 10h in: only 2h of the hold is left
  await onAvailability(buyer, matchId, "tmr after 2");
  expect((await matchNow()).holdExpiresAt!.getTime()).toBe(Date.now() + 12 * 3_600_000);
});
