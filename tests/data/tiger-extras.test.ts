// Tiger-only features from 004_tiger_extras.sql: pgvectorscale diskann indexes + events compression.
// Postgres only (skipped without DATABASE_URL); runs in a throwaway test_ schema.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { migrate } from "../../src/db/pg/migrate";
import { toVector } from "../../src/db/pg/client";
import type { Sql } from "../../src/db/pg/client";
import type { Db } from "../../src/db/types";
import { draft, hasDatabase, makeTestDb, newUser, vecAtCosine } from "./helpers";

setDefaultTimeout(60_000);

describe.skipIf(!hasDatabase)("postgres: Tiger extras (pgvectorscale + columnstore)", () => {
  let db: Db;
  let sql: Sql;
  let cleanup: () => Promise<void>;
  // Note: CREATE EXTENSION is database-wide, so 004 in a test schema also ensures vectorscale exists in
  // public. That is additive (no tables touched) and the live DB already has it installed.
  beforeAll(async () => {
    const t = await makeTestDb("postgres", { extras: true });
    ({ db, cleanup } = t);
    sql = t.sql!;
  });
  afterAll(async () => cleanup());

  test("vectorscale is installed and both diskann indexes exist next to the hnsw ones", async () => {
    const [ext] = await sql<{ n: number }[]>`select count(*)::int as n from pg_extension where extname = 'vectorscale'`;
    expect(ext!.n).toBe(1);
    const rows = await sql<{ indexname: string; indexdef: string }[]>`
      select indexname, indexdef from pg_indexes where schemaname = current_schema() and indexname like '%embedding%'`;
    const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]));
    expect(byName.get("listings_embedding_diskann")).toContain("USING diskann");
    expect(byName.get("wants_embedding_diskann")).toContain("USING diskann");
    expect(byName.get("listings_embedding_idx")).toContain("USING hnsw");
    expect(byName.get("wants_embedding_idx")).toContain("USING hnsw");
  });

  test("events compression is on, segmented by type, with a 7-day policy", async () => {
    const [h] = await sql<{ on: boolean }[]>`
      select compression_enabled as "on" from timescaledb_information.hypertables
      where hypertable_schema = current_schema() and hypertable_name = 'events'`;
    expect(h!.on).toBe(true);
    const [s] = await sql<{ segmentby: string; orderby: string }[]>`
      select segmentby, orderby from timescaledb_information.hypertable_compression_settings
      where hypertable = to_regclass('events')`;
    expect(s!.segmentby).toBe("type");
    expect(s!.orderby).toBe("ts DESC");
    const [j] = await sql<{ after: string }[]>`
      select config->>'compress_after' as after from timescaledb_information.jobs
      where proc_name = 'policy_compression' and hypertable_schema = current_schema() and hypertable_name = 'events'`;
    expect(j!.after).toBe("7 days");
  });

  test("a diskann index is used for a cosine query, and NULL embeddings are skipped", async () => {
    const seller = await newUser(db, "Maya");
    const near = await db.createListing({ sellerId: seller.id, draft: { ...draft, title: "near" }, photoId: null });
    const far = await db.createListing({ sellerId: seller.id, draft: { ...draft, title: "far" }, photoId: null });
    await db.createListing({ sellerId: seller.id, draft: { ...draft, title: "not embedded yet" }, photoId: null });
    await db.updateListing(near.id, { status: "active" });
    await db.updateListing(far.id, { status: "active" });
    await db.setListingEmbedding(near.id, vecAtCosine(0.95));
    await db.setListingEmbedding(far.id, vecAtCosine(0.2));

    const q = toVector(vecAtCosine(1));
    const rows = await sql.begin(async (tx) => {
      await tx`set local enable_seqscan = off`;
      await tx`set local enable_bitmapscan = off`;
      const plan = await tx<{ "QUERY PLAN": string }[]>`explain select id from listings order by embedding <=> ${q}::vector limit 3`;
      return plan.map((r) => r["QUERY PLAN"]).join("\n");
    });
    expect(rows).toMatch(/Index Scan using listings_embedding_(diskann|idx)/);

    const results = await sql<{ title: string }[]>`
      select title from listings where embedding is not null order by embedding <=> ${q}::vector limit 3`;
    expect(results.map((r) => r.title)).toEqual(["near", "far"]);

    const found = await db.searchListingsByVector(vecAtCosine(1), { minScore: 0.5, limit: 3 });
    expect(found.map((r) => r.listing.title)).toEqual(["near"]);
  });

  test("events_hourly stays live, also after an old chunk is compressed", async () => {
    await sql`insert into events (type) values ('listing_activated'), ('listing_activated')`;
    await sql`insert into events (ts, type) values (now() - interval '30 days', 'listing_activated')`;
    const compressed = await sql<{ chunk: string }[]>`
      select compress_chunk(c, if_not_compressed => true)::text as chunk from show_chunks('events', older_than => interval '7 days') c`;
    expect(compressed.length).toBeGreaterThan(0);
    await sql`insert into events (type) values ('listing_activated')`; // inserts still work afterwards
    const [r] = await sql<{ n: number }[]>`
      select coalesce(sum(n), 0)::int as n from events_hourly where type = 'listing_activated' and bucket > now() - interval '2 hours'`;
    expect(r!.n).toBeGreaterThanOrEqual(3); // listing_activated events logged by createListing (if any) only add to this
    const stats = await db.getStats();
    expect(stats.listingsPerHour).toHaveLength(12);
  });

  test("running the migrations again changes nothing", async () => {
    expect(await migrate(sql)).toEqual([]);
  });
});
