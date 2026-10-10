// SHARED CONTRACT for search + matching. Owner of the implementation: Himagna (data branch).
// Agent calls these three functions. Signatures are the contract.
//
// DB_MODE=postgres -> meaning-based search with Gemini embeddings + pgvector (semantic.ts).
// DB_MODE=memory   -> simple keyword overlap (no API key needed, used by tests and local dev).
// If Gemini fails in postgres mode, we fall back to keywords so Karl still answers.

import { config, LIMITS } from "../config";
import { db } from "../db";
import type { Listing, SearchResult, Want } from "../types";
import { keywordScore } from "./keyword";
import { embedListing, matchListingByVector, pingBuyers, searchSemantic, wantSemantic } from "./semantic";

const semanticOn = config.dbMode === "postgres";
const RETRY_MS = 60_000;

// Keyword fallback keeps active listings + open wants seen by this process in memory.
const activeListings = new Map<string, Listing>();
const openWants = new Map<string, Want>();
// Keyword overlap scores lower than embeddings, so it gets its own (looser) threshold.
const KEYWORD_THRESHOLD = 0.5;

/** Search active listings by meaning. Returns best first, at most LIMITS.maxSearchResults. */
export async function searchListings(query: string, opts: { maxPriceCents?: number | null; excludeSellerId?: string } = {}): Promise<SearchResult[]> {
  if (semanticOn) {
    try {
      return await searchSemantic(query, opts);
    } catch (err) {
      console.error("[matching] semantic search failed, falling back to keywords", err);
    }
  }
  return keywordSearch(query, opts);
}

/**
 * Call when a listing goes live for the FIRST time (draft -> active), not when a hold expires.
 * Finds saved wants it satisfies and emits match_found (each buyer at most once per listing).
 */
export async function onListingActivated(listing: Listing): Promise<void> {
  activeListings.set(listing.id, listing);
  if (semanticOn) {
    let vec: number[] | null = null;
    try {
      vec = await embedListing(listing);
    } catch (err) {
      // Gemini down or over quota: match by keywords now, and embed again in a minute so search can find it.
      console.error("[matching] embedding listing failed; keyword match now, retrying in 60s", err);
      retryLater(async () => matchListingByVector(listing, await embedListing(listing)));
    }
    if (vec) return matchListingByVector(listing, vec);
  }
  await pingBuyers(listing, await keywordCandidates(listing));
}

/** Call right after a want is saved, so future listings can match it. */
export async function onWantCreated(want: Want): Promise<void> {
  openWants.set(want.id, want);
  if (semanticOn) {
    await wantSemantic(want).catch((err) => {
      console.error("[matching] embedding want failed, retrying in 60s", err);
      retryLater(() => wantSemantic(want));
    });
  }
}

/** One delayed retry. unref() so a pending retry never keeps tests or a shutdown from exiting. */
function retryLater(fn: () => Promise<void>): void {
  const timer = setTimeout(() => fn().catch((err) => console.error("[matching] retry failed", err)), RETRY_MS);
  timer.unref?.();
}

async function keywordSearch(query: string, opts: { maxPriceCents?: number | null; excludeSellerId?: string }): Promise<SearchResult[]> {
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

async function keywordCandidates(listing: Listing): Promise<{ want: Want; score: number }[]> {
  const found: { want: Want; score: number }[] = [];
  for (const want of openWants.values()) {
    const fresh = await db.getWant(want.id);
    if (!fresh || fresh.status !== "open" || fresh.buyerId === listing.sellerId) continue;
    if (fresh.maxPriceCents != null && listing.priceCents > fresh.maxPriceCents) continue;
    const score = keywordScore(fresh.queryText, `${listing.title} ${listing.category} ${listing.description}`);
    if (score >= KEYWORD_THRESHOLD) found.push({ want: fresh, score });
  }
  return found.sort((a, b) => b.score - a.score);
}
