// Sell flow. Owner: Nishanth. Flows message OTHER users themselves; for the CURRENT user they
// return data/text and the caller (inbound or the agent loop) sends the reply.

import { runForListing, setItem, setStep, startRun } from "../agent/activity";
import { gemini } from "../agent/gemini";
import { LIMITS } from "../config";
import { db } from "../db";
import { onListingActivated } from "../matching";
import { checkProhibited } from "../safety";
import type { Listing, User } from "../types";
import { conditionText, dollars, itemName } from "./format";
import { toJpeg } from "./photo";

export type DraftResult =
  | { ok: true; listing: Listing; reply: string } // reply = "mini fridge, good condition, $45. post it?"
  | { ok: false; reply: string }; // unclear photo / prohibited item, in Karl's voice

/** Finds a price in a caption: "$40", "40 bucks", "for 40". Returns cents or null. */
function priceFromCaption(caption?: string): number | null {
  const match = caption?.match(/\$\s?(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:bucks|dollars)|\bfor\s+(\d+)\b/i);
  const amount = match?.[1] ?? match?.[2] ?? match?.[3];
  return amount ? Math.round(Number(amount) * 100) : null;
}

/** The user's draft listing: the given one, or the one their conversation state points at. */
async function draftFor(user: User, listingId?: string): Promise<Listing | null> {
  const fresh = await db.getUser(user.id); // the caller's `user` may predate the last state change
  const id = listingId ?? (fresh?.state.kind === "drafting_listing" ? fresh.state.listingId : null);
  const listing = id ? await db.getListing(id) : null;
  return listing?.sellerId === user.id && listing.status === "draft" ? listing : null;
}

/** Photo in → JPEG → saved → Gemini vision → draft listing. Sets user.state = drafting_listing.
 *  The caller sends `reply` with ref { kind: "draft", listingId }. */
export async function draftFromPhoto(user: User, photo: { bytes: Uint8Array; mimeType: string }, caption?: string): Promise<DraftResult> {
  const run = startRun("sell", user.firstName);
  setStep(run, "received", "done");
  const jpeg = await toJpeg(photo.bytes, photo.mimeType);
  setStep(run, "photo_converted", "done");
  const photoId = await db.savePhoto(jpeg.bytes, jpeg.mimeType);
  setStep(run, "vision_draft", "active");
  const described = await gemini.describeItem(jpeg.bytes, caption);
  setStep(run, "vision_draft", described ? "done" : "failed");
  if (!described) return { ok: false, reply: "hmm can't tell what that is, can you send another angle?" };
  setItem(run, described.title);

  const draft = { ...described, priceCents: priceFromCaption(caption) ?? described.priceCents };
  const verdict = checkProhibited(draft);
  setStep(run, "safety", verdict.action === "block" ? "failed" : "done");
  if (verdict.action === "block") return { ok: false, reply: verdict.reason ?? "sorry, i can't help list that one" };

  const listing = await db.createListing({ sellerId: user.id, draft, photoId });
  runForListing(listing.id, run);
  setStep(run, "awaiting_confirm", "active");
  await db.updateUser(user.id, { state: { kind: "drafting_listing", listingId: listing.id } });
  const reply = `${itemName(listing)}, ${conditionText(listing.condition)}, ${dollars(listing.priceCents)}. post it? (❤️ or yes, or tell me a different price)`;
  return { ok: true, listing, reply };
}

/** Edit the user's current draft (price/condition/title). Returns null if there's no draft. */
export async function updateDraft(user: User, patch: { priceCents?: number; condition?: Listing["condition"]; title?: string }): Promise<Listing | null> {
  const draft = await draftFor(user);
  if (!draft) return null;
  const changes = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  return db.updateListing(draft.id, changes);
}

/** Publish the current draft (or listingId): checkProhibited → active-listing limit → status active →
 *  onListingActivated → logEvent → state idle. */
export async function confirmDraft(user: User, listingId?: string): Promise<{ ok: true; listing: Listing } | { ok: false; reason: string }> {
  const draft = await draftFor(user, listingId);
  if (!draft) return { ok: false, reason: "i don't have a draft waiting, send me a photo to start one" };

  const run = runForListing(draft.id);
  setStep(run, "awaiting_confirm", "done");
  const verdict = checkProhibited({ ...draft, confidence: 1 });
  if (verdict.action === "block") setStep(run, "safety", "failed");
  if (verdict.action === "block") return { ok: false, reason: verdict.reason ?? "sorry, i can't help list that one" };

  const active = await db.listingsBySeller(user.id, ["active"]);
  if (active.length >= LIMITS.maxActiveListingsPerUser) {
    return { ok: false, reason: `you already have ${active.length} things listed, remove one first and i'll post this` };
  }

  const listing = await db.updateListing(draft.id, { status: "active" });
  setStep(run, "live", "done");
  await onListingActivated(listing);
  setStep(run, "wants_checked", "done");
  await db.logEvent("listing_activated", { userId: user.id, listingId: listing.id });
  await db.updateUser(user.id, { state: { kind: "idle" } });
  return { ok: true, listing };
}

export async function cancelDraft(user: User): Promise<boolean> {
  const draft = await draftFor(user);
  if (!draft) return false;
  await db.updateListing(draft.id, { status: "removed" });
  await db.updateUser(user.id, { state: { kind: "idle" } });
  return true;
}

/** Remove one of the user's own active listings. */
export async function removeListing(user: User, listingId: string): Promise<boolean> {
  const listing = await db.getListing(listingId);
  if (listing?.sellerId !== user.id || (listing.status !== "active" && listing.status !== "held")) return false;
  await db.updateListing(listing.id, { status: "removed" });
  return true;
}
