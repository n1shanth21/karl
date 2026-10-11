// Semantic (embedding) versions of search + matching, plus the shared "ping a buyer" rules.
// Owner: Himagna (data branch). Errors are NOT caught here: the dispatcher in index.ts decides fallbacks.

import { bus } from "../bus";
import { LIMITS } from "../config";
import { db } from "../db";
import type { Listing, SearchResult, Want } from "../types";
import { embedDocuments, embedQuery } from "./embed";
import { noticeSpread, PING_EVENT, priceBand, SPREAD_EVENT } from "./spread";
import { MATCH_MIN_SCORE, SEARCH_MIN_SCORE, SPREAD_MAX_FACTOR } from "./thresholds";

export { PING_EVENT }; // defined in spread.ts (which also counts it for the buyer's daily cap)

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
export async function wantSemantic(want: Want): Promise<number[]> {
  const vec = await embedQuery(want.queryText);
  await db.setWantEmbedding(want.id, vec);
  return vec;
}

/** A new want vs listings that already exist: only asks OVER the bid (cheaper ones were in the search results). */
export async function matchWantByVector(want: Want, vec: number[], now: Date = new Date()): Promise<void> {
  if (want.maxPriceCents == null) return;
  const found = await db.searchListingsByVector(vec, {
    maxPriceCents: Math.floor(want.maxPriceCents * SPREAD_MAX_FACTOR),
    excludeSellerId: want.buyerId,
    minScore: MATCH_MIN_SCORE,
    limit: 10,
  });
  await routeWantMatches(want, found, now);
}

/** Listings that match a new want: ask <= 1.5x the bid -> match_found ping, up to 3x -> spread_found. */
export async function routeWantMatches(want: Want, found: SearchResult[], now: Date = new Date()): Promise<void> {
  let spreadSent = false; // at most one spread notice per new want (the best match), not a burst
  for (const { listing, score } of found) {
    if (want.maxPriceCents == null || listing.priceCents <= want.maxPriceCents || listing.sellerId === want.buyerId) continue;
    const band = priceBand(listing.priceCents, want.maxPriceCents);
    if (band === "match") await pingBuyers(listing, [{ want, score }], now);
    else if (band === "spread" && !spreadSent) spreadSent = await noticeSpread(listing, want, now);
  }
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
    // The query keeps wants with max >= priceCents. Passing price / 3 (rounded up) lets near misses and wide
    // spreads through (max * 3 >= price) without touching the SQL; routeListingMatches sorts them. No-max wants pass.
    priceCents: Math.ceil(listing.priceCents / SPREAD_MAX_FACTOR),
    excludeBuyerId: listing.sellerId,
    minScore: MATCH_MIN_SCORE,
  });
  await routeListingMatches(listing, matches, now);
}

/** A listing's matching wants (best first): ask <= 1.5x the bid -> match_found ping, up to 3x -> spread_found. */
export async function routeListingMatches(listing: Listing, matches: { want: Want; score: number }[], now: Date = new Date()): Promise<void> {
  const near = matches.filter((m) => priceBand(listing.priceCents, m.want.maxPriceCents) === "match");
  await pingBuyers(listing, near, now);
  for (const { want } of matches) await noticeSpread(listing, want, now);
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
 * - never someone who texted "stop" (seed users are always opted out, so they are never pinged)
 * - the ping is logged before match_found is emitted, so the cap counts it even if a listener is slow
 */
export async function pingBuyers(listing: Listing, matches: { want: Want; score: number }[], now: Date = new Date()): Promise<void> {
  const seen = new Set<string>();
  for (const { want, score } of matches) {
    const buyerId = want.buyerId;
    if (seen.has(buyerId)) continue;
    seen.add(buyerId);

    const buyer = await db.getUser(buyerId);
    if (!buyer || buyer.optedOut) continue;

    const alreadyForListing = await db.countEventsSince(PING_EVENT, { userId: buyerId, listingId: listing.id, since: new Date(0) });
    if (alreadyForListing > 0) continue;
    if ((await db.countEventsSince(SPREAD_EVENT, { userId: buyerId, listingId: listing.id, since: new Date(0) })) > 0) continue; // already told via a spread notice
    const today = await db.countEventsSince(PING_EVENT, { userId: buyerId, since: new Date(now.getTime() - DAY_MS) });
    if (today >= LIMITS.maxProactivePingsPerUserPerDay) continue;

    await db.logEvent(PING_EVENT, { userId: buyerId, listingId: listing.id, payload: { wantId: want.id, score } });
    bus.emit("match_found", { wantId: want.id, listingId: listing.id, buyerId, score });
  }
}
