// Disputes: one side claims the handoff happened, the other says it didn't. Karl must not cancel or promise fixes.
import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import type { Message } from "spectrum-ts";
import { tools } from "../../src/agent/tools";
import { LIMITS } from "../../src/config";
import { db } from "../../src/db";
import { myStuff } from "../../src/flows/buy";
import { parseDisputeAnswer } from "../../src/flows/dispute";
import { proposeMatch, respondToMatch } from "../../src/flows/match";
import * as safety from "../../src/safety";
import { handleInbound } from "../../src/spectrum/inbound";
import { lookupRef } from "../../src/spectrum/refs";
import { clearLastRef, sendTo } from "../../src/spectrum/send";
import type { Listing, User } from "../../src/types";
import { fakeSpace, fakeUser, lastTextTo, resetAll, sentTo } from "./helpers";

let buyer: User;
let seller: User;
let matchId: string;
let listing: Listing;

async function openDeal() {
  buyer = await fakeUser("Maya");
  seller = await fakeUser("Sam");
  const draft = { title: "Mechanical Keyboard (Velocifire TKL)", description: "", category: "keyboard", condition: "good" as const, priceCents: 4000, confidence: 0.9 };
  listing = await db.updateListing((await db.createListing({ sellerId: seller.id, draft, photoId: null })).id, { status: "active" });
  await proposeMatch(buyer, listing);
  matchId = (await db.activeMatchesForUser(buyer.id))[0]!.id;
  await sendTo(seller, await respondToMatch(seller, matchId, true));
  clearLastRef(buyer.id);
  clearLastRef(seller.id);
}

beforeEach(async () => {
  LIMITS.debounceMs = 0;
  await resetAll();
  spyOn(safety, "scanRelayMessage").mockResolvedValue({ action: "allow" });
});
afterEach(() => mock.restore());

let n = 0;
const read = mock(async () => {});
const msg = (user: User, content: unknown) => ({ id: `x${++n}`, direction: "inbound", sender: { id: user.phone }, content, read }) as unknown as Message;
const say = (user: User, t: string) => handleInbound(fakeSpace(user.spaceId), msg(user, { type: "text", text: t }));
const tapback = (user: User, emoji: string, targetId: string) => handleInbound(fakeSpace(user.spaceId), msg(user, { type: "reaction", emoji, target: { id: targetId } }));
const status = async () => (await db.getMatch(matchId))!.status;
const listingStatus = async () => (await db.getListing(listing.id))!.status;

/** The screenshot: seller says it's done, buyer 👎. Returns the dispute question the buyer got. */
async function claimThenThumbsDown() {
  await openDeal();
  await say(seller, "Ok deal is done. We met and I got the payment and have the keyboard");
  const checkin = sentTo(buyer).at(-1)!;
  expect(lookupRef(checkin.id)).toEqual({ kind: "checkin", matchId });
  await tapback(buyer, "👎", checkin.id);
  return sentTo(buyer).at(-1)!;
}

test("seller claims done, buyer 👎: nothing is cancelled, buyer is asked to double check, seller is told", async () => {
  const ask = await claimThenThumbsDown();
  expect(await status()).toBe("accepted");
  expect(await listingStatus()).toBe("held");
  expect(ask.text).toBe("heads up, Sam says you met and the mechanical keyboard (velocifire tkl) changed hands. 👍 if you got it, or reply 'didn't happen' if not");
  expect(lookupRef(ask.id)).toEqual({ kind: "dispute", matchId });
  expect(lastTextTo(seller)).toBe("they said it didn't happen. i asked them to double check, i'll let you know");
  expect(sentTo(seller).some((m) => m.text.includes("back up for sale"))).toBe(false);
});

test("buyer then 👍 on the dispute question: sold, both thanked", async () => {
  const ask = await claimThenThumbsDown();
  await tapback(buyer, "👍", ask.id);
  expect(await status()).toBe("completed");
  expect(await listingStatus()).toBe("sold");
  expect(lastTextTo(buyer)).toContain("enjoy the");
  expect(lastTextTo(seller)).toContain("sold! thanks");
});

test("buyer typing 'yeah i have it' also completes it", async () => {
  await claimThenThumbsDown();
  await say(buyer, "yeah i have it");
  expect(await status()).toBe("completed");
});

test("'didn't happen' twice: both told they disagree, listing stays held; later 'sold' completes", async () => {
  await claimThenThumbsDown();
  await say(buyer, "didn't happen");
  const text = "you two don't agree on this one, and i can't check in-person handoffs. if it sold, either of you text 'sold'. if not, text 'deal's off' and i'll relist it.";
  expect(lastTextTo(buyer)).toBe(text);
  expect(lastTextTo(seller)).toBe(text);
  expect(await status()).toBe("accepted");
  expect(await listingStatus()).toBe("held");

  await say(seller, "sold");
  expect(await status()).toBe("completed");
  expect(await listingStatus()).toBe("sold");
  expect(lastTextTo(seller)).toContain("sold! thanks");
  expect(lastTextTo(buyer)).toContain("enjoy the");
});

test("after the disagreement, 'deal's off' cancels and relists", async () => {
  await claimThenThumbsDown();
  await say(buyer, "didn't happen");
  await say(buyer, "deal's off");
  expect(await status()).toBe("cancelled");
  expect(await listingStatus()).toBe("active");
});

test("a 👎 tapback as the second answer also means they disagree", async () => {
  const ask = await claimThenThumbsDown();
  await tapback(buyer, "👎", ask.id);
  expect(lastTextTo(seller)).toContain("you two don't agree");
  expect(await status()).toBe("accepted");
});

test("a plain check-in 👎 with no prior claim still cancels and relists", async () => {
  await openDeal();
  const q = await sendTo(buyer, "did the handoff happen? (👍 or 👎)", { ref: { kind: "checkin", matchId } });
  await tapback(buyer, "👎", q!.id);
  expect(await status()).toBe("cancelled");
  expect(await listingStatus()).toBe("active");
  expect(lastTextTo(seller)).toContain("said the handoff didn't happen");
});

const recheck = (user: User) => tools.find((t) => t.name === "recheck_deal")!.run(user, { match_id: matchId }) as Promise<{ ok: boolean; message: string }>;

test("recheck_deal re-asks the other side once per deal, ever (no spam lever)", async () => {
  await claimThenThumbsDown();
  const before = sentTo(buyer).length;
  expect((await recheck(seller)).ok).toBe(true);
  expect(sentTo(buyer)).toHaveLength(before + 1);
  expect(lookupRef(sentTo(buyer).at(-1)!.id)).toEqual({ kind: "dispute", matchId });

  expect((await recheck(seller)).ok).toBe(false);
  const now = Date.now();
  spyOn(Date, "now").mockReturnValue(now + 7 * 3_600_000); // even hours later
  expect((await recheck(seller)).ok).toBe(false);
  expect(sentTo(buyer)).toHaveLength(before + 1);
});

test("recheck_deal refuses when nobody disputed, or for the disputed side", async () => {
  await openDeal();
  expect((await recheck(seller)).ok).toBe(false);
  await claimThenThumbsDown();
  expect((await recheck(buyer)).ok).toBe(false);
});

test("my_stuff lists a deal cancelled an hour ago, and recheck_deal can reopen it only if the other side says 👍", async () => {
  await openDeal();
  const q = await sendTo(buyer, "did the handoff happen? (👍 or 👎)", { ref: { kind: "checkin", matchId } });
  await tapback(buyer, "👎", q!.id);
  spyOn(Date, "now").mockReturnValue(Date.now() + 3_600_000);
  const stuff = await myStuff(seller);
  expect(stuff).toContain("recently ended (last 24h)");
  expect(stuff).toContain(`[${matchId}] selling mechanical keyboard (velocifire tkl) to Maya (cancelled`);
  expect(stuff).toContain("cancelled after Maya said it didn't happen");

  expect((await recheck(seller)).ok).toBe(true);
  expect(await status()).toBe("cancelled"); // asking changes nothing by itself
  const ask = sentTo(buyer).at(-1)!;
  await tapback(buyer, "👍", ask.id);
  expect(await status()).toBe("completed");
  expect(await listingStatus()).toBe("sold");
});

test("a reopened deal where the other side says no stays cancelled", async () => {
  await openDeal();
  const q = await sendTo(buyer, "did the handoff happen? (👍 or 👎)", { ref: { kind: "checkin", matchId } });
  await tapback(buyer, "👎", q!.id);
  await recheck(seller);
  await tapback(buyer, "👎", sentTo(buyer).at(-1)!.id);
  expect(await status()).toBe("cancelled");
  expect(await listingStatus()).toBe("active");
  expect(lastTextTo(seller)).toContain("stays cancelled");
});

test("parseDisputeAnswer: whole short answers only, mixed signals fall through", () => {
  for (const t of ["yes", "Yeah!", "y", "👍", "yeah i have it", "i got it", "no wait i have it", "yes i got it, he didn't give change", "yes i got it, sorry didn't see your text"]) expect(parseDisputeAnswer(t)).toBe(true);
  for (const t of ["no", "nope.", "n", "👎", "didn't happen", "it did not happen", "never got it"]) expect(parseDisputeAnswer(t)).toBe(false);
  for (const t of ["i have class at 5", "sure when are you free", "sure, when are you free", "no worries", "rock n roll", "yeah sounds good", "ok", "yes it happened but didn't happen"]) expect(parseDisputeAnswer(t)).toBeNull();
});

test("chat after a relay is not a dispute answer: 'i have class at 5' / 'sure when are you free' settle nothing", async () => {
  await claimThenThumbsDown();
  await say(seller, "bro what, i handed it to you"); // relayed to the buyer: their last ref is now a relay
  await say(buyer, "i have class till 5, can we do it after");
  await say(buyer, "sure, when are you free");
  expect(await status()).toBe("accepted");
  expect(await listingStatus()).toBe("held");
  expect(lastTextTo(seller)).not.toContain("enjoy");
});

test("a reply threaded to some other message is not a dispute answer", async () => {
  const ask = await claimThenThumbsDown();
  const other = await sendTo(buyer, "unrelated", { ref: { kind: "relay", matchId, from: "seller" } as never });
  await handleInbound(fakeSpace(buyer.spaceId), msg(buyer, { type: "reply", content: { type: "text", text: "yeah" }, target: { id: other!.id } }));
  expect(await status()).toBe("accepted");
  void ask;
});

test("while a dispute is open, the claimer's argument is relayed, not eaten by the meetup scheduler", async () => {
  await claimThenThumbsDown();
  await say(seller, "bro what, i handed it to you at the pit");
  expect(lastTextTo(seller)).not.toContain("when are you free");
  const toBuyer = (await db.recentMessages(buyer.id, 50)).filter((m) => m.direction === "out").map((m) => m.text);
  expect(toBuyer.at(-1)).toContain("i handed it to you at the pit");
});

test("a name stored before the filter shipped never reaches the other person or Gemini context", async () => {
  await openDeal();
  await db.updateUser(seller.id, { firstName: "Nigganth" });
  const all = async () => [...sentTo(buyer), ...sentTo(seller)].map((m) => m.text).join("\n");
  await say(seller, "Ok deal is done. We met and I got the payment");
  await tapback(buyer, "👎", sentTo(buyer).at(-1)!.id);
  expect(lastTextTo(buyer)).toContain("the seller says you met");
  expect(await myStuff(buyer)).not.toMatch(/nigg/i);
  expect(await all()).not.toMatch(/nigg/i);
});
