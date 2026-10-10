// In-memory fake database. Lets everyone run the whole app with ZERO setup (DB_MODE=memory),
// and lets tests run without Tiger Data. Data is lost on restart. Owner: Himagna (data branch).
// Keep it behaving the same as postgres.ts so tests mean something.

import type { Listing, Match, Stats, StoredMessage, User, Want } from "../types";
import {
  activeListings,
  activeMatchesForUser,
  computeStats,
  defined,
  matchesDueForCheckin,
  matchesWithExpiredHold,
  must,
  newMatch,
  newWant,
  soldPricesForCategory,
} from "./memory-helpers";
import type { Db } from "./types";

const id = () => crypto.randomUUID();

export function createMemoryDb(): Db {
  let users = new Map<string, User>();
  let listings = new Map<string, Listing>();
  let wants = new Map<string, Want>();
  let matches = new Map<string, Match>();
  let photos = new Map<string, { bytes: Uint8Array; mimeType: string }>();
  let messages: StoredMessage[] = [];
  let seenMessageIds = new Set<string>();
  let events: { ts: Date; type: string; userId?: string; listingId?: string; payload?: Record<string, unknown> }[] = [];
  // The db layer logs its own analytics events (same five as postgres); flows never call logEvent for these.
  const record = (type: string, data: { userId?: string; listingId?: string; payload?: Record<string, unknown> }) =>
    events.push({ ts: new Date(), type, ...data });


  return {
    async getUser(userId) {
      return users.get(userId) ?? null;
    },
    async getUserByPhone(phone) {
      return [...users.values()].find((u) => u.phone === phone) ?? null;
    },
    async createUser({ phone, spaceId }) {
      const existing = [...users.values()].find((u) => u.phone === phone);
      if (existing) {
        // Same as postgres (upsert on phone): a second create for the same number returns that user.
        const updated = { ...existing, spaceId };
        users.set(existing.id, updated);
        return updated;
      }
      const user: User = { id: id(), phone, spaceId, firstName: null, optedOut: false, state: { kind: "onboarding" }, createdAt: new Date() };
      users.set(user.id, user);
      record("user_created", { userId: user.id, payload: {} });
      return user;
    },
    async updateUser(userId, patch) {
      const user = { ...must(users.get(userId), "user"), ...defined(patch) };
      users.set(userId, user);
      return user;
    },

    async saveInbound({ userId, text, platformMessageId }) {
      if (seenMessageIds.has(platformMessageId)) return false;
      seenMessageIds.add(platformMessageId);
      messages.push({ userId, direction: "in", text, platformMessageId, createdAt: new Date() });
      return true;
    },
    async saveOutbound({ userId, text }) {
      messages.push({ userId, direction: "out", text, platformMessageId: null, createdAt: new Date() });
    },
    async recentMessages(userId, limit) {
      if (limit <= 0) return [];
      return messages.filter((m) => m.userId === userId).slice(-limit);
    },

    async savePhoto(bytes, mimeType) {
      const photoId = id();
      photos.set(photoId, { bytes, mimeType });
      return photoId;
    },
    async getPhoto(photoId) {
      return photos.get(photoId) ?? null;
    },

    async createListing({ sellerId, draft, photoId }) {
      const { confidence: _confidence, ...fields } = draft;
      const listing: Listing = { id: id(), sellerId, ...fields, photoId, status: "draft", createdAt: new Date() };
      listings.set(listing.id, listing);
      return listing;
    },
    async getListing(listingId) {
      return listings.get(listingId) ?? null;
    },
    async updateListing(listingId, patch) {
      const before = must(listings.get(listingId), "listing");
      const listing = { ...before, ...defined(patch) };
      listings.set(listingId, listing);
      if (before.status === "draft" && listing.status === "active") {
        record("listing_activated", {
          userId: listing.sellerId,
          listingId,
          payload: { priceCents: listing.priceCents, category: listing.category },
        });
      }
      return listing;
    },
    async listingsBySeller(sellerId, statuses) {
      return [...listings.values()].filter((l) => l.sellerId === sellerId && (!statuses || statuses.includes(l.status)));
    },

    async createWant({ buyerId, queryText, maxPriceCents }) {
      const want = newWant(id(), { buyerId, queryText, maxPriceCents });
      wants.set(want.id, want);
      record("want_created", { userId: buyerId, payload: { maxPriceCents } });
      return want;
    },
    async getWant(wantId) {
      return wants.get(wantId) ?? null;
    },
    async updateWantStatus(wantId, status) {
      const want = { ...must(wants.get(wantId), "want"), status };
      wants.set(wantId, want);
      return want;
    },
    async openWantsByBuyer(buyerId) {
      return [...wants.values()].filter((w) => w.buyerId === buyerId && w.status === "open");
    },
    async openWantsExpiredBefore(date) {
      return [...wants.values()].filter((w) => w.status === "open" && w.expiresAt < date);
    },

    async createMatch({ listingId, buyerId, sellerId }) {
      const match = newMatch(id(), { listingId, buyerId, sellerId });
      matches.set(match.id, match);
      return match;
    },
    async getMatch(matchId) {
      return matches.get(matchId) ?? null;
    },
    async updateMatch(matchId, patch) {
      const before = must(matches.get(matchId), "match");
      const match = { ...before, ...defined(patch) };
      matches.set(matchId, match);
      if (before.status === "proposed" && match.status === "accepted") {
        record("match_accepted", { userId: match.buyerId, listingId: match.listingId, payload: { matchId } });
      } else if (before.status !== "completed" && match.status === "completed") {
        record("sale_completed", {
          userId: match.buyerId,
          listingId: match.listingId,
          payload: { matchId, sellerId: match.sellerId },
        });
      }
      return match;
    },
    async activeMatchesForUser(userId) {
      return activeMatchesForUser(matches, userId);
    },
    async matchesWithExpiredHold(date) {
      return matchesWithExpiredHold(matches, date);
    },
    async matchesDueForCheckin(date) {
      return matchesDueForCheckin(matches, date);
    },

    async logEvent(type, data) {
      record(type, { userId: data?.userId, listingId: data?.listingId, payload: data?.payload });
    },
    async getStats(): Promise<Stats> {
      return computeStats(users, listings, wants);
    },

    // Memory mode matches by keyword in src/matching instead of by vector.
    async setListingEmbedding() {},
    async setWantEmbedding() {},
    async searchListingsByVector() {
      return [];
    },
    async openWantsByVector() {
      return [];
    },
    async countEventsSince(type, { userId, since, listingId }) {
      return events.filter(
        (e) => e.type === type && e.userId === userId && e.ts >= since && (listingId === undefined || e.listingId === listingId),
      ).length;
    },

    async activeListings(limit) {
      return activeListings(listings, limit);
    },
    // Memory never stores embeddings, so there is never anything to backfill.
    async activeListingsMissingEmbedding() {
      return [];
    },
    async openWantsMissingEmbedding() {
      return [];
    },
    async soldPricesForCategory(category, limit) {
      return soldPricesForCategory(listings, category, limit);
    },

    async reset() {
      users = new Map();
      listings = new Map();
      wants = new Map();
      matches = new Map();
      photos = new Map();
      messages = [];
      seenMessageIds = new Set();
      events = [];
    },
  };
}
