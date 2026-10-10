// Apply database migrations to Tiger Data.  Usage:
//   bun scripts/migrate.ts                  -> the real tables (public schema)
//   bun scripts/migrate.ts --schema test_x  -> a throwaway schema (created if missing)
// Prints only file names, never the connection string.

import { makeSql } from "../src/db/pg/client";
import { migrate } from "../src/db/pg/migrate";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is missing. Put it in .env (see .env.example).");

const flag = process.argv.indexOf("--schema");
const schema = flag > -1 ? process.argv[flag + 1] : undefined;
if (schema && !/^test_[a-z0-9_]+$/.test(schema)) throw new Error("--schema must look like test_something");

const sql = makeSql({ url, schema, max: 1 });
try {
  if (schema) await sql.unsafe(`create schema if not exists ${schema}`);
  const applied = await migrate(sql);
  console.log(applied.length ? `applied: ${applied.join(", ")}` : "nothing to apply, already up to date");
} finally {
  await sql.end({ timeout: 1 });
}
