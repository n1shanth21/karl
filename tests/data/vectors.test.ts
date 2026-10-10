// Postgres-only tests for the pgvector queries (all in a throwaway test_ schema, no Gemini).
import { afterAll, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Sql } from "../../src/db/pg/client";
import type { Db } from "../../src/db/types";
import type { ListingStatus } from "../../src/types";
import { draft, hasDatabase, makeTestDb, newUser, vecAtCosine, vecFor } from "./helpers";

setDefaultTimeout(30_000);

describe("vecFor (fake embeddings)", () => {
  test("shared words overlap, unrelated words do not", () => {
    const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);
    expect(dot(vecFor("mini fridge"), vecFor("mini fridge"))).toBeCloseTo(1, 6);
    expect(dot(vecFor("mini fridge"), vecFor("fridge cold drinks"))).toBeGreaterThan(0.4);
    expect(dot(vecFor("desk lamp bright"), vecFor("lamp oil"))).toBeLessThan(0.5);
    expect(dot(vecFor("mini fridge"), vecFor("lamp oil"))).toBe(0);
  });
});

describe.skipIf(!hasDatabase)("postgres: vector search", () => {
  let db: Db;
  let sql: Sql;
  let cleanup: () => Promise<void>;
  beforeAll(async () => {
    const t = await makeTestDb("postgres");
    ({ db, cleanup } = t);
    sql = t.sql!;
  });
  afterAll(async () => cleanup());
  beforeEach(async () => db.reset());

  /** An embedded listing with the given status/price. */
  async function listing(sellerId: string, vec: number[] | null, opts: { status?: ListingStatus; priceCents?: number } = {}) {
    const l = await db.createListing({ sellerId, draft: { ...draft, priceCents: opts.priceCents ?? 4500 }, photoId: null });
    if (opts.status && opts.status !== "draft") await db.updateListing(l.id, { status: opts.status });
    if (vec) await db.setListingEmbedding(l.id, vec);
    return l;
  }

  async function want(buyerId: string, vec: number[] | null, maxPriceCents: number | null = null) {
    const w = await db.createWant({ buyerId, queryText: "x", maxPriceCents });
    if (vec) await db.setWantEmbedding(w.id, vec);
    return w;
  }

  const q = vecFor("mini fridge");
  const search = (opts: Partial<Parameters<Db["searchListingsByVector"]>[1]> = {}) =>
    db.searchListingsByVector(q, { minScore: 0.1, limit: 10, ...opts });

  test("searchListingsByVector returns only active listings that have an embedding", async () => {
    const s = await newUser(db);
    const active = await listing(s.id, q, { status: "active" });
    await listing(s.id, q, { status: "draft" });
    await listing(s.id, q, { status: "held" });
    await listing(s.id, q, { status: "sold" });
    await listing(s.id, q, { status: "removed" });
    await listing(s.id, null, { status: "active" }); // no embedding yet
    const res = await search();
    expect(res.map((r) => r.listing.id)).toEqual([active.id]);
  });

  test("orders best first, scores are 0..1, minScore and limit apply", async () => {
    const s = await newUser(db);
    const best = await listing(s.id, vecFor("mini fridge"), { status: "active" }); // 1.0
    const mid = await listing(s.id, vecFor("mini fridge cold drinks"), { status: "active" }); // 0.71
    await listing(s.id, vecFor("lamp oil"), { status: "active" }); // 0
    const res = await search();
    expect(res.map((r) => r.listing.id)).toEqual([best.id, mid.id]);
    expect(res[0]!.score).toBeCloseTo(1, 4);
    expect(res[1]!.score).toBeCloseTo(0.7071, 3);
    for (const r of res) expect(r.score >= 0 && r.score <= 1).toBe(true);

    expect((await search({ minScore: 0.8 })).map((r) => r.listing.id)).toEqual([best.id]);
    expect((await search({ limit: 1 })).map((r) => r.listing.id)).toEqual([best.id]);
    expect(await search({ minScore: 0.999999 })).toHaveLength(1); // exact match still passes
  });

  test("maxPriceCents is inclusive; null/undefined means no cap", async () => {
    const s = await newUser(db);
    const cheap = await listing(s.id, q, { status: "active", priceCents: 5000 });
    await listing(s.id, q, { status: "active", priceCents: 5001 });
    expect((await search({ maxPriceCents: 5000 })).map((r) => r.listing.id)).toEqual([cheap.id]);
    expect(await search({ maxPriceCents: null })).toHaveLength(2);
    expect(await search()).toHaveLength(2);
  });

  test("excludeSellerId hides that seller; a malformed id is ignored", async () => {
    const a = await newUser(db);
    const b = await newUser(db);
    await listing(a.id, q, { status: "active" });
    const bs = await listing(b.id, q, { status: "active" });
    expect((await search({ excludeSellerId: a.id })).map((r) => r.listing.id)).toEqual([bs.id]);
    expect(await search({ excludeSellerId: "not-a-uuid" })).toHaveLength(2);
  });

  test("an opposite-direction vector scores 0 (clamped) and never beats minScore", async () => {
    const s = await newUser(db);
    await listing(s.id, vecAtCosine(-1), { status: "active" });
    expect(await db.searchListingsByVector(vecAtCosine(1), { minScore: 0.01, limit: 5 })).toHaveLength(0);
    const all = await db.searchListingsByVector(vecAtCosine(1), { minScore: -2, limit: 5 });
    expect(all[0]!.score).toBe(0);
  });

  test("openWantsByVector: open + unexpired + embedded only", async () => {
    const buyer = await newUser(db);
    const ok = await want(buyer.id, q);
    await want(buyer.id, null); // no embedding
    const closed = await want(buyer.id, q);
    await db.updateWantStatus(closed.id, "closed");
    const matched = await want(buyer.id, q);
    await db.updateWantStatus(matched.id, "matched");
    const expired = await want(buyer.id, q);
    await sql`update wants set expires_at = now() - interval '1 minute' where id = ${expired.id}`;

    const res = await db.openWantsByVector(q, { priceCents: 4500, excludeBuyerId: crypto.randomUUID(), minScore: 0.1 });
    expect(res.map((r) => r.want.id)).toEqual([ok.id]);
    expect(res[0]!.score).toBeCloseTo(1, 4);
  });

  test("openWantsByVector price rule: no max ok, max >= price ok, max < price excluded", async () => {
    const buyer = await newUser(db);
    const noMax = await want(buyer.id, q, null);
    const exact = await want(buyer.id, q, 4500);
    await want(buyer.id, q, 4499);
    const res = await db.openWantsByVector(q, { priceCents: 4500, excludeBuyerId: crypto.randomUUID(), minScore: 0.1 });
    expect(res.map((r) => r.want.id).sort()).toEqual([noMax.id, exact.id].sort());
  });

  test("openWantsByVector excludeBuyerId, minScore, ordering", async () => {
    const a = await newUser(db);
    const b = await newUser(db);
    const mid = await want(a.id, vecFor("mini fridge cold drinks"));
    const best = await want(b.id, vecFor("mini fridge"));
    await want(b.id, vecFor("lamp oil"));
    const base = { priceCents: 4500, excludeBuyerId: crypto.randomUUID(), minScore: 0.5 };
    expect((await db.openWantsByVector(q, base)).map((r) => r.want.id)).toEqual([best.id, mid.id]);
    expect((await db.openWantsByVector(q, { ...base, excludeBuyerId: b.id })).map((r) => r.want.id)).toEqual([mid.id]);
    expect((await db.openWantsByVector(q, { ...base, minScore: 0.8 })).map((r) => r.want.id)).toEqual([best.id]);
    expect(await db.openWantsByVector(q, { ...base, excludeBuyerId: "bad" })).toHaveLength(2); // malformed -> no exclusion
  });

  test("countEventsSince filters by user, type and time", async () => {
    const a = await newUser(db);
    const b = await newUser(db);
    const hourAgo = new Date(Date.now() - 3600_000);
    await db.logEvent("match_pinged", { userId: a.id });
    await db.logEvent("match_pinged", { userId: a.id });
    await db.logEvent("match_pinged", { userId: b.id });
    await db.logEvent("other_type", { userId: a.id });
    await sql`insert into events (ts, type, user_id) values (now() - interval '2 days', 'match_pinged', ${a.id})`;

    expect(await db.countEventsSince("match_pinged", { userId: a.id, since: hourAgo })).toBe(2);
    expect(await db.countEventsSince("match_pinged", { userId: b.id, since: hourAgo })).toBe(1);
    expect(await db.countEventsSince("other_type", { userId: a.id, since: hourAgo })).toBe(1);
    expect(await db.countEventsSince("match_pinged", { userId: a.id, since: new Date(Date.now() - 3 * 86400_000) })).toBe(3);
    expect(await db.countEventsSince("match_pinged", { userId: a.id, since: new Date(Date.now() + 60_000) })).toBe(0);
    expect(await db.countEventsSince("match_pinged", { userId: "nope", since: hourAgo })).toBe(0);
  });

  test("countEventsSince can be narrowed to one listing (once-per-listing ping rule)", async () => {
    const a = await newUser(db);
    const l1 = crypto.randomUUID();
    await db.logEvent("match_pinged", { userId: a.id, listingId: l1 });
    await db.logEvent("match_pinged", { userId: a.id, listingId: crypto.randomUUID() });
    const since = new Date(0);
    expect(await db.countEventsSince("match_pinged", { userId: a.id, since })).toBe(2);
    expect(await db.countEventsSince("match_pinged", { userId: a.id, since, listingId: l1 })).toBe(1);
    expect(await db.countEventsSince("match_pinged", { userId: a.id, since, listingId: crypto.randomUUID() })).toBe(0);
    expect(await db.countEventsSince("match_pinged", { userId: a.id, since, listingId: "nope" })).toBe(0);
  });

  test("set*Embedding with a malformed id is a no-op, an unknown uuid changes nothing", async () => {
    await db.setListingEmbedding("nope", q);
    await db.setWantEmbedding("nope", q);
    await db.setListingEmbedding(crypto.randomUUID(), q);
    await db.setWantEmbedding(crypto.randomUUID(), q);
    expect(await search()).toHaveLength(0);
  });

  test("re-embedding a listing replaces its vector", async () => {
    const s = await newUser(db);
    const l = await listing(s.id, vecFor("lamp oil"), { status: "active" });
    expect(await search({ minScore: 0.5 })).toHaveLength(0);
    await db.setListingEmbedding(l.id, q);
    expect((await search({ minScore: 0.5 })).map((r) => r.listing.id)).toEqual([l.id]);
  });
});
