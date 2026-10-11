// Near-miss pings: a listing a bit over a buyer's max still pings them (up to 1.5x), worded honestly.
import { afterEach, beforeEach, expect, mock, test as baseTest } from "bun:test";
import { registerNotifications } from "../../src/agent/notifications";
import { bus } from "../../src/bus";
import { config } from "../../src/config";
import { db } from "../../src/db";
import { onListingActivated, onWantCreated } from "../../src/matching";
import { fakeUser, lastTextTo, resetAll, sentTo } from "./helpers";

const test = config.dbMode === "postgres" ? baseTest.skip : baseTest;
registerNotifications();

const found: string[] = [];
bus.on("match_found", (e) => void found.push(e.buyerId));

beforeEach(async () => {
  found.length = 0;
  await resetAll();
});
afterEach(() => mock.restore());

/** Buyer wants a water bottle (optionally with a max), seller lists one at priceCents. */
async function scenario(maxPriceCents: number | null, priceCents: number) {
  const buyer = await fakeUser("Nishanth", "+15550003001");
  const seller = await fakeUser("Aarush", "+15550003002");
  await onWantCreated(await db.createWant({ buyerId: buyer.id, queryText: "water bottle", maxPriceCents }));
  const draft = { title: "Water bottle", description: "steel water bottle", category: "water bottle", condition: "good" as const, priceCents, confidence: 0.9 };
  const listing = await db.updateListing((await db.createListing({ sellerId: seller.id, draft, photoId: null })).id, { status: "active" });
  await onListingActivated(listing);
  for (let i = 0; i < 100 && sentTo(buyer).length === 0 && found.length > 0; i++) await new Promise((r) => setTimeout(r, 5));
  return buyer;
}

test("$14 listing vs a $10 max pings with 'a bit over' wording", async () => {
  const buyer = await scenario(1000, 1400);
  expect(found).toEqual([buyer.id]);
  expect(lastTextTo(buyer)).toContain("a bit over your $10");
  expect(lastTextTo(buyer)).toContain("offer $10");
});

test("$40 listing vs a $10 max (over 3x) does not ping", async () => {
  const buyer = await scenario(1000, 4000);
  expect(found).toEqual([]);
  expect(sentTo(buyer)).toEqual([]);
});

test("exactly 1.5x still pings", async () => {
  await scenario(1000, 1500);
  expect(found.length).toBe(1);
});

test("no max pings with the normal wording", async () => {
  const buyer = await scenario(null, 2000);
  expect(found).toEqual([buyer.id]);
  expect(lastTextTo(buyer)).toContain("want it? (❤️ or yes)");
  expect(lastTextTo(buyer)).not.toContain("a bit over");
});

test("in-budget listing keeps the original wording", async () => {
  const buyer = await scenario(1000, 800);
  expect(found).toEqual([buyer.id]);
  expect(lastTextTo(buyer)).toBe("someone just listed a water bottle, $8. want it? (❤️ or yes)");
});
