// Take the demo seed data off the market: listings from seed sellers -> "removed", wants from seed buyers -> "closed".
// Seed users have phone "seed:<name>" / spaceId "seed" (scripts/seed.ts). Real users' data is never touched.
// Run on Railway by setting UNSEED_ON_BOOT=1 (src/index.ts), or locally: bun scripts/unseed.ts

import { db } from "../db";
import { isSeedUser } from "../spectrum/send";

export async function unseed(): Promise<{ listings: number; wants: number }> {
  const seed = new Map<string, boolean>();
  const isSeed = async (userId: string) => {
    if (!seed.has(userId)) {
      const user = await db.getUser(userId);
      seed.set(userId, !!user && isSeedUser(user));
    }
    return seed.get(userId)!;
  };

  let listings = 0;
  for (const listing of await db.activeListings(5000)) {
    if (await isSeed(listing.sellerId)) {
      await db.updateListing(listing.id, { status: "removed" });
      listings++;
    }
  }
  let wants = 0;
  for (const want of await db.openWants(5000)) {
    if (await isSeed(want.buyerId)) {
      await db.updateWantStatus(want.id, "closed");
      wants++;
    }
  }
  console.log(`[unseed] removed ${listings} seed listings, closed ${wants} seed wants`);
  return { listings, wants };
}
