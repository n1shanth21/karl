// Embed active listings / open wants that have no embedding yet.  Usage: DB_MODE=postgres bun scripts/backfill.ts
// Prints counts only. Safe to run any time (a second run finds nothing and makes no Gemini call).

import { config } from "../src/config";
import { backfillEmbeddings } from "../src/matching/backfill";

if (config.dbMode !== "postgres") {
  console.log("backfill: DB_MODE is not postgres, nothing to do (memory mode has no embeddings).");
  process.exit(0);
}

const { listings, wants } = await backfillEmbeddings();
console.log(`backfill: embedded ${listings} listings, ${wants} wants`);
process.exit(0); // closes the db pool
