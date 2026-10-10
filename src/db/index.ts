// Entry point for the database. Everyone imports `db` from here. Owner: Himagna.
import { config } from "../config";
import { createMemoryDb } from "./memory";
import { createPostgresDb } from "./postgres";
import type { Db } from "./types";

export type { Db } from "./types";

export const db: Db = config.dbMode === "postgres" ? createPostgresDb() : createMemoryDb();
