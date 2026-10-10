// In-memory fake database. Lets everyone run the whole app with ZERO setup (DB_MODE=memory),
// and lets tests run without Tiger Data. Data is lost on restart. Owner: Himagna (data branch).
// Keep it behaving the same as postgres.ts so tests mean something.

import { config } from "../config";
import type { Listing, Match, Stats, StoredMessage, User, Want } from "../types";
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
  let events: { ts: Date; type: string; userId?: string; listingId?: string }[] = [];

  const must = <T>(value: T | undefined, what: string): T => {
    if (!value) throw new Error(`${what} not found`);
    return value;
  };
  const ACTIVE_MATCH = ["proposed", "accepted", "meetup_set"];
  // Same as postgres: keys whose value is undefined are ignored, not written.
  const defined = <T extends object>(patch: T): Partial<T> =>
    Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;

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
      const listing = { ...must(listings.get(listingId), "listing"), ...defined(patch) };
      listings.set(listingId, listing);
      return listing;
    },
    async listingsBySeller(sellerId, statuses) {
      return [...listings.values()].filter((l) => l.sellerId === sellerId && (!statuses || statuses.includes(l.status)));
    },

    async createWant({ buyerId, queryText, maxPriceCents }) {
      const want: Want = {
        id: id(),
        buyerId,
        queryText,
        maxPriceCents,
        status: "open",
        expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
        createdAt: new Date(),
      };
      wants.set(want.id, want);
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
      const match: Match = {
        id: id(),
        listingId,
        buyerId,
        sellerId,
        status: "proposed",
        holdExpiresAt: null,
        meetupSpot: null,
        meetupAt: null,
        buyerConfirmed: false,
        sellerConfirmed: false,
        createdAt: new Date(),
      };
      matches.set(match.id, match);
      return match;
    },
    async getMatch(matchId) {
      return matches.get(matchId) ?? null;
    },
    async updateMatch(matchId, patch) {
      const match = { ...must(matches.get(matchId), "match"), ...defined(patch) };
      matches.set(matchId, match);
      return match;
    },
    async activeMatchesForUser(userId) {
      return [...matches.values()].filter(
        (m) => (m.buyerId === userId || m.sellerId === userId) && ACTIVE_MATCH.includes(m.status),
      );
    },
    async matchesWithExpiredHold(date) {
      return [...matches.values()].filter((m) => m.status === "accepted" && m.holdExpiresAt !== null && m.holdExpiresAt < date);
    },
    async matchesDueForCheckin(date) {
      return [...matches.values()].filter((m) => m.status === "meetup_set" && m.meetupAt !== null && m.meetupAt < date);
    },

    async logEvent(type, data) {
      events.push({ ts: new Date(), type, userId: data?.userId, listingId: data?.listingId });
    },
    async getStats(): Promise<Stats> {
      const all = [...listings.values()].filter((l) => l.status !== "draft");
      const sold = all.filter((l) => l.status === "sold");
      const recent = all
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 10)
        .map((l) => ({
          id: l.id,
          title: l.title,
          priceCents: l.priceCents,
          sellerFirstName: users.get(l.sellerId)?.firstName ?? "someone",
          photoUrl: l.photoId ? `${config.publicBaseUrl}/photos/${l.photoId}` : null,
          status: l.status,
          createdAt: l.createdAt.toISOString(),
        }));
      return {
        listedTotal: all.length,
        soldTotal: sold.length,
        activeListings: all.filter((l) => l.status === "active").length,
        openWants: [...wants.values()].filter((w) => w.status === "open").length,
        usersTotal: users.size,
        tradedCents: sold.reduce((sum, l) => sum + l.priceCents, 0),
        recent,
        listingsPerHour: [],
        updatedAt: new Date().toISOString(),
      };
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
    async countEventsSince(type, { userId, since }) {
      return events.filter((e) => e.type === type && e.userId === userId && e.ts >= since).length;
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
