// Tests for tick(): memory DB + a fake "now". Each event must fire exactly once.
import { beforeEach, expect, test } from "bun:test";
import { bus } from "../../src/bus";
import { LIMITS } from "../../src/config";
import { db } from "../../src/db";
import type { ListingStatus, Match } from "../../src/types";
import { tick } from "../../src/jobs";

const MIN = 60_000;
const NOW = new Date("2026-10-11T15:00:00Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MIN);
const later = (minutes: number) => new Date(NOW.getTime() + minutes * MIN);

const events = { hold: [] as string[], checkin: [] as string[], want: [] as string[] };
bus.on("hold_expired", (e) => void events.hold.push(e.matchId));
bus.on("meetup_checkin_due", (e) => void events.checkin.push(e.matchId));
bus.on("want_expired", (e) => void events.want.push(e.wantId));

beforeEach(async () => {
  await db.reset();
  events.hold = [];
  events.checkin = [];
  events.want = [];
});

let phoneCounter = 0;
async function makeMatch(listingStatus: ListingStatus, patch: Partial<Match>): Promise<Match> {
  const buyer = await db.createUser({ phone: `+1555000${1000 + phoneCounter++}`, spaceId: "b" });
  const seller = await db.createUser({ phone: `+1555000${1000 + phoneCounter++}`, spaceId: "s" });
  const draft = { title: "Mini fridge", description: "", category: "mini fridge", condition: "good" as const, priceCents: 4000, confidence: 0.9 };
  const listing = await db.createListing({ sellerId: seller.id, draft, photoId: null });
  await db.updateListing(listing.id, { status: listingStatus });
  const match = await db.createMatch({ listingId: listing.id, buyerId: buyer.id, sellerId: seller.id });
  return db.updateMatch(match.id, patch);
}

test("expired hold: match expired, listing active, one hold_expired event", async () => {
  const match = await makeMatch("held", { status: "accepted", holdExpiresAt: ago(1) });
  await tick(NOW);
  await tick(NOW);
  expect((await db.getMatch(match.id))?.status).toBe("expired");
  expect((await db.getListing(match.listingId))?.status).toBe("active");
  expect(events.hold).toEqual([match.id]);
});

test("hold that hasn't run out is left alone", async () => {
  const match = await makeMatch("held", { status: "accepted", holdExpiresAt: later(30) });
  await tick(NOW);
  expect((await db.getMatch(match.id))?.status).toBe("accepted");
  expect((await db.getListing(match.listingId))?.status).toBe("held");
  expect(events.hold).toEqual([]);
});

test("a sold listing is never set back to active", async () => {
  const match = await makeMatch("sold", { status: "accepted", holdExpiresAt: ago(1) });
  await tick(NOW);
  expect((await db.getListing(match.listingId))?.status).toBe("sold");
});

test("due meetup: meetup_checkin_due fires exactly once across two ticks", async () => {
  const match = await makeMatch("held", { status: "meetup_set", meetupAt: ago(LIMITS.meetupCheckinDelayMin + 1) });
  await tick(NOW);
  await tick(new Date(NOW.getTime() + MIN));
  expect(events.checkin).toEqual([match.id]);
});

test("meetup that isn't due yet gets no check-in", async () => {
  await makeMatch("held", { status: "meetup_set", meetupAt: ago(LIMITS.meetupCheckinDelayMin - 5) });
  await tick(NOW);
  expect(events.checkin).toEqual([]);
});

test("meetups older than 12 hours are not asked about", async () => {
  await makeMatch("held", { status: "meetup_set", meetupAt: ago(LIMITS.meetupCheckinDelayMin + 13 * 60) });
  await tick(NOW);
  expect(events.checkin).toEqual([]);
});

test("expired want: closed and one want_expired event", async () => {
  const buyer = await db.createUser({ phone: "+15550009999", spaceId: "b" });
  const want = await db.createWant({ buyerId: buyer.id, queryText: "mini fridge", maxPriceCents: 6000 });
  const afterExpiry = new Date(want.expiresAt.getTime() + MIN);
  await tick(afterExpiry);
  await tick(afterExpiry);
  expect((await db.getWant(want.id))?.status).toBe("closed");
  expect(events.want).toEqual([want.id]);
});

test("fresh want is left open", async () => {
  const buyer = await db.createUser({ phone: "+15550008888", spaceId: "b" });
  const want = await db.createWant({ buyerId: buyer.id, queryText: "desk lamp", maxPriceCents: null });
  await tick(new Date());
  expect((await db.getWant(want.id))?.status).toBe("open");
  expect(events.want).toEqual([]);
});
