// Proactive ping rules shared by the vector and keyword paths (src/matching/semantic.ts pingBuyers).
// Runs on the memory db, so it needs no database or Gemini.
import { afterAll, beforeEach, expect, test } from "bun:test";
import { bus } from "../../src/bus";
import { LIMITS } from "../../src/config";
import { createMemoryDb } from "../../src/db/memory";
import { db } from "../../src/db";
import { PING_EVENT, pingBuyers } from "../../src/matching/semantic";

const pinged: string[] = [];
bus.on("match_found", (e) => {
  pinged.push(`${e.buyerId}:${e.listingId}`);
});

// Point the shared db at a fresh memory db for each test, and put the original back afterwards
// so other test files (which may run on postgres) are unaffected.
const original = { ...db };
afterAll(() => {
  Object.assign(db, original);
});
beforeEach(() => {
  Object.assign(db, createMemoryDb());
  pinged.length = 0;
});

async function setup() {
  const buyer = await db.createUser({ phone: "+15550200001", spaceId: "b" });
  const seller = await db.createUser({ phone: "+15550200002", spaceId: "s" });
  const want = await db.createWant({ buyerId: buyer.id, queryText: "mini fridge", maxPriceCents: null });
  const draft = { title: "Mini fridge", description: "cold", category: "mini fridge", condition: "good" as const, priceCents: 4000, confidence: 1 };
  const listing = await db.updateListing((await db.createListing({ sellerId: seller.id, draft, photoId: null })).id, { status: "active" });
  return { buyer, want, listing };
}

test("a buyer is pinged once per listing, even if the listing is activated again (relisted)", async () => {
  const { buyer, want, listing } = await setup();
  await pingBuyers(listing, [{ want, score: 0.8 }]);
  await pingBuyers(listing, [{ want, score: 0.8 }]);
  expect(pinged).toEqual([`${buyer.id}:${listing.id}`]);
});

test("the daily cap applies to every path that uses pingBuyers", async () => {
  const { buyer, want, listing } = await setup();
  for (let i = 0; i < LIMITS.maxProactivePingsPerUserPerDay; i++) await db.logEvent(PING_EVENT, { userId: buyer.id });
  await pingBuyers(listing, [{ want, score: 0.9 }]);
  expect(pinged).toEqual([]);
});

test("countEventsSince can be narrowed to one listing", async () => {
  const { buyer, listing } = await setup();
  await db.logEvent(PING_EVENT, { userId: buyer.id, listingId: listing.id });
  await db.logEvent(PING_EVENT, { userId: buyer.id, listingId: crypto.randomUUID() });
  const since = new Date(0);
  expect(await db.countEventsSince(PING_EVENT, { userId: buyer.id, since })).toBe(2);
  expect(await db.countEventsSince(PING_EVENT, { userId: buyer.id, since, listingId: listing.id })).toBe(1);
});
