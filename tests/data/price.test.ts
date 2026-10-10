// suggestPriceCents: median of sold comps in the category, rounded to $1. Memory db only (no Gemini).
import { afterAll, beforeEach, expect, test } from "bun:test";
import { createMemoryDb } from "../../src/db/memory";
import { db } from "../../src/db";
import { suggestPriceCents } from "../../src/matching/price";

// Point the shared db at a fresh memory db for each test, and put the original back afterwards.
const original = { ...db };
afterAll(() => {
  Object.assign(db, original);
});
beforeEach(() => {
  Object.assign(db, createMemoryDb());
});

let n = 0;
async function sold(category: string, priceCents: number) {
  const seller = await db.createUser({ phone: `+1555030${String(++n).padStart(4, "0")}`, spaceId: "s" });
  const draft = { title: "thing", description: "x", category, condition: "good" as const, priceCents, confidence: 1 };
  const l = await db.createListing({ sellerId: seller.id, draft, photoId: null });
  await db.updateListing(l.id, { status: "sold" });
}

test("fewer than 3 comps gives null", async () => {
  expect(await suggestPriceCents("mini fridge")).toBeNull();
  await sold("mini fridge", 4000);
  await sold("mini fridge", 5000);
  expect(await suggestPriceCents("mini fridge")).toBeNull();
});

test("3 comps gives the median", async () => {
  for (const p of [6000, 3000, 4500]) await sold("mini fridge", p);
  expect(await suggestPriceCents("mini fridge")).toBe(4500);
});

test("an even count averages the middle two, then rounds to the nearest dollar", async () => {
  for (const p of [3000, 4000, 4999, 8000]) await sold("desk lamp", p); // middle two: 4000, 4999 -> 4499.5 -> $45
  expect(await suggestPriceCents("desk lamp")).toBe(4500);
});

test("a median that is not a whole dollar is rounded", async () => {
  for (const p of [1000, 2049, 5000]) await sold("textbook", p); // 2049 -> $20
  expect(await suggestPriceCents("textbook")).toBe(2000);
});

test("other categories are ignored", async () => {
  for (const p of [4000, 4500, 5000]) await sold("mini fridge", p);
  for (const p of [100, 200, 300]) await sold("desk lamp", p);
  expect(await suggestPriceCents("mini fridge")).toBe(4500);
  expect(await suggestPriceCents("couch")).toBeNull();
});

test("category match is case-insensitive", async () => {
  for (const p of [4000, 4500, 5000]) await sold("Mini Fridge", p);
  expect(await suggestPriceCents("mini fridge")).toBe(4500);
  expect(await suggestPriceCents("MINI FRIDGE")).toBe(4500);
});

test("draft and active listings do not count as comps", async () => {
  for (const p of [4000, 4500]) await sold("mini fridge", p);
  const seller = await db.createUser({ phone: "+15550399999", spaceId: "s" });
  const draft = { title: "t", description: "x", category: "mini fridge", condition: "good" as const, priceCents: 9900, confidence: 1 };
  const l = await db.createListing({ sellerId: seller.id, draft, photoId: null });
  await db.updateListing(l.id, { status: "active" });
  expect(await suggestPriceCents("mini fridge")).toBeNull();
});
