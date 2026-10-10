// Tests src/matching/semantic.ts against a real pgvector test schema, with a fake embedder (no Gemini).
//
// How the db is swapped: semantic.ts imports the `db` singleton from src/db. Instead of mock.module
// (which leaks into other test files in the same `bun test` process), beforeAll overwrites every method
// on that singleton object with the matching method of a throwaway test_ schema db, and afterAll puts
// the originals back. Nothing here ever touches the real public schema.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bus, type BusEvents } from "../../src/bus";
import { LIMITS } from "../../src/config";
import { db as singleton } from "../../src/db";
import type { Sql } from "../../src/db/pg/client";
import type { Db } from "../../src/db/types";
import { setEmbedder } from "../../src/matching/embed";
import { activateSemantic, PING_EVENT, searchSemantic, wantSemantic } from "../../src/matching/semantic";
import { MATCH_MIN_SCORE, SEARCH_MIN_SCORE } from "../../src/matching/thresholds";
import type { Listing } from "../../src/types";
import { fakeEmbedder, hasDatabase, makeTestDb, newUser, vecFor } from "./helpers";

setDefaultTimeout(30_000);

type Found = BusEvents["match_found"];
const found: Found[] = [];
const pingsSeenAtEmit: Promise<number>[] = []; // ping events already in the db when match_found fired
bus.on("match_found", (p) => {
  found.push(p);
  pingsSeenAtEmit.push(singleton.countEventsSince(PING_EVENT, { userId: p.buyerId, since: new Date(Date.now() - 60_000) }));
});

describe.skipIf(!hasDatabase)("semantic matching (postgres test schema)", () => {
  let testDb: Db;
  let sql: Sql;
  let cleanup: () => Promise<void>;
  const originals = new Map<string, unknown>();
  const target = singleton as unknown as Record<string, unknown>;

  beforeAll(async () => {
    const t = await makeTestDb("postgres");
    ({ db: testDb, cleanup } = t);
    sql = t.sql!;
    for (const key of Object.keys(testDb) as (keyof Db)[]) {
      originals.set(key, target[key]);
      target[key] = testDb[key];
    }
  });
  afterAll(async () => {
    for (const [key, fn] of originals) target[key] = fn;
    await cleanup();
  });
  beforeEach(async () => {
    await testDb.reset();
    found.length = 0;
    pingsSeenAtEmit.length = 0;
    setEmbedder(fakeEmbedder);
  });
  afterEach(() => setEmbedder(null));

  /** A seller's listing, made active (like the sell flow does) but not yet embedded/matched. */
  async function makeListing(sellerId: string, title: string, desc: string, priceCents = 4500): Promise<Listing> {
    const l = await testDb.createListing({
      sellerId,
      draft: { title, description: desc, category: title.toLowerCase(), condition: "good", priceCents, confidence: 0.9 },
      photoId: null,
    });
    return testDb.updateListing(l.id, { status: "active" });
  }

  /** A saved want that has been embedded, as the want flow does. */
  async function makeWant(buyerId: string, text: string, maxPriceCents: number | null = null) {
    const w = await testDb.createWant({ buyerId, queryText: text, maxPriceCents });
    await wantSemantic(w);
    return w;
  }

  const FRIDGE = ["Mini fridge", "cold drinks"] as const; // words: mini fridge cold drinks

  test("thresholds in the fake space: related clears MATCH, unrelated is below SEARCH", () => {
    const dot = (x: number[], y: number[]) => x.reduce((acc, v, i) => acc + v * y[i]!, 0);
    expect(dot(vecFor("mini fridge cold drinks"), vecFor("mini fridge"))).toBeGreaterThan(MATCH_MIN_SCORE);
    expect(dot(vecFor("desk lamp bright"), vecFor("lamp oil"))).toBeLessThan(SEARCH_MIN_SCORE);
  });

  test("match_found fires for a matching want", async () => {
    const seller = await newUser(testDb);
    const buyer = await newUser(testDb);
    const want = await makeWant(buyer.id, "mini fridge");
    const listing = await makeListing(seller.id, ...FRIDGE);
    await activateSemantic(listing);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ wantId: want.id, listingId: listing.id, buyerId: buyer.id });
    expect(found[0]!.score).toBeGreaterThanOrEqual(MATCH_MIN_SCORE);
    expect(found[0]!.score).toBeLessThanOrEqual(1);
  });

  test("no match_found for an unrelated want (desk lamp vs lamp oil)", async () => {
    const seller = await newUser(testDb);
    const buyer = await newUser(testDb);
    await makeWant(buyer.id, "lamp oil");
    await activateSemantic(await makeListing(seller.id, "Desk lamp", "bright"));
    expect(found).toHaveLength(0);
    expect(await testDb.countEventsSince(PING_EVENT, { userId: buyer.id, since: new Date(Date.now() - 60_000) })).toBe(0);
  });

  test("the seller's own want is excluded", async () => {
    const seller = await newUser(testDb);
    await makeWant(seller.id, "mini fridge");
    await activateSemantic(await makeListing(seller.id, ...FRIDGE));
    expect(found).toHaveLength(0);
  });

  test("a want whose max price is below the listing price is excluded; at the price it matches", async () => {
    const seller = await newUser(testDb);
    const cheap = await newUser(testDb);
    const fair = await newUser(testDb);
    await makeWant(cheap.id, "mini fridge", 4499);
    const ok = await makeWant(fair.id, "mini fridge", 4500);
    await activateSemantic(await makeListing(seller.id, ...FRIDGE, 4500));
    expect(found.map((f) => f.wantId)).toEqual([ok.id]);
  });

  test("a buyer with two matching wants is pinged once, for the better want", async () => {
    const seller = await newUser(testDb);
    const buyer = await newUser(testDb);
    const better = await makeWant(buyer.id, "mini fridge cold drinks"); // 1.0 against the listing text
    await makeWant(buyer.id, "mini fridge"); // ~0.71
    await activateSemantic(await makeListing(seller.id, ...FRIDGE));
    expect(found).toHaveLength(1);
    expect(found[0]!.wantId).toBe(better.id);
    expect(await testDb.countEventsSince(PING_EVENT, { userId: buyer.id, since: new Date(Date.now() - 60_000) })).toBe(1);
  });

  test("two different buyers are both pinged", async () => {
    const seller = await newUser(testDb);
    const a = await newUser(testDb);
    const b = await newUser(testDb);
    await makeWant(a.id, "mini fridge");
    await makeWant(b.id, "fridge cold drinks");
    await activateSemantic(await makeListing(seller.id, ...FRIDGE));
    expect(found.map((f) => f.buyerId).sort()).toEqual([a.id, b.id].sort());
  });

  test("daily cap: at the limit no ping or event; old pings and other users do not count", async () => {
    const seller = await newUser(testDb);
    const capped = await newUser(testDb);
    const fresh = await newUser(testDb);
    await makeWant(capped.id, "mini fridge");
    await makeWant(fresh.id, "mini fridge");
    for (let i = 0; i < LIMITS.maxProactivePingsPerUserPerDay; i++) await testDb.logEvent(PING_EVENT, { userId: capped.id });
    const listing = await makeListing(seller.id, ...FRIDGE);
    await activateSemantic(listing);

    expect(found.map((f) => f.buyerId)).toEqual([fresh.id]);
    const since = new Date(Date.now() - 60_000);
    expect(await testDb.countEventsSince(PING_EVENT, { userId: capped.id, since })).toBe(LIMITS.maxProactivePingsPerUserPerDay);

    // Pings older than 24h roll off the window: age the capped user's events by 2 days, then match again.
    await sql`update events set ts = now() - interval '2 days' where user_id = ${capped.id}`;
    found.length = 0;
    await activateSemantic(await makeListing(seller.id, ...FRIDGE));
    expect(found.map((f) => f.buyerId).sort()).toEqual([capped.id, fresh.id].sort());
  });

  test("one below the cap still pings", async () => {
    const seller = await newUser(testDb);
    const buyer = await newUser(testDb);
    await makeWant(buyer.id, "mini fridge");
    for (let i = 0; i < LIMITS.maxProactivePingsPerUserPerDay - 1; i++) await testDb.logEvent(PING_EVENT, { userId: buyer.id });
    await activateSemantic(await makeListing(seller.id, ...FRIDGE));
    expect(found).toHaveLength(1);
  });

  test("the ping event is logged before match_found is emitted", async () => {
    const seller = await newUser(testDb);
    const buyer = await newUser(testDb);
    await makeWant(buyer.id, "mini fridge");
    await activateSemantic(await makeListing(seller.id, ...FRIDGE));
    expect(found).toHaveLength(1);
    expect(await Promise.all(pingsSeenAtEmit)).toEqual([1]); // already counted when the listener ran
  });

  test("activateSemantic stores the listing embedding, so searchSemantic can find it", async () => {
    const seller = await newUser(testDb);
    const other = await newUser(testDb);
    const listing = await makeListing(seller.id, ...FRIDGE, 4500);
    expect(await searchSemantic("mini fridge")).toHaveLength(0); // not embedded yet
    await activateSemantic(listing);

    expect((await searchSemantic("mini fridge")).map((r) => r.listing.id)).toEqual([listing.id]);
    expect(await searchSemantic("mini fridge", { maxPriceCents: 4000 })).toHaveLength(0);
    expect(await searchSemantic("mini fridge", { excludeSellerId: seller.id })).toHaveLength(0);
    expect(await searchSemantic("mini fridge", { excludeSellerId: other.id })).toHaveLength(1);
    expect(await searchSemantic("lamp oil")).toHaveLength(0);
  });

  test("a want that was never embedded can't be matched", async () => {
    const seller = await newUser(testDb);
    const buyer = await newUser(testDb);
    await testDb.createWant({ buyerId: buyer.id, queryText: "mini fridge", maxPriceCents: null }); // no wantSemantic call
    await activateSemantic(await makeListing(seller.id, ...FRIDGE));
    expect(found).toHaveLength(0);
  });
});
