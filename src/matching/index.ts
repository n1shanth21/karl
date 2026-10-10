// SHARED CONTRACT for search + matching. Owner of the implementation: Himagna (data branch).
// Agent calls these. Signatures are the contract; bodies are Himagna's to replace.
//
// Phase 0 version = simple keyword overlap so the agent can be built and tested today.
// TODO(Himagna, Phase D1/D2): Gemini embeddings + pgvector similarity in postgres mode.

import { bus } from "../bus";
import { LIMITS } from "../config";
import { db } from "../db";
import type { Listing, SearchResult, Want } from "../types";
import { keywordScore } from "./keyword";

// Phase 0 keeps active listings + open wants in memory for keyword matching.
const activeListings = new Map<string, Listing>();
const openWants = new Map<string, Want>();
// Keyword overlap scores lower than embeddings, so it gets its own (looser) threshold.
const KEYWORD_THRESHOLD = 0.5;

/** Search active listings by meaning. Returns best first, at most LIMITS.maxSearchResults. */
export async function searchListings(query: string, opts: { maxPriceCents?: number | null; excludeSellerId?: string } = {}): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  for (const listing of activeListings.values()) {
    const fresh = await db.getListing(listing.id);
    if (!fresh || fresh.status !== "active") continue;
    if (opts.excludeSellerId && fresh.sellerId === opts.excludeSellerId) continue;
    if (opts.maxPriceCents != null && fresh.priceCents > opts.maxPriceCents) continue;
    const score = keywordScore(query, `${fresh.title} ${fresh.category} ${fresh.description}`);
    if (score >= KEYWORD_THRESHOLD) results.push({ listing: fresh, score });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, LIMITS.maxSearchResults);
}

/** Call right after a listing becomes "active". Finds saved wants it satisfies and emits match_found. */
export async function onListingActivated(listing: Listing): Promise<void> {
  activeListings.set(listing.id, listing);
  for (const want of openWants.values()) {
    const fresh = await db.getWant(want.id);
    if (!fresh || fresh.status !== "open" || fresh.buyerId === listing.sellerId) continue;
    if (fresh.maxPriceCents != null && listing.priceCents > fresh.maxPriceCents) continue;
    const score = keywordScore(fresh.queryText, `${listing.title} ${listing.category} ${listing.description}`);
    if (score >= KEYWORD_THRESHOLD) {
      bus.emit("match_found", { wantId: fresh.id, listingId: listing.id, buyerId: fresh.buyerId, score });
    }
  }
}

/** Call right after a want is saved, so future listings can match it. */
export async function onWantCreated(want: Want): Promise<void> {
  openWants.set(want.id, want);
}
