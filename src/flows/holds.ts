// A negotiated price belongs to ONE buyer. If the deal falls through, the listing goes back to its original ask.
// In memory like the pending offers: a restart forgets it. Owner: Nishanth.

import { db } from "../db";
import type { Listing } from "../types";

const originalAsk = new Map<string, number>(); // listingId -> asking price before the negotiated one was written

/** Write the agreed price on a listing being held, remembering what it asked. */
export async function holdAtPrice(listing: Listing, agreedCents?: number): Promise<void> {
  if (agreedCents === undefined) return void (await db.updateListing(listing.id, { status: "held" }));
  if (!originalAsk.has(listing.id)) originalAsk.set(listing.id, listing.priceCents);
  await db.updateListing(listing.id, { status: "held", priceCents: agreedCents });
}

/** The deal fell through (cancel, expired hold, ban): a held listing is active again at its original ask. */
export async function releaseHold(listing: Listing | null): Promise<void> {
  if (listing?.status !== "held") return;
  const ask = originalAsk.get(listing.id);
  originalAsk.delete(listing.id);
  await db.updateListing(listing.id, ask === undefined ? { status: "active" } : { status: "active", priceCents: ask });
}

/** The deal completed: the negotiated price stands. */
export const keepAgreedPrice = (listingId: string) => originalAsk.delete(listingId);
