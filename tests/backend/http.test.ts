// Tests for the public HTTP routes: no phone numbers or last names ever leak, stats are cached.
import { beforeEach, expect, test } from "bun:test";
import { db } from "../../src/db";
import { http } from "../../src/http";
import { clearStatsCache, firstNameOnly, getPublicStats, scrubTitle } from "../../src/http/publicStats";

const PHONE = "+19195551234";

beforeEach(async () => {
  await db.reset();
  clearStatsCache();
});

async function seedListing(firstName: string, title: string) {
  const seller = await db.createUser({ phone: PHONE, spaceId: "s1" });
  await db.updateUser(seller.id, { firstName });
  const draft = { title, description: `call me at ${PHONE}`, category: "mini fridge", condition: "good" as const, priceCents: 4000, confidence: 0.9 };
  const listing = await db.createListing({ sellerId: seller.id, draft, photoId: null });
  await db.updateListing(listing.id, { status: "active" });
}

test("/api/stats never contains a phone number or last name", async () => {
  await seedListing("Maya Smith", "Mini fridge text 919-555-1234 or maya@gmail.com @mayasells");
  const res = await http.request("/api/stats");
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).not.toContain("Smith");
  expect(body).not.toContain("5551234");
  expect(body).not.toContain("555-1234");
  expect(body).not.toContain("919");
  expect(body).not.toContain("gmail");
  expect(body).not.toContain("@mayasells");
  const stats = JSON.parse(body);
  expect(stats.recent[0].sellerFirstName).toBe("Maya");
  expect(stats.recent[0].title).toBe("Mini fridge text or");
  expect(stats.listedTotal).toBe(1);
});

test("/health shows no secrets", async () => {
  const body = await (await http.request("/health")).text();
  expect(body).not.toMatch(/secret|key|postgres:\/\//i);
});

test("stats are cached for 3 seconds", async () => {
  const first = await getPublicStats(1_000_000);
  await seedListing("Jo", "Desk lamp");
  expect((await getPublicStats(1_002_000)).listedTotal).toBe(first.listedTotal); // still cached
  expect((await getPublicStats(1_003_000)).listedTotal).toBe(first.listedTotal + 1); // refreshed
});

test("firstNameOnly keeps one word", () => {
  expect(firstNameOnly("Maya Smith")).toBe("Maya");
  expect(firstNameOnly("  jo  ")).toBe("jo");
  expect(firstNameOnly("")).toBe("someone");
});

test("scrubTitle keeps normal titles untouched", () => {
  for (const title of ["Mini fridge", "TI-84 calculator", "IKEA desk 120x60", "$40 rug, 5x7", "2 lamps"]) {
    expect(scrubTitle(title)).toBe(title);
  }
  expect(scrubTitle("(919) 555 1234")).toBe("item");
  expect(scrubTitle("lamp see www.lamps.com")).toBe("lamp see");
});
