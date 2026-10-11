// Pure helpers for the in-memory fake database (memory.ts). They take the maps they need as
// plain arguments and never change them, so memory.ts stays small. Owner: Himagna (data branch).

import { config } from "../config";
import type { Listing, Match, MatchStatus, Stats, User, Want } from "../types";
import { photoUrl } from "./pg/client";

const ACTIVE_MATCH = ["proposed", "accepted", "meetup_set"];

export const must = <T>(value: T | undefined, what: string): T => {
  if (!value) throw new Error(`${what} not found`);
  return value;
};

// Same as postgres: keys whose value is undefined are ignored, not written.
export const defined = <T extends object>(patch: T): Partial<T> =>
  Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;

export function computeStats(users: Map<string, User>, listings: Map<string, Listing>, wants: Map<string, Want>): Stats {
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
      photoUrl: l.photoId ? photoUrl(config.publicBaseUrl, l.photoId) : null,
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
}

export function activeListings(listings: Map<string, Listing>, limit: number): Listing[] {
  return [...listings.values()]
    .filter((l) => l.status === "active")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, Math.max(0, limit));
}

export function soldPricesForCategory(listings: Map<string, Listing>, category: string, limit: number): number[] {
  return [...listings.values()]
    .filter((l) => l.status === "sold" && l.category.toLowerCase() === category.toLowerCase())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, Math.max(0, limit))
    .map((l) => l.priceCents);
}

export function activeMatchesForUser(matches: Map<string, Match>, userId: string): Match[] {
  return [...matches.values()].filter(
    (m) => (m.buyerId === userId || m.sellerId === userId) && ACTIVE_MATCH.includes(m.status),
  );
}

export function matchesWithExpiredHold(matches: Map<string, Match>, date: Date): Match[] {
  return [...matches.values()].filter((m) => m.status === "accepted" && m.holdExpiresAt !== null && m.holdExpiresAt < date);
}

export function matchesDueForCheckin(matches: Map<string, Match>, date: Date): Match[] {
  return [...matches.values()].filter((m) => m.status === "meetup_set" && m.meetupAt !== null && m.meetupAt < date);
}

export function matchesByStatus(matches: Map<string, Match>, status: MatchStatus, createdBefore: Date): Match[] {
  return [...matches.values()].filter((m) => m.status === status && m.createdAt < createdBefore);
}

// A new want is open for 7 days.
export function newWant(
  id: string,
  { buyerId, queryText, maxPriceCents }: { buyerId: string; queryText: string; maxPriceCents: number | null },
): Want {
  return {
    id,
    buyerId,
    queryText,
    maxPriceCents,
    status: "open",
    expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
    createdAt: new Date(),
  };
}

export function newMatch(
  id: string,
  { listingId, buyerId, sellerId }: { listingId: string; buyerId: string; sellerId: string },
): Match {
  return {
    id,
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
}
