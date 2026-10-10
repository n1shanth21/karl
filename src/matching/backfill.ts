// Backfill: give embeddings to active listings / open wants that have none (Gemini failed or was down
// when they were created, or the process restarted before the 60s retry). Silent: never pings buyers.
// Owner: Himagna (data branch).

import { db } from "../db";
import { embedDocuments, embedQuery } from "./embed";

export async function backfillEmbeddings(): Promise<{ listings: number; wants: number }> {
  const listings = await db.activeListingsMissingEmbedding();
  const wants = await db.openWantsMissingEmbedding();
  if (listings.length === 0 && wants.length === 0) return { listings: 0, wants: 0 }; // no Gemini call

  // All listings in one call (embedDocuments itself splits into batches of 100).
  if (listings.length > 0) {
    const vectors = await embedDocuments(listings);
    for (const [i, listing] of listings.entries()) await db.setListingEmbedding(listing.id, vectors[i]!);
  }

  // embed.ts only exposes embedQuery for single query texts (no batch helper), so wants go one by one.
  // Wants are short and few; each is stored right away so a failure midway keeps the earlier ones.
  for (const want of wants) {
    await db.setWantEmbedding(want.id, await embedQuery(want.queryText));
  }

  return { listings: listings.length, wants: wants.length };
}
