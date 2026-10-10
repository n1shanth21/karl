// Buy flow. Owner: Nishanth.

import type { Listing, User, Want } from "../types";

/** Search and SEND up to 3 results to the user (photo + "**title** · $45", each tagged ref result).
 *  Sets state choosing_result. Returns what was shown ([] = nothing found; caller offers save_want). */
export async function searchAndShow(_user: User, _query: string, _maxPriceCents: number | null): Promise<Listing[]> {
  throw new Error("TODO(wave1-sellbuy)");
}

/** Buyer picks a shown result by 1-based index or listingId → match.proposeMatch. Returns Karl's reply. */
export async function pickResult(_user: User, _pick: { index?: number; listingId?: string }): Promise<string> {
  throw new Error("TODO(wave1-sellbuy)");
}

/** Save a want + onWantCreated. */
export async function saveWant(_user: User, _query: string, _maxPriceCents: number | null): Promise<Want> {
  throw new Error("TODO(wave1-sellbuy)");
}

export async function cancelWant(_user: User, _wantId: string): Promise<boolean> {
  throw new Error("TODO(wave1-sellbuy)");
}

/** Short text summary of the user's active listings, open wants and active matches (with ids for tools). */
export async function myStuff(_user: User): Promise<string> {
  throw new Error("TODO(wave1-sellbuy)");
}
