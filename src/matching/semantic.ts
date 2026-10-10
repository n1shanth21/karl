// Semantic (embedding) versions of search + matching, plus the shared "ping a buyer" rules.
// Owner: Himagna (data branch). Errors are NOT caught here: the dispatcher in index.ts decides fallbacks.

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
    // "$19.99" * 100 can give 1998.9999999999998; the database wants whole cents.
    maxPriceCents: opts.maxPriceCents == null ? null : Math.round(opts.maxPriceCents),
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

/** Step 1 of activation: embed + store the listing. This is the step that can fail on Gemini quota. */
export async function embedListing(listing: Listing): Promise<number[]> {
  const [vec] = await embedDocuments([listing]);
  await db.setListingEmbedding(listing.id, vec!);
  return vec!;
}

/** Step 2 of activation: find open wants close in meaning to the listing and ping their buyers. */
export async function matchListingByVector(listing: Listing, vec: number[], now: Date = new Date()): Promise<void> {
  const matches = await db.openWantsByVector(vec, {
    priceCents: listing.priceCents,
    excludeBuyerId: listing.sellerId,
    minScore: MATCH_MIN_SCORE,
  });
  await pingBuyers(listing, matches, now);
}

/** Both steps. Kept for callers/tests that want activation in one call. */
export async function activateSemantic(listing: Listing, now: Date = new Date()): Promise<void> {
  const vec = await embedListing(listing);
  await matchListingByVector(listing, vec, now);
}

/**
 * The rules for proactive texts, shared by the vector and keyword paths. `matches` must be best-first.
 * - each buyer at most once per listing, ever (a relisted item doesn't re-ping anyone)
 * - each buyer at most LIMITS.maxProactivePingsPerUserPerDay pings per 24 h
 * - the ping is logged before match_found is emitted, so the cap counts it even if a listener is slow
 */
export async function pingBuyers(listing: Listing, matches: { want: Want; score: number }[], now: Date = new Date()): Promise<void> {
  const seen = new Set<string>();
  for (const { want, score } of matches) {
    const buyerId = want.buyerId;
    if (seen.has(buyerId)) continue;
    seen.add(buyerId);

    const alreadyForListing = await db.countEventsSince(PING_EVENT, { userId: buyerId, listingId: listing.id, since: new Date(0) });
    if (alreadyForListing > 0) continue;
    const today = await db.countEventsSince(PING_EVENT, { userId: buyerId, since: new Date(now.getTime() - DAY_MS) });
    if (today >= LIMITS.maxProactivePingsPerUserPerDay) continue;

    await db.logEvent(PING_EVENT, { userId: buyerId, listingId: listing.id, payload: { wantId: want.id, score } });
    bus.emit("match_found", { wantId: want.id, listingId: listing.id, buyerId, score });
  }
}
