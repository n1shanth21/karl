// getStats().listingsPerHour: reads the Timescale continuous aggregate (or raw events as a fallback).
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Sql } from "../../src/db/pg/client";
import type { Db } from "../../src/db/types";
import { hasDatabase, makeTestDb } from "./helpers";

setDefaultTimeout(60_000);

async function insertAt(sql: Sql, type: string, hoursAgo: number) {
  await sql`insert into events (ts, type) values (now() - make_interval(hours => ${hoursAgo}::int), ${type})`;
}

for (const tiger of [true, false]) {
  describe.skipIf(!hasDatabase)(`postgres: listingsPerHour (${tiger ? "continuous aggregate" : "fallback on raw events"})`, () => {
    let db: Db;
    let sql: Sql;
    let cleanup: () => Promise<void>;
    beforeAll(async () => {
      ({ db, cleanup, sql } = (await makeTestDb("postgres", { tiger })) as Awaited<ReturnType<typeof makeTestDb>> & { sql: Sql });
      await insertAt(sql, "listing_activated", 0);
      await insertAt(sql, "listing_activated", 0);
      await insertAt(sql, "listing_activated", 2);
      await insertAt(sql, "listing_activated", 30); // outside the 12-hour window
      await insertAt(sql, "want_created", 0); // other types are ignored
      await insertAt(sql, "user_created", 2);
    });
    afterAll(async () => cleanup());

    test("schema has the continuous aggregate only when tiger is on", async () => {
      const [r] = await sql<{ n: number }[]>`
        select count(*)::int as n from timescaledb_information.continuous_aggregates where view_schema = current_schema()
      `;
      expect(r!.n).toBe(tiger ? 1 : 0);
    });

    test("12 zero-filled hourly buckets, oldest first", async () => {
      const stats = await db.getStats();
      const rows = stats.listingsPerHour;
      expect(rows).toHaveLength(12);
      for (const r of rows) {
        expect(new Date(r.hour).toISOString()).toBe(r.hour);
        expect(new Date(r.hour).getTime() % 3_600_000).toBe(0);
        expect(Number.isInteger(r.count)).toBe(true);
      }
      for (let i = 1; i < rows.length; i++) {
        expect(new Date(rows[i]!.hour).getTime() - new Date(rows[i - 1]!.hour).getTime()).toBe(3_600_000);
      }
      // The last bucket is the current hour. An hour boundary may pass mid-test, so find buckets by offset
      // from the last one instead of assuming "now" is still in it: counts are 2 now, 1 two hours ago.
      const counts = rows.map((r) => r.count);
      const total = counts.reduce((a, b) => a + b, 0);
      expect(total).toBe(3); // the 30h-old event and the other event types are excluded
      expect(counts[11]).toBe(2);
      expect(counts[9]).toBe(1);
      expect(counts.filter((c) => c === 0)).toHaveLength(10);
    });

    test("never exposes a phone number", async () => {
      const stats = await db.getStats();
      expect(JSON.stringify(stats)).not.toContain("phone");
    });
  });
}
