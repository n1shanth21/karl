// Order-book spreads: a bid (want) and an ask (listing) for the same item, too far apart for a near-miss ping
// (ask > 1.5x bid, up to 3x). Both sides hear about each other once, so they can try to meet in the middle.
// Events are logged first (survives restarts, counts for the seller's daily cap), then spread_found is emitted.

import { bus } from "../bus";
import { LIMITS } from "../config";
import { db } from "../db";
import type { Listing, Want } from "../types";
import { NEAR_MISS_FACTOR, SPREAD_MAX_FACTOR } from "./thresholds";

/** Event type logged each time we proactively ping a buyer (counted for the daily cap). */
export const PING_EVENT = "match_pinged";
/** Logged for the buyer, once per (buyer, listing) pair. */
export const SPREAD_EVENT = "spread_noticed";
/** Logged for the seller each time, to cap how many bid notices one seller gets per day. */
export const SPREAD_SELLER_EVENT = "spread_seller_noticed";
export const MAX_SPREAD_NOTICES_PER_SELLER_PER_DAY = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** "match": ask <= 1.5x the bid (normal / near-miss ping, or no bid). "spread": up to 3x. "none": too far apart. */
export function priceBand(askCents: number, bidCents: number | null): "match" | "spread" | "none" {
  if (bidCents == null || askCents <= bidCents * NEAR_MISS_FACTOR) return "match";
  return askCents <= bidCents * SPREAD_MAX_FACTOR ? "spread" : "none";
}

/** Tell both sides about the spread, unless it was told before or the seller hit today's cap. True when emitted. */
export async function noticeSpread(listing: Listing, want: Want, now: Date = new Date()): Promise<boolean> {
  if (listing.status !== "active" || want.status !== "open" || want.buyerId === listing.sellerId) return false;
  if (priceBand(listing.priceCents, want.maxPriceCents) !== "spread") return false;
  const [buyer, seller] = await Promise.all([db.getUser(want.buyerId), db.getUser(listing.sellerId)]);
  if (!buyer || !seller || buyer.optedOut || seller.optedOut) return false;

  const told = await db.countEventsSince(SPREAD_EVENT, { userId: buyer.id, listingId: listing.id, since: new Date(0) });
  if (told > 0) return false;
  if ((await db.countEventsSince(PING_EVENT, { userId: buyer.id, listingId: listing.id, since: new Date(0) })) > 0) return false; // already pinged about it
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const buyerToday = (await db.countEventsSince(SPREAD_EVENT, { userId: buyer.id, since: dayAgo })) + (await db.countEventsSince(PING_EVENT, { userId: buyer.id, since: dayAgo }));
  if (buyerToday >= LIMITS.maxProactivePingsPerUserPerDay) return false; // shares the buyer's daily cap with match pings
  const today = await db.countEventsSince(SPREAD_SELLER_EVENT, { userId: seller.id, since: dayAgo });
  if (today >= MAX_SPREAD_NOTICES_PER_SELLER_PER_DAY) return false;

  const payload = { wantId: want.id };
  await db.logEvent(SPREAD_EVENT, { userId: buyer.id, listingId: listing.id, payload });
  await db.logEvent(SPREAD_SELLER_EVENT, { userId: seller.id, listingId: listing.id, payload });
  bus.emit("spread_found", { wantId: want.id, listingId: listing.id, buyerId: buyer.id, sellerId: seller.id });
  return true;
}
