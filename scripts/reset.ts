// Wipe the database, then (unless --no-seed) seed it again.  Usage:
//   bun scripts/reset.ts --yes                    -> the REAL database (public schema)
//   bun scripts/reset.ts --yes --schema test_x    -> a throwaway schema
//   bun scripts/reset.ts --yes --no-seed          -> wipe only
// Refuses without --yes. The continuous aggregate (events_hourly) can't be refreshed from inside a
// transaction, so we skip that: Timescale's real-time aggregation still reads the (now empty) events.

import { createPostgresDb } from "../src/db/postgres";
import { seed } from "./seed";

const args = process.argv.slice(2);
if (!args.includes("--yes")) {
  console.error("reset wipes ALL data. Re-run with --yes to confirm.");
  process.exit(1);
}
const flag = args.indexOf("--schema");
const schema = flag > -1 ? args[flag + 1] : undefined;
if (flag > -1 && !schema) throw new Error("--schema needs a name, e.g. --schema test_smoke");
if (schema && !/^test_[a-z0-9_]+$/.test(schema)) throw new Error("--schema must look like test_something");

const db = createPostgresDb({ schema });
try {
  // Only the real (public) schema needs the explicit opt-in; db.reset() allows test_ schemas anyway.
  if (!schema) process.env.KARL_ALLOW_PUBLIC_RESET = "1";
  await db.reset();
  console.log(`reset done (${schema ?? "public"})`);
  if (!args.includes("--no-seed")) await seed(db, { force: true });
} finally {
  await db.end();
}
