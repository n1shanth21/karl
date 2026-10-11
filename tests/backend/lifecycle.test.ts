// Lifecycle timers with a fake "now": check-in reminders (24 h, 48 h, never a 3rd) and the 48 h staleness sweep.
import { beforeEach, expect, test } from "bun:test";
import { bus } from "../../src/bus";
import { db } from "../../src/db";
import { markStillActive } from "../../src/flows/staleness";
import { tick } from "../../src/jobs";

const HOUR = 3_600_000;
const plus = (d: Date, hours: number) => new Date(d.getTime() + hours * HOUR);
const nyHour = (d: Date) =>
  Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(d));
/** The first moment at or after `from` whose New York hour is `hour` (12 = inside the send window, 3 = quiet hours). */
function nextNyHour(from: Date, hour: number): Date {
  let t = from;
  while (nyHour(t) !== hour) t = plus(t, 1);
  return t;
}

const seen = {
  reminder: [] as string[],
  ping: [] as { userId: string; listingId?: string; wantId?: string }[],
  closed: [] as { userId: string; listingId?: string; wantId?: string }[],
};
bus.on("checkin_reminder_due", (e) => void seen.reminder.push(e.matchId));
bus.on("stale_check_due", (e) => void seen.ping.push(e));
bus.on("stale_auto_closed", (e) => void seen.closed.push(e));

beforeEach(async () => {
  await db.reset();
  seen.reminder = [];
  seen.ping = [];
  seen.closed = [];
});

let n = 0;
const newUser = (extra: { phone?: string; spaceId?: string } = {}) =>
  db.createUser({ phone: extra.phone ?? `+1555010${1000 + n++}`, spaceId: extra.spaceId ?? "space" });
const draft = { title: "Desk lamp", description: "", category: "lamp", condition: "good" as const, priceCents: 1500, confidence: 0.9 };

async function activeListing(sellerId: string) {
  const l = await db.createListing({ sellerId, draft, photoId: null });
  return db.updateListing(l.id, { status: "active" });
}

// ---- check-in reminders ----
test("meetup nobody confirmed: reminder 24 h after check-in, again at 48 h, never a 3rd", async () => {
  const buyer = await newUser();
  const seller = await newUser();
  const listing = await activeListing(seller.id);
  const m = await db.createMatch({ listingId: listing.id, buyerId: buyer.id, sellerId: seller.id });
  const meetupAt = new Date("2026-10-11T14:00:00Z");
  await db.updateMatch(m.id, { status: "meetup_set", meetupAt });
  const checkin = plus(meetupAt, 0.5); // 10:30 New York

  await tick(plus(checkin, 23));
  expect(seen.reminder).toEqual([]);
  await tick(plus(checkin, 24));
  expect(seen.reminder).toEqual([m.id]);
  await tick(plus(checkin, 25)); // never more than once per 24 h
  expect(seen.reminder).toEqual([m.id]);
  await tick(plus(checkin, 48));
  expect(seen.reminder).toEqual([m.id, m.id]);
  await tick(plus(checkin, 72));
  await tick(plus(checkin, 96));
  expect(seen.reminder).toEqual([m.id, m.id]);
});

test("a completed meetup gets no reminder", async () => {
  const buyer = await newUser();
  const seller = await newUser();
  const listing = await activeListing(seller.id);
  const m = await db.createMatch({ listingId: listing.id, buyerId: buyer.id, sellerId: seller.id });
  const meetupAt = new Date("2026-10-11T14:00:00Z");
  await db.updateMatch(m.id, { status: "completed", meetupAt });
  await tick(plus(meetupAt, 25));
  expect(seen.reminder).toEqual([]);
});

// ---- staleness ----
test("stale ping after 48 h inside the send window, not at 3 AM", async () => {
  const seller = await newUser();
  const listing = await activeListing(seller.id);
  await tick(plus(listing.createdAt, 24));
  expect(seen.ping).toEqual([]);

  await tick(nextNyHour(plus(listing.createdAt, 50), 3)); // quiet hours
  expect(seen.ping).toEqual([]);

  const noon = nextNyHour(plus(listing.createdAt, 50), 12);
  await tick(noon);
  expect(seen.ping).toEqual([{ userId: seller.id, listingId: listing.id }]);
  await tick(plus(noon, 1)); // already asked, wait another 48 h
  expect(seen.ping.length).toBe(1);
});

test("want gets the same stale ping", async () => {
  const buyer = await newUser();
  const want = await db.createWant({ buyerId: buyer.id, queryText: "desk lamp", maxPriceCents: 1500 });
  await tick(nextNyHour(plus(want.createdAt, 50), 12));
  expect(seen.ping).toEqual([{ userId: buyer.id, wantId: want.id }]);
});

test("markStillActive restarts the 48 h clock", async () => {
  const seller = await newUser();
  const listing = await activeListing(seller.id);
  const p1 = nextNyHour(plus(listing.createdAt, 48), 12);
  await tick(p1);
  expect(seen.ping.length).toBe(1);

  const confirmedAt = plus(p1, 2);
  await markStillActive(seller.id, { listingId: listing.id }, confirmedAt);
  await tick(nextNyHour(plus(confirmedAt, 24), 12)); // well under 48 h since the 👍
  expect(seen.ping.length).toBe(1);
  await tick(nextNyHour(plus(confirmedAt, 48), 12));
  expect(seen.ping.length).toBe(2);
  expect(seen.closed).toEqual([]);
});

test("two unanswered pings: listing auto-closed, event logged, nothing after", async () => {
  const seller = await newUser();
  const listing = await activeListing(seller.id);
  const p1 = nextNyHour(plus(listing.createdAt, 48), 12);
  await tick(p1);
  await tick(plus(p1, 48));
  expect(seen.ping.length).toBe(2);
  expect((await db.getListing(listing.id))?.status).toBe("active");

  await tick(plus(p1, 96));
  expect((await db.getListing(listing.id))?.status).toBe("removed");
  expect(seen.closed).toEqual([{ userId: seller.id, listingId: listing.id }]);
  expect(await db.findEvents("stale_auto_closed", { userId: seller.id })).toHaveLength(1);
  await tick(plus(p1, 144));
  expect(seen.closed.length).toBe(1);
  expect(seen.ping.length).toBe(2);
});

test("two unanswered pings: want auto-closed", async () => {
  const buyer = await newUser();
  const want = await db.createWant({ buyerId: buyer.id, queryText: "desk lamp", maxPriceCents: 1500 });
  const p1 = nextNyHour(plus(want.createdAt, 48), 12);
  await tick(p1);
  await tick(plus(p1, 48));
  await tick(plus(p1, 96));
  expect((await db.getWant(want.id))?.status).toBe("closed");
  expect(seen.closed).toEqual([{ userId: buyer.id, wantId: want.id }]);
});

test("seed and opted-out users are never pinged or auto-closed", async () => {
  const seed = await newUser({ phone: "seed:ana", spaceId: "seed" });
  const quiet = await newUser();
  await db.updateUser(quiet.id, { optedOut: true });
  const a = await activeListing(seed.id);
  const b = await activeListing(quiet.id);
  const w = await db.createWant({ buyerId: quiet.id, queryText: "desk lamp", maxPriceCents: 1500 });
  const p1 = nextNyHour(plus(a.createdAt, 48), 12);
  for (const h of [0, 48, 96]) await tick(plus(p1, h));
  expect(seen.ping).toEqual([]);
  expect(seen.closed).toEqual([]);
  expect((await db.getListing(a.id))?.status).toBe("active");
  expect((await db.getListing(b.id))?.status).toBe("active");
  expect((await db.getWant(w.id))?.status).toBe("open");
});

// ---- one question at a time, and no questions during a deal ----
test("a seller with 3 stale listings gets one stale ping at a time", async () => {
  const seller = await newUser();
  const [a, b, c] = [await activeListing(seller.id), await activeListing(seller.id), await activeListing(seller.id)];
  const noon = nextNyHour(plus(a.createdAt, 50), 12);
  await tick(noon);
  expect(seen.ping.length).toBe(1);
  await tick(plus(noon, 1)); // still unanswered: no second question
  expect(seen.ping.length).toBe(1);

  const first = seen.ping[0]!.listingId!;
  await markStillActive(seller.id, { listingId: first }, plus(noon, 2)); // they answered
  await tick(plus(noon, 3));
  expect(seen.ping.length).toBe(2);
  expect(new Set([a.id, b.id, c.id]).has(seen.ping[1]!.listingId!)).toBe(true);
  expect(seen.ping[1]!.listingId).not.toBe(first);
});

test("a listing with a deal in progress is not stale", async () => {
  const buyer = await newUser();
  const seller = await newUser();
  const listing = await activeListing(seller.id);
  await db.createMatch({ listingId: listing.id, buyerId: buyer.id, sellerId: seller.id }); // proposed
  const noon = nextNyHour(plus(listing.createdAt, 200), 12);
  await tick(noon);
  expect(seen.ping).toEqual([]);
  expect(seen.closed).toEqual([]);
  expect((await db.getListing(listing.id))?.status).toBe("active");
});

test("a hold that just expired counts as activity (no stale ping right after)", async () => {
  const seller = await newUser();
  const listing = await activeListing(seller.id);
  await db.logEvent("hold_expired", { listingId: listing.id, payload: { at: plus(listing.createdAt, 40).toISOString() } });
  await tick(nextNyHour(plus(listing.createdAt, 50), 12)); // only ~10 h since the hold ran out
  expect(seen.ping).toEqual([]);
  await tick(nextNyHour(plus(listing.createdAt, 90), 12));
  expect(seen.ping.length).toBe(1);
});
