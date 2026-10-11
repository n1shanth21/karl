// No ghost orders, part 2: stuck meetups close 24 h after the 2nd reminder; unanswered proposals expire at 24 h.
// Memory DB + a fake clock (setSystemTime for creation times, `now` passed to tick). Texts go to fake spaces.
import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { registerLifecycle } from "../../src/agent/lifecycle";
import { registerNotifications } from "../../src/agent/notifications";
import { bus } from "../../src/bus";
import { db } from "../../src/db";
import { holdAtPrice } from "../../src/flows/holds";
import { answerBid, makeOffer } from "../../src/flows/offers";
import { proposeMatch } from "../../src/flows/match";
import { tick } from "../../src/jobs";
import { lastRefTo } from "../../src/spectrum/send";
import type { Listing, User } from "../../src/types";
import { fakeUser, resetAll, sentTo } from "../agent/helpers";

registerLifecycle();
registerNotifications();

const HOUR = 3_600_000;
const plus = (d: Date, hours: number) => new Date(d.getTime() + hours * HOUR);
const settle = () => new Promise((r) => setTimeout(r, 30));
const textsTo = (u: User, startsWith: string) => sentTo(u).map((m) => m.text).filter((t) => t.startsWith(startsWith));

const seen = { closed: [] as string[], expired: [] as string[] };
bus.on("deal_auto_closed", (e) => void seen.closed.push(e.matchId));
bus.on("proposal_expired", (e) => void seen.expired.push(e.matchId));

let buyer: User;
let seller: User;

beforeEach(async () => {
  await resetAll();
  seen.closed = [];
  seen.expired = [];
  setSystemTime(new Date("2026-10-12T16:00:00Z")); // 12:00 New York: inside the 10:00-20:00 window
  buyer = await fakeUser("Maya", "+15550009001");
  seller = await fakeUser("Sam", "+15550009002");
});
afterEach(() => setSystemTime());

async function activeListing(priceCents = 3000): Promise<Listing> {
  const draft = { title: "Water bottle", description: "", category: "water bottle", condition: "good" as const, priceCents, confidence: 0.9 };
  const l = await db.createListing({ sellerId: seller.id, draft, photoId: null });
  return db.updateListing(l.id, { status: "active" });
}

// ---- stuck deals ----
test("stuck deal: closed once, 24 h after the 2nd reminder; listing back at its ask, want reopened, both texted once", async () => {
  const listing = await activeListing(3000);
  const want = await db.createWant({ buyerId: buyer.id, queryText: "water bottle", maxPriceCents: 1500 });
  bus.emit("spread_found", { wantId: want.id, listingId: listing.id, buyerId: buyer.id, sellerId: seller.id }); // Karl pinged this want
  await settle();

  const match = await db.createMatch({ listingId: listing.id, buyerId: buyer.id, sellerId: seller.id });
  await db.updateWantStatus(want.id, "matched");
  await holdAtPrice(listing, 2000); // negotiated price applied on accept
  const meetupAt = new Date("2026-10-13T14:00:00Z");
  await db.updateMatch(match.id, { status: "meetup_set", meetupAt });
  const checkin = plus(meetupAt, 0.5); // 10:30 New York

  await tick(plus(checkin, 24)); // reminder 1
  await tick(plus(checkin, 48)); // reminder 2
  await tick(plus(checkin, 71)); // only 23 h after the last reminder
  expect((await db.getMatch(match.id))?.status).toBe("meetup_set");
  expect(seen.closed).toEqual([]);

  await tick(plus(checkin, 72));
  await settle();
  expect(seen.closed).toEqual([match.id]);
  expect((await db.getMatch(match.id))?.status).toBe("expired");
  const back = await db.getListing(listing.id);
  expect([back?.status, back?.priceCents]).toEqual(["active", 3000]);
  expect((await db.getWant(want.id))?.status).toBe("open");
  expect(await db.findEvents("deal_auto_closed", { listingId: listing.id })).toHaveLength(1);

  for (const h of [73, 96, 120]) await tick(plus(checkin, h)); // idempotent
  await settle();
  expect(seen.closed).toEqual([match.id]);
  expect(textsTo(seller, "closed out")).toEqual(["closed out the water bottle deal since i didn't hear back. it's listed again, text me if it actually sold"]);
  expect(textsTo(buyer, "closed out")).toEqual(["closed out the water bottle deal since i didn't hear back. want me to keep looking? (👍/👎)"]);
  expect(lastRefTo(buyer.id)).toEqual({ kind: "still_active", wantId: want.id });
});

test("a meetup confirmed by both sides is never closed", async () => {
  const listing = await activeListing();
  const match = await db.createMatch({ listingId: listing.id, buyerId: buyer.id, sellerId: seller.id });
  const meetupAt = new Date("2026-10-13T14:00:00Z");
  await db.updateMatch(match.id, { status: "completed", meetupAt });
  for (const h of [24, 48, 72, 96]) await tick(plus(meetupAt, h));
  expect(seen.closed).toEqual([]);
});

test("stuck deal waits for the send window (nothing at 3 AM, closes at 10:00)", async () => {
  const listing = await activeListing();
  const match = await db.createMatch({ listingId: listing.id, buyerId: buyer.id, sellerId: seller.id });
  const meetupAt = new Date("2026-10-13T14:00:00Z");
  await db.updateMatch(match.id, { status: "meetup_set", meetupAt });
  const checkin = plus(meetupAt, 0.5);
  await tick(plus(checkin, 24));
  await tick(plus(checkin, 48));

  await tick(plus(checkin, 72 + 17)); // 03:30 New York, long past due
  expect(seen.closed).toEqual([]);
  await tick(plus(checkin, 72 + 23.5)); // 10:00 New York
  expect(seen.closed).toEqual([match.id]);
});

// ---- unanswered proposals ----
test("plain request: expires at 24 h (not 23 h), only the buyer is texted, listing stays up", async () => {
  const listing = await activeListing();
  const want = await db.createWant({ buyerId: buyer.id, queryText: "water bottle", maxPriceCents: 4000 });
  bus.emit("match_found", { wantId: want.id, listingId: listing.id, buyerId: buyer.id, score: 1 });
  await settle();
  expect(await proposeMatch(buyer, listing)).toContain("asked the seller");
  const [match] = await db.activeMatchesForUser(buyer.id);
  expect((await db.getWant(want.id))?.status).toBe("matched");

  await tick(plus(match!.createdAt, 23));
  await settle();
  expect((await db.getMatch(match!.id))?.status).toBe("proposed");
  expect(seen.expired).toEqual([]);

  await tick(plus(match!.createdAt, 24));
  await settle();
  expect(seen.expired).toEqual([match!.id]);
  expect((await db.getMatch(match!.id))?.status).toBe("expired");
  expect((await db.getListing(listing.id))?.status).toBe("active");
  expect((await db.getWant(want.id))?.status).toBe("open");

  for (const h of [25, 48]) await tick(plus(match!.createdAt, h));
  await settle();
  expect(seen.expired).toEqual([match!.id]);
  expect(textsTo(buyer, "no answer")).toEqual(["no answer on the water bottle after a day, so i let it go. i'll keep looking for you"]);
  expect(textsTo(seller, "they didn't")).toEqual([]);
});

test("buyer's lowball offer unanswered: buyer is the one texted; listing keeps its ask", async () => {
  const listing = await activeListing(3000);
  await makeOffer(buyer, listing, 2000);
  const [match] = await db.activeMatchesForUser(buyer.id);
  await tick(plus(match!.createdAt, 24));
  await settle();
  expect(textsTo(buyer, "no answer")).toHaveLength(1);
  expect(textsTo(seller, "they didn't")).toEqual([]);
  expect((await db.getListing(listing.id))?.priceCents).toBe(3000);
});

test("seller's bid offer unanswered: only the seller is texted, 'still listed at $X'", async () => {
  const listing = await activeListing(3000);
  const want = await db.createWant({ buyerId: buyer.id, queryText: "water bottle", maxPriceCents: 1500 });
  expect(await answerBid(seller, { listingId: listing.id, wantId: want.id }, { priceCents: 2000 })).toContain("sent");
  const [match] = await db.activeMatchesForUser(buyer.id);
  await tick(plus(match!.createdAt, 23));
  await tick(plus(match!.createdAt, 24));
  await tick(plus(match!.createdAt, 30));
  await settle();
  expect(seen.expired).toEqual([match!.id]);
  expect(textsTo(seller, "they didn't")).toEqual(["they didn't answer about the water bottle, so it's still listed at $30"]);
  expect(textsTo(buyer, "no answer")).toEqual([]);
});

test("proposal due in quiet hours waits until 10:00 New York", async () => {
  setSystemTime(new Date("2026-10-12T05:00:00Z")); // 01:00 New York
  const listing = await activeListing();
  await proposeMatch(buyer, listing);
  const [match] = await db.activeMatchesForUser(buyer.id);

  await tick(plus(match!.createdAt, 24)); // 01:00 next day
  await tick(plus(match!.createdAt, 30)); // 07:00
  await tick(plus(match!.createdAt, 32.5)); // 09:30
  await settle();
  expect(seen.expired).toEqual([]);
  expect((await db.getMatch(match!.id))?.status).toBe("proposed");

  await tick(plus(match!.createdAt, 33)); // 10:00
  await settle();
  expect(seen.expired).toEqual([match!.id]);
  expect(textsTo(buyer, "no answer")).toHaveLength(1);
});

test("an accepted deal holding the listing is not released when another buyer's proposal expires", async () => {
  const listing = await activeListing();
  const other = await fakeUser("Jo", "+15550009003");
  const stale = await db.createMatch({ listingId: listing.id, buyerId: other.id, sellerId: seller.id });
  const held = await db.createMatch({ listingId: listing.id, buyerId: buyer.id, sellerId: seller.id });
  await db.updateMatch(held.id, { status: "accepted", holdExpiresAt: plus(new Date(), 72) });
  await db.updateListing(listing.id, { status: "held" });
  await tick(plus(stale.createdAt, 24));
  expect((await db.getMatch(stale.id))?.status).toBe("expired");
  expect((await db.getListing(listing.id))?.status).toBe("held");
});
