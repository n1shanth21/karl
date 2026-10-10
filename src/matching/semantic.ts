// Semantic (embedding) versions of search + matching. Owner: Himagna (data branch).
// Errors are NOT caught here: the dispatcher in index.ts decides the fallback.

import { bus } from "../bus";
import { LIMITS } from "../config";
import { db } from "../db";
import type { Listing, SearchResult, Want } from "../types";
import { embedDocuments, embedQuery } from "./embed";
import { MATCH_MIN_SCORE, SEARCH_MIN_SCORE } from "./thresholds";

/** Event type logged each time we proactively ping a buyer (counted for the daily cap). */
export const PING_EVENT = "match_pinged";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Active listings closest in meaning to the query, best first. */
export async function searchSemantic(
  query: string,
  opts: { maxPriceCents?: number | null; excludeSellerId?: string } = {},
): Promise<SearchResult[]> {
  const vec = await embedQuery(query);
  return db.searchListingsByVector(vec, {
    maxPriceCents: opts.maxPriceCents,
    excludeSellerId: opts.excludeSellerId,
    minScore: SEARCH_MIN_SCORE,
    limit: LIMITS.maxSearchResults,
  });
}

/** Embed + store a saved want. Wants are phrased like searches, so use the query embedding. */
export async function wantSemantic(want: Want): Promise<void> {
  const vec = await embedQuery(want.queryText);
  await db.setWantEmbedding(want.id, vec);
}

/** Embed + store a newly active listing, then ping buyers whose open wants it satisfies. */
export async function activateSemantic(listing: Listing, now: Date = new Date()): Promise<void> {
  const [vec] = await embedDocuments([listing]);
  await db.setListingEmbedding(listing.id, vec);

  const matches = await db.openWantsByVector(vec, {
    priceCents: listing.priceCents,
    excludeBuyerId: listing.sellerId,
    minScore: MATCH_MIN_SCORE,
  });

  // Best-first, so a buyer's best want wins; later wants of the same buyer are skipped.
  const pinged = new Set<string>();
  for (const { want, score } of matches) {
    const buyerId = want.buyerId;
    if (pinged.has(buyerId)) continue;
    pinged.add(buyerId);

    const recent = await db.countEventsSince(PING_EVENT, { userId: buyerId, since: new Date(now.getTime() - DAY_MS) });
    if (recent >= LIMITS.maxProactivePingsPerUserPerDay) continue;

    // Log first so the cap counts this ping even if a listener is slow.
    await db.logEvent(PING_EVENT, { userId: buyerId, listingId: listing.id, payload: { wantId: want.id, score } });
    bus.emit("match_found", { wantId: want.id, listingId: listing.id, buyerId, score });
  }
}
