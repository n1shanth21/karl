// Runs db/migrations/*.sql in filename order, each file at most once. Owner: Himagna (data branch).
// Applied files are recorded in a schema_migrations table, so running this again is safe.
// Files are NOT wrapped in an explicit transaction: some Timescale statements refuse to run inside one.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Sql } from "./client";

const MIGRATIONS_DIR = join(import.meta.dir, "../../../db/migrations");

/** Returns the names of the files it applied this run. `only` limits which files may run (tests use it). */
export async function migrate(sql: Sql, opts: { only?: string[] } = {}): Promise<string[]> {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => !opts.only || opts.only.includes(f))
    .sort();

  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    // No parameters -> simple query protocol, so a file can hold many statements.
    await sql.unsafe(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    await sql`insert into schema_migrations (name) values (${file})`;
    applied.push(file);
  }
  return applied;
}
