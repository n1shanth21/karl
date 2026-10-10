// Phase 0 smoke test: the shared contracts work together in memory mode.
import { expect, test as baseTest } from "bun:test";
import { config } from "../../src/config";
import { bus } from "../../src/bus";
import { db } from "../../src/db";
import { onListingActivated, onWantCreated, searchListings } from "../../src/matching";

// These touch the shared db: never run them against the real postgres database.
const test = config.dbMode === "postgres" ? baseTest.skip : baseTest;

test("want -> listing fires match_found, search finds it", async () => {
  await db.reset();
  const buyer = await db.createUser({ phone: "+15550000001", spaceId: "s1" });
  const seller = await db.createUser({ phone: "+15550000002", spaceId: "s2" });

  const fired: string[] = [];
  bus.on("match_found", (e) => {
    fired.push(e.buyerId);
  });

  const want = await db.createWant({ buyerId: buyer.id, queryText: "need a mini fridge for my dorm", maxPriceCents: 6000 });
  await onWantCreated(want);

  const draft = { title: "Mini fridge", description: "works great", category: "mini fridge", condition: "good" as const, priceCents: 4500, confidence: 0.9 };
  const listing = await db.updateListing((await db.createListing({ sellerId: seller.id, draft, photoId: null })).id, { status: "active" });
  await onListingActivated(listing);

  expect(fired).toEqual([buyer.id]);
  const results = await searchListings("mini fridge");
  expect(results[0]?.listing.id).toBe(listing.id);
});

test("duplicate inbound message ids are ignored", async () => {
  const user = await db.createUser({ phone: "+15550000003", spaceId: "s3" });
  expect(await db.saveInbound({ userId: user.id, text: "hi", platformMessageId: "m1" })).toBe(true);
  expect(await db.saveInbound({ userId: user.id, text: "hi", platformMessageId: "m1" })).toBe(false);
});
