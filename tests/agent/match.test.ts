import { afterEach, beforeEach, expect, mock, setSystemTime, spyOn, test } from "bun:test";
import { bus } from "../../src/bus";
import { db } from "../../src/db";
import * as photo from "../../src/flows/photo";
import * as safety from "../../src/safety";
import { lookupRef } from "../../src/spectrum/refs";
import { clearLastRef, lastRefTo } from "../../src/spectrum/send";
import type { Listing, User } from "../../src/types";
import { fakeUser, lastTextTo, resetAll, sentTo } from "./helpers";

import { registerNotifications } from "../../src/agent/notifications";
import { cancelMatch, confirmHappened, proposeMatch, respondToMatch, setMeetup } from "../../src/flows/match";
import { meetupProposal } from "../../src/flows/meetup";
import { routeMessage } from "../../src/flows/relay";

registerNotifications(); // once: the bus is process-wide

let buyer: User;
let seller: User;
let scan: ReturnType<typeof spyOn>;

async function makeListing(sellerId: string, title: string, photoId: string | null = null): Promise<Listing> {
  const draft = { title, description: "works", category: title.toLowerCase(), condition: "good" as const, priceCents: 4500, confidence: 0.9 };
  const draftListing = await db.createListing({ sellerId, draft, photoId });
  return db.updateListing(draftListing.id, { status: "active" });
}

/** Propose and accept; returns the match id (meetup not picked yet). */
async function heldMatch(listing: Listing): Promise<string> {
  await proposeMatch(buyer, listing);
  const match = (await db.activeMatchesForUser(buyer.id)).find((m) => m.listingId === listing.id)!;
  await respondToMatch(seller, match.id, true);
  return match.id;
}

/** Held match with the meetup already picked, so the sides can chat freely. */
async function meetupMatch(listing: Listing): Promise<string> {
  const matchId = await heldMatch(listing);
  await setMeetup(buyer, matchId, "the Pit", new Date(Date.now() + 3_600_000));
  return matchId;
}

/** What Karl logged as sent to a user (the fake space only sees "[content]" for markdown). */
async function loggedTo(user: User): Promise<string[]> {
  return (await db.recentMessages(user.id, 50)).filter((m) => m.direction === "out").map((m) => m.text);
}

beforeEach(async () => {
  setSystemTime(new Date("2026-10-12T16:00:00Z")); // noon EDT, so "an hour from now" is a valid meetup time
  await resetAll();
  buyer = await fakeUser("Maya", "+15550001111");
  seller = await fakeUser("Sam", "+15550002222");
  scan = spyOn(safety, "scanRelayMessage").mockResolvedValue({ action: "allow" });
  spyOn(photo, "photoAttachment").mockImplementation(async (id) => (id ? ({ name: "photo.jpg" } as never) : null));
});

afterEach(() => {
  mock.restore();
  setSystemTime();
});

test("propose, accept, meetup, both confirm: listing sold", async () => {
  const listing = await makeListing(seller.id, "Mini fridge");
  const want = await db.createWant({ buyerId: buyer.id, queryText: "need a fridge for my dorm", maxPriceCents: 6000 });
  expect(await proposeMatch(buyer, listing)).toContain("asked the seller");
  expect(lastTextTo(seller)).toContain("someone wants your mini fridge at $45");
  const [match] = await db.activeMatchesForUser(buyer.id);
  expect(lookupRef(sentTo(seller).at(-1)!.id)).toEqual({ kind: "match_request", matchId: match!.id });

  const sellerReply = await respondToMatch(seller, match!.id, true);
  expect(sellerReply).toContain("numbers stay private");
  expect((await db.getMatch(match!.id))?.status).toBe("accepted");
  expect((await db.getListing(listing.id))?.status).toBe("held");
  expect(lastTextTo(buyer)).toBe("Sam said yes, the mini fridge is held for you for 2 hrs. the Pit at 1pm or Student Union lobby at 2pm? or suggest a time");

  expect(await setMeetup(buyer, match!.id, "the pit", new Date(Date.now() + 3_600_000))).toContain("only pay once you have it in hand");
  expect(lastTextTo(seller)).toContain("meetup set: the Pit at 1pm");
  expect(await setMeetup(buyer, match!.id, "my dorm room", new Date(Date.now() + 3_600_000))).toContain("the Pit");

  await confirmHappened(buyer, match!.id, true);
  expect((await db.getListing(listing.id))?.status).toBe("held");
  await confirmHappened(seller, match!.id, true);
  expect((await db.getListing(listing.id))?.status).toBe("sold");
  expect((await db.getMatch(match!.id))?.status).toBe("completed");
  expect((await db.getWant(want.id))?.status).toBe("matched");
  expect((await db.getUser(buyer.id))?.state.kind).toBe("idle");
});

test("refuses own, taken, and duplicate proposals", async () => {
  const listing = await makeListing(seller.id, "Desk lamp");
  expect(await proposeMatch(seller, listing)).toContain("your own");
  await proposeMatch(buyer, listing);
  expect(await proposeMatch(buyer, listing)).toContain("already asked");
  const held = await db.updateListing(listing.id, { status: "held" });
  expect(await proposeMatch(buyer, held)).toContain("just got taken");
});

test("decline keeps the listing active and tells the buyer", async () => {
  const listing = await makeListing(seller.id, "Desk lamp");
  await proposeMatch(buyer, listing);
  const [match] = await db.activeMatchesForUser(buyer.id);
  await respondToMatch(seller, match!.id, false);
  expect((await db.getMatch(match!.id))?.status).toBe("cancelled");
  expect((await db.getListing(listing.id))?.status).toBe("active");
  expect(lastTextTo(buyer)).toContain("isn't available");
});

test("a no at check-in cancels the match and frees the listing", async () => {
  const listing = await makeListing(seller.id, "Desk lamp");
  const matchId = await heldMatch(listing);
  await confirmHappened(buyer, matchId, false);
  expect((await db.getListing(listing.id))?.status).toBe("active");
  expect(lastTextTo(seller)).toContain("back up for sale");
  expect(await cancelMatch(seller, matchId)).toContain("can't find");
});

test("relay forwards with a bold label and no phone digits", async () => {
  const matchId = await meetupMatch(await makeListing(seller.id, "Mini fridge"));
  expect(await routeMessage(buyer, "omw, 5 min")).toBe("relayed");
  const forwarded = (await loggedTo(seller)).at(-1)!;
  expect(forwarded).toBe("**Maya · mini fridge**\nomw, 5 min");
  expect(forwarded).not.toMatch(/555|\d{4}/);
  expect(lookupRef(sentTo(seller).at(-1)!.id)).toEqual({ kind: "relay", matchId });
  expect(scan).toHaveBeenCalledWith("omw, 5 min");
});

test("blocked relay is not forwarded; warned relay adds a heads-up", async () => {
  await meetupMatch(await makeListing(seller.id, "Mini fridge"));
  const before = sentTo(seller).length;
  scan.mockResolvedValueOnce({ action: "block", reason: "no phone numbers please" });
  expect(await routeMessage(buyer, "text me at 919-555-0100")).toBe("blocked");
  expect(lastTextTo(buyer)).toBe("didn't pass that along: no phone numbers please");
  expect(sentTo(seller)).toHaveLength(before);

  scan.mockResolvedValueOnce({ action: "warn", reason: "don't pay before you see it" });
  expect(await routeMessage(buyer, "can you venmo me first")).toBe("relayed");
  expect(sentTo(seller)).toHaveLength(before + 2);
  expect(lastTextTo(seller)).toBe("heads up: don't pay before you see it");
});

test("two matches ask which; a reply target picks one", async () => {
  const fridge = await makeListing(seller.id, "Mini fridge");
  const lamp = await makeListing(seller.id, "Desk lamp");
  const fridgeMatch = await meetupMatch(fridge);
  await meetupMatch(lamp);

  expect(await routeMessage(buyer, "running late")).toBe("asked_which");
  expect(lastTextTo(buyer)).toContain("the mini fridge or the desk lamp");

  expect(await routeMessage(buyer, "running late", fridgeMatch)).toBe("relayed");
  expect((await loggedTo(seller)).at(-1)).toContain("mini fridge");
});

test("text addressed to Karl is not relayed", async () => {
  await meetupMatch(await makeListing(seller.id, "Mini fridge"));
  expect(await routeMessage(buyer, "karl cancel")).toBe("not_relay");
  expect(await routeMessage(buyer, "my stuff")).toBe("not_relay");
  expect(await routeMessage(await fakeUser("Zed"), "hello")).toBe("not_relay");
});

test("answers to Karl's own questions are not relayed, normal replies are", async () => {
  await meetupMatch(await makeListing(seller.id, "Mini fridge"));
  expect(await routeMessage(seller, "sounds good")).toBe("relayed");

  await db.saveOutbound({ userId: buyer.id, text: "did the mini fridge handoff happen? (👍 or 👎)" });
  expect(await routeMessage(buyer, "👍")).toBe("not_relay");
  expect(await routeMessage(buyer, "yes")).toBe("not_relay");
});

test("relayed text is markdown-escaped so it arrives verbatim, bold label intact", async () => {
  await meetupMatch(await makeListing(seller.id, "Mini fridge"));
  expect(await routeMessage(buyer, "# hi *x*")).toBe("relayed");
  const raw = sentTo(seller).at(-1)!.raw as { build(): Promise<unknown> };
  expect(await raw.build()).toEqual({ type: "markdown", markdown: "**Maya · mini fridge**\n\\# hi \\*x\\*" });
  expect((await loggedTo(seller)).at(-1)).toBe("**Maya · mini fridge**\n# hi *x*");
});

test("a yes-ish answer to a check-in question goes to Karl, not the other side", async () => {
  const matchId = await meetupMatch(await makeListing(seller.id, "Mini fridge"));
  bus.emit("meetup_checkin_due", { matchId });
  await Bun.sleep(50);
  expect(lastRefTo(buyer.id)).toEqual({ kind: "checkin", matchId });
  expect(await routeMessage(buyer, "yes it did, thanks!")).toBe("not_relay");
  clearLastRef(buyer.id);
  expect(await routeMessage(buyer, "need 10 more min")).toBe("relayed");
});

test("a reply to a match that isn't an active handoff is never relayed elsewhere", async () => {
  await meetupMatch(await makeListing(seller.id, "Mini fridge"));
  expect(await routeMessage(buyer, "running late", "no-such-match")).toBe("not_relay");
});

test("meetup times in the past or outside 9am-8pm are rejected", async () => {
  const matchId = await heldMatch(await makeListing(seller.id, "Mini fridge"));
  expect(await setMeetup(buyer, matchId, "the Pit", new Date(Date.now() - 3_600_000))).toContain("passed");
  expect((await db.getMatch(matchId))?.status).toBe("accepted");
  expect(await setMeetup(buyer, matchId, "the Pit", new Date("2026-10-13T03:00:00Z"))).toContain("9am and 8pm"); // 11pm EDT
  expect((await db.getMatch(matchId))?.status).toBe("accepted");
  expect(await setMeetup(buyer, matchId, "the Pit", new Date("2026-10-12T23:30:00Z"))).toContain("meetup set"); // 7:30pm EDT
});

test("accepting a match and offering a want leave a drafting_listing state alone", async () => {
  const listing = await makeListing(seller.id, "Mini fridge");
  const draft = { kind: "drafting_listing", listingId: "draft-1" } as const;
  await db.updateUser(seller.id, { state: draft });
  await heldMatch(listing);
  expect((await db.getUser(seller.id))?.state).toEqual(draft);

  const other = await makeListing(seller.id, "Desk lamp");
  const want = await db.createWant({ buyerId: buyer.id, queryText: "lamp", maxPriceCents: null });
  await db.updateUser(buyer.id, { state: draft });
  bus.emit("match_found", { wantId: want.id, listingId: other.id, buyerId: buyer.id, score: 0.9 });
  await Bun.sleep(50);
  expect((await db.getUser(buyer.id))?.state).toEqual(draft);
});

test("while the meetup is still being picked, replies go to Karl, not the other side", async () => {
  await heldMatch(await makeListing(seller.id, "Mini fridge"));
  expect(await routeMessage(buyer, "the pit at noon works")).toBe("not_relay");
});

test("match_found offers the listing with a photo, a ref, and choosing_result state", async () => {
  const photoId = await db.savePhoto(new Uint8Array([1]), "image/jpeg");
  const listing = await makeListing(seller.id, "Mini fridge", photoId);
  const want = await db.createWant({ buyerId: buyer.id, queryText: "fridge", maxPriceCents: null });

  bus.emit("match_found", { wantId: want.id, listingId: listing.id, buyerId: buyer.id, score: 0.9 });
  bus.emit("match_found", { wantId: want.id, listingId: listing.id, buyerId: buyer.id, score: 0.9 });
  await Bun.sleep(50);

  expect(sentTo(buyer)).toHaveLength(2); // photo + offer, only once
  expect(lastTextTo(buyer)).toBe("someone just listed a mini fridge, $45. want it? (❤️ or yes)");
  const offerRef = { kind: "offer", listingId: listing.id, wantId: want.id } as const;
  expect(lookupRef(sentTo(buyer).at(-1)!.id)).toEqual(offerRef);
  expect(lookupRef(sentTo(buyer)[0]!.id)).toEqual(offerRef); // the photo carries the same ref
  expect((await db.getUser(buyer.id))?.state).toEqual({ kind: "choosing_result", listingIds: [listing.id] });
});

test("check-in and hold-expired notices go to both sides", async () => {
  const matchId = await heldMatch(await makeListing(seller.id, "Mini fridge"));

  bus.emit("meetup_checkin_due", { matchId });
  await Bun.sleep(50);
  for (const user of [buyer, seller]) expect(lastTextTo(user)).toBe("did the mini fridge handoff happen? (👍 or 👎)");
  expect(lookupRef(sentTo(buyer).at(-1)!.id)).toEqual({ kind: "checkin", matchId });

  await db.updateMatch(matchId, { status: "expired" });
  bus.emit("hold_expired", { matchId });
  await Bun.sleep(50);
  expect(lastTextTo(buyer)).toContain("hold on the mini fridge ran out");
  expect((await db.getUser(buyer.id))?.state.kind).toBe("idle");
});

test("meetup options are daytime New York slots", () => {
  expect(meetupProposal(new Date("2026-10-12T18:10:00Z"))).toBe("the Pit at 3:30pm or Student Union lobby at 4:30pm? or suggest a time"); // 2:10pm EDT
  expect(meetupProposal(new Date("2026-10-12T22:00:00Z"))).toContain("the Pit tomorrow at 12pm"); // 6pm EDT
  expect(meetupProposal(new Date("2026-10-12T07:00:00Z"))).toContain("the Pit tomorrow at 12pm"); // 3am EDT
});
