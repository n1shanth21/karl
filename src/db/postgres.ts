// Tiger Data (Postgres + pgvector) implementation of Db. Owner: Himagna (data branch).
// TODO(Himagna, Phase D1): implement every method with the `postgres` client, matching memory.ts behavior.
// Until then, any call throws a clear error so nobody mistakes the stub for working code.

import postgres from "postgres";
import { config } from "../config";
import type { Db } from "./types";

export function createPostgresDb(): Db {
  if (!config.databaseUrl) throw new Error("DB_MODE=postgres needs DATABASE_URL in .env");
  const sql = postgres(config.databaseUrl, { max: 5 });
  void sql; // used once methods are implemented

  return new Proxy({} as Db, {
    get(_target, method) {
      return async () => {
        throw new Error(`db.${String(method)} is not implemented for postgres yet (Himagna, Phase D1). Use DB_MODE=memory.`);
      };
    },
  });
}
