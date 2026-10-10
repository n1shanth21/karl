// SHARED CONTRACT for the database layer. Owner of the implementation: Himagna (data branch).
// The agent and backend branches call ONLY these functions. No SQL anywhere outside src/db.
// Changing a signature here = tell the team first (it breaks callers). Adding methods is fine.

import type {
  ConversationState,
  Listing,
  ListingDraft,
  ListingStatus,
  Match,
  SearchResult,
  Stats,
  StoredMessage,
  User,
  Want,
  WantStatus,
} from "../types";

export type ListingPatch = Partial<
  Pick<Listing, "title" | "description" | "category" | "condition" | "priceCents" | "status" | "photoId">
>;
export type MatchPatch = Partial<
  Pick<Match, "status" | "holdExpiresAt" | "meetupSpot" | "meetupAt" | "buyerConfirmed" | "sellerConfirmed">
>;
export type UserPatch = Partial<{ firstName: string | null; optedOut: boolean; state: ConversationState; spaceId: string }>;

export interface Db {
  // users
  getUser(id: string): Promise<User | null>;
  getUserByPhone(phone: string): Promise<User | null>;
  createUser(input: { phone: string; spaceId: string }): Promise<User>;
  updateUser(id: string, patch: UserPatch): Promise<User>;

  // conversation history
  /** Returns false if this platformMessageId was already saved (duplicate delivery -> skip it). */
  saveInbound(input: { userId: string; text: string; platformMessageId: string }): Promise<boolean>;
  saveOutbound(input: { userId: string; text: string }): Promise<void>;
  recentMessages(userId: string, limit: number): Promise<StoredMessage[]>;

  // photos (stored as JPEG bytes; served by backend at /photos/:id)
  savePhoto(bytes: Uint8Array, mimeType: string): Promise<string>;
  getPhoto(id: string): Promise<{ bytes: Uint8Array; mimeType: string } | null>;

  // listings
  createListing(input: { sellerId: string; draft: ListingDraft; photoId: string | null }): Promise<Listing>; // status "draft"
  getListing(id: string): Promise<Listing | null>;
  updateListing(id: string, patch: ListingPatch): Promise<Listing>;
  listingsBySeller(sellerId: string, statuses?: ListingStatus[]): Promise<Listing[]>;

  // wants
  createWant(input: { buyerId: string; queryText: string; maxPriceCents: number | null }): Promise<Want>; // status "open"
  getWant(id: string): Promise<Want | null>;
  updateWantStatus(id: string, status: WantStatus): Promise<Want>;
  openWantsByBuyer(buyerId: string): Promise<Want[]>;
  openWantsExpiredBefore(date: Date): Promise<Want[]>;

  // matches
  createMatch(input: { listingId: string; buyerId: string; sellerId: string }): Promise<Match>; // status "proposed"
  getMatch(id: string): Promise<Match | null>;
  updateMatch(id: string, patch: MatchPatch): Promise<Match>;
  /** Matches in proposed / accepted / meetup_set where this user is buyer or seller. */
  activeMatchesForUser(userId: string): Promise<Match[]>;
  /** status "accepted" and holdExpiresAt < date. */
  matchesWithExpiredHold(date: Date): Promise<Match[]>;
  /** status "meetup_set" and meetupAt < date (caller adds the check-in delay). */
  matchesDueForCheckin(date: Date): Promise<Match[]>;

  // analytics (events table = Tiger hypertable in postgres mode)
  logEvent(type: string, data?: { userId?: string; listingId?: string; payload?: Record<string, unknown> }): Promise<void>;
  getStats(): Promise<Stats>;

  // embeddings + vector search (Phase D2). Postgres uses pgvector; memory keeps the keyword path in
  // src/matching, so the memory versions just store nothing and find nothing.
  setListingEmbedding(listingId: string, embedding: number[]): Promise<void>;
  setWantEmbedding(wantId: string, embedding: number[]): Promise<void>;
  /** Active listings closest in meaning, best first. score = cosine similarity, 0..1. */
  searchListingsByVector(
    embedding: number[],
    opts: { maxPriceCents?: number | null; excludeSellerId?: string; minScore: number; limit: number },
  ): Promise<SearchResult[]>;
  /** Open, unexpired wants this listing satisfies (price within max, not the seller's own), best first. */
  openWantsByVector(
    embedding: number[],
    opts: { priceCents: number; excludeBuyerId: string; minScore: number },
  ): Promise<{ want: Want; score: number }[]>;
  /** How many events of this type a user has had since a time (daily ping cap). listingId narrows it to one listing. */
  countEventsSince(type: string, opts: { userId: string; since: Date; listingId?: string }): Promise<number>;

  // robustness + price hints (Phase DX)
  /** Active listings, newest first (keyword search fallback when Gemini is down). */
  activeListings(limit: number): Promise<Listing[]>;
  /** Active listings / open wants that still have no embedding (Gemini failed when they were created). */
  activeListingsMissingEmbedding(): Promise<Listing[]>;
  openWantsMissingEmbedding(): Promise<Want[]>;
  /** Prices (cents) of sold listings whose category matches (case-insensitive), newest first. */
  soldPricesForCategory(category: string, limit: number): Promise<number[]>;

  /** Test/demo helper: wipe everything. */
  reset(): Promise<void>;
}
