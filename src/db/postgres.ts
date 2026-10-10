// Tiger Data (Postgres + pgvector + Timescale) implementation of Db. Owner: Himagna (data branch).
// Each table's queries live in src/db/pg/<table>.ts; this file just puts them together.

import { config } from "../config";
import { makeSql } from "./pg/client";
import { listingsQueries } from "./pg/listings";
import { matchesQueries } from "./pg/matches";
import { messagesQueries } from "./pg/messages";
import { photosQueries } from "./pg/photos";
import { statsQueries } from "./pg/stats";
import { usersQueries } from "./pg/users";
import { wantsQueries } from "./pg/wants";
import type { Db } from "./types";

export type PostgresDb = Db & { end(): Promise<void> };

/** `schema` and `url` are for tests (a throwaway test_ schema). The app calls this with no arguments. */
export function createPostgresDb(opts: { url?: string; schema?: string } = {}): PostgresDb {
  const url = opts.url ?? config.databaseUrl;
  if (!url) throw new Error("DB_MODE=postgres needs DATABASE_URL in .env");
  const sql = makeSql({ url, schema: opts.schema });

  return {
    ...usersQueries(sql),
    ...messagesQueries(sql),
    ...photosQueries(sql),
    ...listingsQueries(sql),
    ...wantsQueries(sql),
    ...matchesQueries(sql),
    ...statsQueries(sql),
    end: () => sql.end({ timeout: 1 }),
  };
}
