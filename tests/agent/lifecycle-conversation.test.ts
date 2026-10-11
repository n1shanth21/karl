// Texts + reply routing for the lifecycle events: meetup reminders, stale checks, auto-close, bid replies.
import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import type { Message, Space } from "spectrum-ts";
import * as loop from "../../src/agent/loop";
import { registerLifecycle } from "../../src/agent/lifecycle";
import { bus } from "../../src/bus";
import { LIMITS } from "../../src/config";
import { db } from "../../src/db";
import * as offers from "../../src/flows/offers";
import * as staleness from "../../src/flows/staleness";
import { handleInbound } from "../../src/spectrum/inbound";
import { lastRefTo } from "../../src/spectrum/send";
import type { Listing, User, Want } from "../../src/types";
import { fakeSpace, fakeUser, lastTextTo, resetAll, sentTo } from "./helpers";

registerLifecycle();

let user: User;
let other: User;
let n = 0;
const spaces = new Map<string, Space>();
const spaceOf = (u: User) => spaces.get(u.spaceId) ?? spaces.set(u.spaceId, fakeSpace(u.spaceId)).get(u.spaceId)!;
const say = (u: User, text: string) =>
  handleInbound(spaceOf(u), { id: `l${++n}`, direction: "inbound", sender: { id: u.phone }, content: { type: "text", text }, read: async () => {} } as unknown as Message);
const tapback = (u: User, targetId: string, emoji: string) =>
  handleInbound(spaceOf(u), { id: `l${++n}`, direction: "inbound", sender: { id: u.phone }, content: { type: "reaction", emoji, target: { id: targetId } }, read: async () => {} } as unknown as Message);
const settle = () => new Promise((r) => setTimeout(r, 30));

async function activeListing(sellerId: string, priceCents = 3000): Promise<Listing> {
  const draft = { title: "Water bottle", description: "works", category: "water bottle", condition: "good" as const, priceCents, confidence: 0.9 };
  const l = await db.createListing({ sellerId, draft, photoId: null });
  return db.updateListing(l.id, { status: "active" });
}
const openWant = (buyerId: string): Promise<Want> => db.createWant({ buyerId, queryText: "mini fridge", maxPriceCents: 6000 });

let markStillActive: ReturnType<typeof spyOn>;
let answerBid: ReturnType<typeof spyOn>;

beforeEach(async () => {
  LIMITS.debounceMs = 0;
  await resetAll();
  spaces.clear();
  spyOn(loop, "runAgentTurn").mockResolvedValue("agent reply");
  markStillActive = spyOn(staleness, "markStillActive").mockResolvedValue(undefined);
  answerBid = spyOn(offers, "answerBid").mockResolvedValue("sent your price");
  user = await fakeUser("Maya", "+15550007001");
  other = await fakeUser("Sam", "+15550007002");
});
afterEach(() => mock.restore());

test("stale_check_due on a listing texts once with a still_active ref", async () => {
  const listing = await activeListing(user.id);
  bus.emit("stale_check_due", { userId: user.id, listingId: listing.id });
  await settle();
  expect(sentTo(user).map((m) => m.text)).toEqual(["still selling your water bottle for $30? (👍 still selling / 👎 sold or gone)"]);
  expect(lastRefTo(user.id)).toEqual({ kind: "still_active", listingId: listing.id });
});

test("stale_check_due on a want texts once with a still_active ref", async () => {
  const want = await openWant(user.id);
  bus.emit("stale_check_due", { userId: user.id, wantId: want.id });
  await settle();
  expect(sentTo(user).map((m) => m.text)).toEqual(["still looking for mini fridge? (👍 yes / 👎 nope)"]);
  expect(lastRefTo(user.id)).toEqual({ kind: "still_active", wantId: want.id });
});

test("stale_auto_closed tells the user for a listing and for a want", async () => {
  const listing = await activeListing(user.id);
  const want = await openWant(other.id);
  bus.emit("stale_auto_closed", { userId: user.id, listingId: listing.id });
  bus.emit("stale_auto_closed", { userId: other.id, wantId: want.id });
  await settle();
  expect(sentTo(user).map((m) => m.text)).toEqual(["took down your water bottle listing since i didn't hear back. text me a photo anytime to relist"]);
  expect(sentTo(other).map((m) => m.text)).toEqual(["stopped looking for mini fridge since i didn't hear back. just text me if you still need one"]);
});

test("opted-out users get no lifecycle texts", async () => {
  const listing = await activeListing(user.id);
  await db.updateUser(user.id, { optedOut: true });
  bus.emit("stale_check_due", { userId: user.id, listingId: listing.id });
  bus.emit("stale_auto_closed", { userId: user.id, listingId: listing.id });
  await settle();
  expect(sentTo(user)).toEqual([]);
});

test("checkin_reminder_due texts only the side that hasn't confirmed", async () => {
  const listing = await activeListing(user.id);
  const match = await db.createMatch({ listingId: listing.id, buyerId: other.id, sellerId: user.id });
  await db.updateMatch(match.id, { status: "meetup_set", buyerConfirmed: true });
  bus.emit("checkin_reminder_due", { matchId: match.id });
  await settle();
  expect(sentTo(other)).toEqual([]);
  expect(sentTo(user).map((m) => m.text)).toEqual(["quick check, did the water bottle handoff happen? (👍 or 👎)"]);
  expect(lastRefTo(user.id)).toEqual({ kind: "checkin", matchId: match.id });
});

test("checkin_reminder_due does nothing once the match is done", async () => {
  const listing = await activeListing(user.id);
  const match = await db.createMatch({ listingId: listing.id, buyerId: other.id, sellerId: user.id });
  await db.updateMatch(match.id, { status: "completed" });
  bus.emit("checkin_reminder_due", { matchId: match.id });
  await settle();
  expect(sentTo(user)).toEqual([]);
  expect(sentTo(other)).toEqual([]);
});

async function staleListingAsked() {
  const listing = await activeListing(user.id);
  bus.emit("stale_check_due", { userId: user.id, listingId: listing.id });
  await settle();
  return listing;
}
async function staleWantAsked() {
  const want = await openWant(user.id);
  bus.emit("stale_check_due", { userId: user.id, wantId: want.id });
  await settle();
  return want;
}

test("yes on a stale listing check keeps it up", async () => {
  const listing = await staleListingAsked();
  await say(user, "yes");
  expect(markStillActive).toHaveBeenCalledWith(user.id, { listingId: listing.id, wantId: undefined });
  expect(lastTextTo(user)).toBe("cool, it's still up");
  expect((await db.getListing(listing.id))?.status).toBe("active");
});

test("👍 tapback on a stale want check keeps looking", async () => {
  const want = await staleWantAsked();
  await tapback(user, sentTo(user).at(-1)!.id, "👍");
  expect(markStillActive).toHaveBeenCalledWith(user.id, { listingId: undefined, wantId: want.id });
  expect(lastTextTo(user)).toBe("cool, still looking for you");
});

test("'sold it' after a stale listing check removes the listing", async () => {
  const listing = await staleListingAsked();
  await say(user, "sold it");
  expect((await db.getListing(listing.id))?.status).toBe("removed");
  expect(lastTextTo(user)).toBe("got it, took it down");
  expect(markStillActive).not.toHaveBeenCalled();
});

test("negated gone-words ('not sold yet', 'havent sold it') keep the listing instead of removing it", async () => {
  for (const text of ["not sold yet", "nope havent sold it", "yes still have it, not gone"]) {
    const listing = await staleListingAsked();
    await say(user, text);
    expect((await db.getListing(listing.id))?.status).toBe("active");
    expect(lastTextTo(user)).toBe("cool, it's still up");
  }
  const want = await staleWantAsked();
  await say(user, "nobody bought one yet");
  expect((await db.getWant(want.id))?.status).toBe("open");
});

test("a deal message after a stale check is not read as 'gone' while the user has an active match", async () => {
  const listing = await staleListingAsked();
  await db.createMatch({ listingId: listing.id, buyerId: other.id, sellerId: user.id });
  await say(user, "nvm see you at 4");
  expect((await db.getListing(listing.id))?.status).toBe("active");
  expect(lastTextTo(user)).not.toBe("got it, took it down");
});

test("'found one' after a stale want check cancels the want", async () => {
  const want = await staleWantAsked();
  await say(user, "found one already");
  expect((await db.getWant(want.id))?.status).toBe("closed");
  expect(lastTextTo(user)).toBe("got it, stopped looking");
});

test("👎 tapback on a stale want check cancels the want", async () => {
  const want = await staleWantAsked();
  await tapback(user, sentTo(user).at(-1)!.id, "👎");
  expect((await db.getWant(want.id))?.status).toBe("closed");
});

async function bidAsked() {
  const listing = await activeListing(user.id, 3000);
  const want = await openWant(other.id);
  const { sendTo } = await import("../../src/spectrum/send");
  await sendTo(user, "someone wants one around $15 (you're at $30). offer them a price?", { ref: { kind: "bid", listingId: listing.id, wantId: want.id } });
  return { listing, want };
}

test("a bare price after a bid ref calls answerBid with cents", async () => {
  const { listing, want } = await bidAsked();
  await say(user, "22");
  expect(answerBid).toHaveBeenCalledWith(user, { kind: "bid", listingId: listing.id, wantId: want.id }, { priceCents: 2200 });
  expect(lastTextTo(user)).toBe("sent your price");
});

test("'do $22' also counts as a price", async () => {
  await bidAsked();
  await say(user, "do $22");
  expect(answerBid.mock.calls[0]![2]).toEqual({ priceCents: 2200 });
});

test("'yes' after a bid ref calls answerBid yes; 'no' calls it with no", async () => {
  await bidAsked();
  await say(user, "yes");
  expect(answerBid.mock.calls[0]![2]).toEqual({ yes: true });
  await bidAsked();
  await say(user, "nope");
  expect(answerBid.mock.calls[1]![2]).toEqual({ yes: false });
});
