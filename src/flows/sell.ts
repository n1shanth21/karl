// Sell flow. Owner: Nishanth. Flows message OTHER users themselves; for the CURRENT user they
// return data/text and the caller (inbound or the agent loop) sends the reply.

import type { Listing, User } from "../types";

export type DraftResult =
  | { ok: true; listing: Listing; reply: string } // reply = "mini fridge, good condition, $45. post it?"
  | { ok: false; reply: string }; // unclear photo / prohibited item, in Karl's voice

/** Photo in → JPEG → saved → Gemini vision → draft listing. Sets user.state = drafting_listing.
 *  The caller sends `reply` with ref { kind: "draft", listingId }. */
export async function draftFromPhoto(_user: User, _photo: { bytes: Uint8Array; mimeType: string }, _caption?: string): Promise<DraftResult> {
  throw new Error("TODO(wave1-sellbuy)");
}

/** Edit the user's current draft (price/condition/title). Returns null if there's no draft. */
export async function updateDraft(_user: User, _patch: { priceCents?: number; condition?: Listing["condition"]; title?: string }): Promise<Listing | null> {
  throw new Error("TODO(wave1-sellbuy)");
}

/** Publish the current draft (or listingId): checkProhibited → active-listing limit → status active →
 *  onListingActivated → logEvent → state idle. */
export async function confirmDraft(_user: User, _listingId?: string): Promise<{ ok: true; listing: Listing } | { ok: false; reason: string }> {
  throw new Error("TODO(wave1-sellbuy)");
}

export async function cancelDraft(_user: User): Promise<boolean> {
  throw new Error("TODO(wave1-sellbuy)");
}

/** Remove one of the user's own active listings. */
export async function removeListing(_user: User, _listingId: string): Promise<boolean> {
  throw new Error("TODO(wave1-sellbuy)");
}
