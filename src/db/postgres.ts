// Tiger Data (Postgres + pgvector + Timescale) implementation of Db. Owner: Himagna (data branch).
// Each table's queries live in src/db/pg/<table>.ts; this file just puts them together.

import { config } from "../config";
import { makeSql } from "./pg/client";
import { usersQueries } from "./pg/users";
import type { Db } from "./types";

export type PostgresDb = Db & { end(): Promise<void> };

/** `schema` and `url` are for tests (a throwaway test_ schema). The app calls this with no arguments. */
export function createPostgresDb(opts: { url?: string; schema?: string } = {}): PostgresDb {
  const url = opts.url ?? config.databaseUrl;
  if (!url) throw new Error("DB_MODE=postgres needs DATABASE_URL in .env");
  const sql = makeSql({ url, schema: opts.schema });

  const notYet = (method: string) => async () => {
    throw new Error(`db.${method} is not implemented for postgres yet (Himagna, Phase D1). Use DB_MODE=memory.`);
  };

  return {
    ...usersQueries(sql),
    // TODO(D1 wave A): replace these with the real query modules.
    saveInbound: notYet("saveInbound"),
    saveOutbound: notYet("saveOutbound"),
    recentMessages: notYet("recentMessages"),
    savePhoto: notYet("savePhoto"),
    getPhoto: notYet("getPhoto"),
    createListing: notYet("createListing"),
    getListing: notYet("getListing"),
    updateListing: notYet("updateListing"),
    listingsBySeller: notYet("listingsBySeller"),
    createWant: notYet("createWant"),
    getWant: notYet("getWant"),
    updateWantStatus: notYet("updateWantStatus"),
    openWantsByBuyer: notYet("openWantsByBuyer"),
    openWantsExpiredBefore: notYet("openWantsExpiredBefore"),
    createMatch: notYet("createMatch"),
    getMatch: notYet("getMatch"),
    updateMatch: notYet("updateMatch"),
    activeMatchesForUser: notYet("activeMatchesForUser"),
    matchesWithExpiredHold: notYet("matchesWithExpiredHold"),
    matchesDueForCheckin: notYet("matchesDueForCheckin"),
    logEvent: notYet("logEvent"),
    getStats: notYet("getStats"),
    reset: notYet("reset"),
    end: () => sql.end({ timeout: 1 }),
  };
}
