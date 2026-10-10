// Read-only database report.  Usage: bun scripts/healthcheck.ts [--schema test_x]
// Exit code 1 if any active listing has no embedding. Prints no secrets.

import { makeSql } from "../src/db/pg/client";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is missing. Put it in .env (see .env.example).");
const flag = process.argv.indexOf("--schema");
const schema = flag > -1 ? process.argv[flag + 1] : undefined;
if (flag > -1 && !schema) throw new Error("--schema needs a name, e.g. --schema test_smoke");
if (schema && !/^test_[a-z0-9_]+$/.test(schema)) throw new Error("--schema must look like test_something");

const sql = makeSql({ url, schema, max: 1 });
let missing = 0;
try {
  const [{ current }] = await sql<{ current: string }[]>`select current_schema() as current`;
  console.log(`schema: ${current}`);

  console.log("\nrow counts");
  for (const table of ["users", "photos", "listings", "wants", "matches", "conversation_messages", "events"]) {
    const [row] = await sql<{ n: number }[]>`select count(*)::int as n from ${sql(table)}`;
    console.log(`  ${table.padEnd(22)} ${row!.n}`);
  }

  const [l] = await sql<{ n: number }[]>`select count(*)::int as n from listings where status = 'active' and embedding is null`;
  const [w] = await sql<{ n: number }[]>`select count(*)::int as n from wants where status = 'open' and embedding is null`;
  missing = l!.n;
  console.log(`\nactive listings without embedding: ${l!.n}`);
  console.log(`open wants without embedding:      ${w!.n}`);

  const ext = await sql<{ extname: string; extversion: string }[]>`
    select extname, extversion from pg_extension where extname in ('vector', 'timescaledb') order by extname`;
  console.log("\nextensions: " + (ext.map((e) => `${e.extname} ${e.extversion}`).join(", ") || "none"));

  // timescaledb_information views only exist when the extension is installed. Filter by this
  // schema, so a test schema is never confused with public.
  if (ext.some((e) => e.extname === "timescaledb")) {
    const [hyper] = await sql<{ n: number }[]>`
      select count(*)::int as n from timescaledb_information.hypertables
      where hypertable_schema = current_schema() and hypertable_name = 'events'`;
    const [agg] = await sql<{ n: number }[]>`
      select count(*)::int as n from timescaledb_information.continuous_aggregates
      where view_schema = current_schema() and view_name = 'events_hourly'`;
    console.log(`events is a hypertable: ${hyper!.n > 0 ? "yes" : "NO"}`);
    console.log(`events_hourly exists:   ${agg!.n > 0 ? "yes" : "NO"}`);
  } else {
    console.log("timescaledb not installed: skipping hypertable checks");
  }

  const [latest] = await sql<{ ts: Date | null }[]>`select max(ts) as ts from events`;
  console.log(`latest event: ${latest!.ts ? latest!.ts.toISOString() : "none"}`);

  const migrations = await sql<{ name: string }[]>`select name from schema_migrations order by name`;
  console.log(`migrations applied: ${migrations.map((m) => m.name).join(", ") || "none"}`);
} finally {
  await sql.end({ timeout: 1 });
}
if (missing > 0) {
  console.error(`FAIL: ${missing} active listing(s) have no embedding`);
  process.exit(1);
}
