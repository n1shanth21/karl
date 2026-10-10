// Shared helpers for the Postgres (Tiger Data) implementation. Owner: Himagna (data branch).
// Every src/db/pg/<table>.ts file imports from here, and never from each other.

import postgres from "postgres";

export type Sql = postgres.Sql;

/**
 * Open a connection pool.
 * - Column names are converted automatically: snake_case in SQL <-> camelCase in TypeScript,
 *   so `select first_name` comes back as `row.firstName` and `sql({ firstName })` writes `first_name`.
 * - `schema` lets tests use a throwaway schema (e.g. "test_ab12") instead of the real tables.
 *   `public` stays on the path so the `vector` type from the pgvector extension still resolves.
 */
export function makeSql(opts: { url: string; schema?: string; max?: number }): Sql {
  return postgres(opts.url, {
    max: opts.max ?? 5,
    connect_timeout: 15,
    idle_timeout: 30,
    onnotice: () => {}, // hide "already exists, skipping" notices from IF NOT EXISTS
    transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } },
    connection: opts.schema ? { search_path: `${opts.schema},public` } : {},
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres throws on a malformed uuid. Memory just returns null, so check first. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Drop keys whose value is undefined (patches only change the keys that are present). */
export function defined<T extends Record<string, unknown>>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** pgvector text format: [0.1,0.2,...]. Use as ${toVector(v)}::vector in a query. */
export function toVector(values: number[]): string {
  return `[${values.join(",")}]`;
}

/** Append one row to the events log. Never throws: analytics must not break a user's flow. */
export async function insertEvent(
  sql: Sql,
  type: string,
  data: { userId?: string; listingId?: string; payload?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    await sql`
      insert into events (type, user_id, listing_id, payload)
      values (${type}, ${data.userId ?? null}, ${data.listingId ?? null}, ${sql.json((data.payload ?? {}) as postgres.JSONValue)})
    `;
  } catch (err) {
    console.error(`[db] logEvent ${type} failed`, err);
  }
}
