// backfillEmbeddings + the postgres keyword fallback, against a throwaway pgvector test schema.
// Gemini is never called: a counting fake embedder is injected with setEmbedder.
// The db singleton is patched onto the test-schema db and restored afterwards (same trick as matching.test.ts).
//
// The keyword fallback is tested through the exported keywordSearchFromDb(), not through searchListings():
// searchListings only takes the postgres branch when DB_MODE=postgres was set at import time, which
// would make the test depend on how it was launched. The helper is exactly what that branch calls.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { db as singleton } from "../../src/db";
import type { Db } from "../../src/db/types";
import { backfillEmbeddings, keywordSearchFromDb } from "../../src/matching";
import { setEmbedder } from "../../src/matching/embed";
import { SEARCH_MIN_SCORE } from "../../src/matching/thresholds";
import type { Listing } from "../../src/types";
import { fakeEmbedder, hasDatabase, makeTestDb, newUser, vecFor } from "./helpers";

setDefaultTimeout(30_000);

describe.skipIf(!hasDatabase)("backfill + keyword fallback (postgres test schema)", () => {
  let testDb: Db;
  let cleanup: (() => Promise<void>) | undefined;
  const originals = new Map<string, unknown>();
  const target = singleton as unknown as Record<string, unknown>;
  let calls: string[][] = [];

  beforeAll(async () => {
    const t = await makeTestDb("postgres");
    testDb = t.db;
    cleanup = t.cleanup;
    for (const key of Object.keys(testDb) as (keyof Db)[]) {
      originals.set(key, target[key]);
      target[key] = testDb[key];
    }
  });
  afterAll(async () => {
    for (const [key, fn] of originals) target[key] = fn;
    await cleanup?.();
  });
  beforeEach(async () => {
    await testDb.reset();
    calls = [];
    setEmbedder(async (texts) => {
      calls.push(texts);
      return fakeEmbedder(texts);
    });
  });
  afterEach(() => setEmbedder(null));

  async function activeListing(sellerId: string, title: string, desc: string, priceCents = 4500): Promise<Listing> {
    const l = await testDb.createListing({
      sellerId,
      draft: { title, description: desc, category: title.toLowerCase(), condition: "good", priceCents, confidence: 0.9 },
      photoId: null,
    });
    return testDb.updateListing(l.id, { status: "active" });
  }

  test("embeds every missing listing in ONE call and every want, then a second run does nothing", async () => {
    const seller = await newUser(testDb);
    const buyer = await newUser(testDb);
    const fridge = await activeListing(seller.id, "Mini fridge", "cold drinks");
    const lamp = await activeListing(seller.id, "Desk lamp", "bright");
    await testDb.createListing({ sellerId: seller.id, draft: { title: "Draft", description: "d", category: "x", condition: "good", priceCents: 100, confidence: 1 }, photoId: null }); // draft: ignored
    const want = await testDb.createWant({ buyerId: buyer.id, queryText: "mini fridge", maxPriceCents: null });
    await testDb.createWant({ buyerId: buyer.id, queryText: "desk lamp", maxPriceCents: null });

    expect(await backfillEmbeddings()).toEqual({ listings: 2, wants: 2 });
    expect(calls.filter((c) => c.some((t) => t.startsWith("title: "))).length).toBe(1); // one document batch
    expect(calls.find((c) => c.some((t) => t.startsWith("title: ")))).toHaveLength(2);

    // searchable by vector now
    const hits = await testDb.searchListingsByVector(vecFor("mini fridge"), { minScore: SEARCH_MIN_SCORE, limit: 5 });
    expect(hits.map((h) => h.listing.id)).toEqual([fridge.id]);
    const lampHits = await testDb.searchListingsByVector(vecFor("desk lamp"), { minScore: SEARCH_MIN_SCORE, limit: 5 });
    expect(lampHits.map((h) => h.listing.id)).toEqual([lamp.id]);
    // and the want is matchable
    const matches = await testDb.openWantsByVector(vecFor("mini fridge cold drinks"), { priceCents: 4500, excludeBuyerId: seller.id, minScore: 0.5 });
    expect(matches.map((m) => m.want.id)).toContain(want.id);
    expect(await testDb.activeListingsMissingEmbedding()).toHaveLength(0);
    expect(await testDb.openWantsMissingEmbedding()).toHaveLength(0);

    calls = [];
    expect(await backfillEmbeddings()).toEqual({ listings: 0, wants: 0 });
    expect(calls).toHaveLength(0);
  });

  test("nothing to do means no embedder call", async () => {
    expect(await backfillEmbeddings()).toEqual({ listings: 0, wants: 0 });
    expect(calls).toHaveLength(0);
  });

  test("keyword fallback reads listings from the database (not this process's Maps), with filters", async () => {
    setEmbedder(async () => {
      throw new Error("gemini down");
    });
    const seller = await newUser(testDb);
    const other = await newUser(testDb);
    const fridge = await activeListing(seller.id, "Mini fridge", "cold drinks", 4000);
    await activeListing(other.id, "Mini fridge deluxe", "big", 9000);
    await activeListing(seller.id, "Desk lamp", "bright");

    const all = await keywordSearchFromDb("mini fridge");
    expect(all).toHaveLength(2);
    expect(all.every((r) => r.score >= 0.5)).toBe(true);

    const cheap = await keywordSearchFromDb("mini fridge", { maxPriceCents: 5000 });
    expect(cheap.map((r) => r.listing.id)).toEqual([fridge.id]);

    const notMine = await keywordSearchFromDb("mini fridge", { excludeSellerId: seller.id });
    expect(notMine.map((r) => r.listing.sellerId)).toEqual([other.id]);

    expect(await keywordSearchFromDb("guitar")).toEqual([]);
  });
});
