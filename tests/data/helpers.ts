// Shared setup for the db contract tests: the same cases run against memory AND postgres.
import { createMemoryDb } from "../../src/db/memory";
import { makeSql } from "../../src/db/pg/client";
import { migrate } from "../../src/db/pg/migrate";
import { createPostgresDb } from "../../src/db/postgres";
import type { Db } from "../../src/db/types";
import type { ListingDraft } from "../../src/types";

/** Postgres runs are skipped when there is no DATABASE_URL. */
export const hasDatabase = Boolean(process.env.DATABASE_URL);

export const backends = ["memory", "postgres"] as const;
export type Backend = (typeof backends)[number];

export async function makeTestDb(kind: Backend): Promise<{ db: Db; cleanup(): Promise<void> }> {
  if (kind === "memory") return { db: createMemoryDb(), cleanup: async () => {} };

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("postgres tests need DATABASE_URL");
  const schema = `test_${Math.random().toString(36).slice(2, 10)}`;
  if (!/^test_[a-z0-9]+$/.test(schema)) throw new Error(`bad test schema name ${schema}`);

  const admin = makeSql({ url, max: 1 });
  await admin.unsafe(`create schema ${schema}`);
  const migrator = makeSql({ url, schema, max: 1 });
  await migrate(migrator, { only: ["001_init.sql"] });
  await migrator.end({ timeout: 1 });
  const pgDb = createPostgresDb({ url, schema });

  return {
    db: pgDb,
    cleanup: async () => {
      await pgDb.end();
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
