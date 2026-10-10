// SHARED CONTRACT for the database layer. Owner of the implementation: Himagna (data branch).
// The agent and backend branches call ONLY these functions. No SQL anywhere outside src/db.
// Changing a signature here = tell the team first (it breaks callers). Adding methods is fine.

import type {
  ConversationState,
  Listing,
  ListingDraft,
  ListingStatus,
  Match,
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

  /** Test/demo helper: wipe everything. */
  reset(): Promise<void>;
}
