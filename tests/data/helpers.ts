// Shared setup for the db contract tests: the same cases run against memory AND postgres.
import { createMemoryDb } from "../../src/db/memory";
import { makeSql } from "../../src/db/pg/client";
import { migrate } from "../../src/db/pg/migrate";
import { createPostgresDb } from "../../src/db/postgres";
import type { Sql } from "../../src/db/pg/client";
import type { Db } from "../../src/db/types";
import { EMBED_DIM } from "../../src/config";
import type { ListingDraft } from "../../src/types";

/** Postgres runs are skipped when there is no DATABASE_URL. */
export const hasDatabase = Boolean(process.env.DATABASE_URL);

export const backends = ["memory", "postgres"] as const;
export type Backend = (typeof backends)[number];

/** `tiger: true` also applies 003_tiger.sql (events hypertable + events_hourly continuous aggregate). */
export async function makeTestDb(
  kind: Backend,
  opts: { tiger?: boolean } = {},
): Promise<{ db: Db; cleanup(): Promise<void>; sql?: Sql }> {
  if (kind === "memory") return { db: createMemoryDb(), cleanup: async () => {} };

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("postgres tests need DATABASE_URL");
  const schema = `test_${Math.random().toString(36).slice(2, 10)}`;
  if (!/^test_[a-z0-9]+$/.test(schema)) throw new Error(`bad test schema name ${schema}`);

  const admin = makeSql({ url, max: 1 });
  await admin.unsafe(`create schema ${schema}`);
  const migrator = makeSql({ url, schema, max: 1 });
  // Safety: if the connection ignored our search_path (e.g. a pooled URL), stop before touching real tables.
  const [{ current }] = await migrator<{ current: string }[]>`select current_schema() as current`;
  if (current !== schema) throw new Error(`test db is on schema "${current}", not ${schema}; refusing to run`);
  await migrate(migrator, { only: opts.tiger ? ["001_init.sql", "002_vector_index.sql", "003_tiger.sql"] : ["001_init.sql", "002_vector_index.sql"] });
  await migrator.end({ timeout: 1 });
  const raw = makeSql({ url, schema, max: 1 }); // for tests that need to poke rows directly (expiry, old events)
  const pgDb = createPostgresDb({ url, schema });

  return {
    db: pgDb,
    sql: raw,
    cleanup: async () => {
      await pgDb.end();
      await raw.end({ timeout: 1 });
      // A continuous aggregate has background policy jobs: drop the view first, then the schema.
      if (opts.tiger) await admin.unsafe(`drop materialized view if exists ${schema}.events_hourly`);
      await admin.unsafe(`drop schema ${schema} cascade`);
      await admin.end({ timeout: 1 });
    },
  };
}

export const draft: ListingDraft = {
  title: "Mini fridge",
  description: "works great",
  category: "mini fridge",
  condition: "good",
  priceCents: 4500,
  confidence: 0.9,
};

let phoneCounter = 0;
/** A fresh user with a unique phone number. */
export function newUser(db: Db, firstName?: string) {
  phoneCounter += 1;
  return db.createUser({ phone: `+1555000${String(phoneCounter).padStart(4, "0")}`, spaceId: `space-${phoneCounter}` }).then(async (u) =>
    firstName ? db.updateUser(u.id, { firstName }) : u,
  );
}

/** True when two dates are within `ms` of each other (the DB clock and ours may differ a little). */
export function near(a: Date, b: Date, ms = 60_000): boolean {
  return Math.abs(a.getTime() - b.getTime()) <= ms;
}

// ---- fake embeddings (no Gemini): each word owns one dimension, so shared words = similar vectors ----

function wordIndex(word: string): number {
  let h = 5381;
  for (const ch of word) h = (h * 33 + ch.charCodeAt(0)) % 100_003;
  return h % EMBED_DIM;
}

/** Unit vector over the unique words of `topic`. Cosine = shared words / sqrt(nA * nB). */
export function vecFor(topic: string): number[] {
  const words = new Set(topic.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const v = new Array<number>(EMBED_DIM).fill(0);
  for (const w of words) v[wordIndex(w)] += 1;
  const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

/** Unit vector whose cosine similarity to vecAtCosine(1) is exactly `c` (0..1). */
export function vecAtCosine(c: number): number[] {
  const v = new Array<number>(EMBED_DIM).fill(0);
  v[0] = c;
  v[1] = Math.sqrt(1 - c * c);
  return v;
}

/** The embedder src/matching/embed.ts would call: strips the doc/query prefixes, then vecFor. */
export async function fakeEmbedder(texts: string[]): Promise<number[][]> {
  return texts.map((t) =>
    vecFor(t.replace(/^task: search result \| query: /, "").replace(/^title: /, "").replace(" | text: ", " ")),
  );
}
