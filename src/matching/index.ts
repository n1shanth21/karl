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
import { SPREAD_MAX_FACTOR } from "./thresholds";
import { embedListing, matchListingByVector, matchWantByVector, routeListingMatches, routeWantMatches, searchSemantic, wantSemantic } from "./semantic";

export { backfillEmbeddings } from "./backfill";

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
  return semanticOn ? keywordSearchFromDb(query, opts) : keywordSearch(query, opts);
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
      retryLater(async () => {
        // A minute later it may already be held or sold: only ping about items still for sale.
        const fresh = await db.getListing(listing.id);
        if (fresh?.status === "active") await matchListingByVector(fresh, await embedListing(fresh));
      });
    }
    if (vec) {
      try {
        return await matchListingByVector(listing, vec);
      } catch (err) {
        console.error("[matching] vector matching failed, falling back to keywords", err);
      }
    }
  }
  await routeListingMatches(listing, await keywordCandidates(listing));
}

/** Call right after a want is saved, so future listings can match it. */
export async function onWantCreated(want: Want): Promise<void> {
  openWants.set(want.id, want);
  if (semanticOn) {
    try {
      return await matchWantByVector(want, await wantSemantic(want));
    } catch (err) {
      console.error("[matching] embedding/matching want failed, retrying in 60s", err);
      retryLater(async () => void (await wantSemantic(want)));
    }
  }
  await routeWantMatches(want, await keywordListings(want));
}

/** Listings (seen by this process) that match a new want by keywords. Price filtering happens in routeWantMatches. */
async function keywordListings(want: Want): Promise<SearchResult[]> {
  if (want.maxPriceCents == null) return [];
  const found: SearchResult[] = [];
  for (const seen of activeListings.values()) {
    const listing = await db.getListing(seen.id);
    if (listing?.status !== "active" || listing.sellerId === want.buyerId || listing.priceCents > want.maxPriceCents * SPREAD_MAX_FACTOR) continue;
    const score = keywordScore(want.queryText, `${listing.title} ${listing.category} ${listing.description}`);
    if (score >= KEYWORD_THRESHOLD) found.push({ listing, score });
  }
  return found.sort((a, b) => b.score - a.score);
}

/** One delayed retry. unref() so a pending retry never keeps tests or a shutdown from exiting. */
function retryLater(fn: () => Promise<void>): void {
  const timer = setTimeout(() => fn().catch((err) => console.error("[matching] retry failed", err)), RETRY_MS);
  timer.unref?.();
}

type SearchOpts = { maxPriceCents?: number | null; excludeSellerId?: string };

function rankByKeywords(query: string, listings: Listing[], opts: SearchOpts): SearchResult[] {
  const results: SearchResult[] = [];
  for (const listing of listings) {
    if (listing.status !== "active") continue;
    if (opts.excludeSellerId && listing.sellerId === opts.excludeSellerId) continue;
    if (opts.maxPriceCents != null && listing.priceCents > opts.maxPriceCents) continue;
    const score = keywordScore(query, `${listing.title} ${listing.category} ${listing.description}`);
    if (score >= KEYWORD_THRESHOLD) results.push({ listing, score });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, LIMITS.maxSearchResults);
}

/** Memory mode: only listings this process has seen (re-read from the db so status/price are fresh). */
async function keywordSearch(query: string, opts: SearchOpts): Promise<SearchResult[]> {
  const fresh: Listing[] = [];
  for (const listing of activeListings.values()) {
    const row = await db.getListing(listing.id);
    if (row) fresh.push(row);
  }
  return rankByKeywords(query, fresh, opts);
}

/**
 * Postgres mode fallback (Gemini down): read candidates from the database, because this process's Maps
 * are empty after a restart. Exported so tests can call it without depending on DB_MODE at import time.
 */
export async function keywordSearchFromDb(query: string, opts: SearchOpts = {}): Promise<SearchResult[]> {
  return rankByKeywords(query, await db.activeListings(200), opts);
}

async function keywordCandidates(listing: Listing): Promise<{ want: Want; score: number }[]> {
  const found: { want: Want; score: number }[] = [];
  for (const want of openWants.values()) {
    const fresh = await db.getWant(want.id);
    if (!fresh || fresh.status !== "open" || fresh.buyerId === listing.sellerId) continue;
    if (fresh.maxPriceCents != null && listing.priceCents > fresh.maxPriceCents * SPREAD_MAX_FACTOR) continue; // near misses ping, wide spreads get a notice
    const score = keywordScore(fresh.queryText, `${listing.title} ${listing.category} ${listing.description}`);
    if (score >= KEYWORD_THRESHOLD) found.push({ want: fresh, score });
  }
  return found.sort((a, b) => b.score - a.score);
}
