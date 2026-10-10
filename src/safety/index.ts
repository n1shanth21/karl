// SHARED CONTRACT for safety. Owner of the implementation: Aarush (backend branch).
// Agent calls these before listing an item and before relaying any message.

import type { ListingDraft, SafetyVerdict } from "../types";
import { isBanned as isBannedUser } from "./bans";
import { checkPhoto, type ImageClassifier, type ImageVerdict } from "./image";
import { checkItem } from "./prohibited";
import { allowAt } from "./rateLimit";
import { scanText } from "./scan";

/** Block prohibited items (alcohol, drugs, meds, weapons, vapes, tickets, digital accounts, counterfeit, adult). */
export function checkProhibited(draft: ListingDraft): SafetyVerdict {
  return checkItem(draft);
}

/**
 * Scan a message before Karl relays it to the other person.
 * block: phone numbers, emails, social handles, outside links, gift cards / wire requests,
 *        sexual content, directed insults and slurs (casual swearing is allowed).
 * warn:  "pay first" / deposit requests, pressure to move off-platform.
 * allow: everything normal ("omw", "running 5 late", "can we do the Pit instead").
 * The reason is shown to the user, so write it in Karl's voice.
 */
export async function scanRelayMessage(text: string): Promise<SafetyVerdict> {
  return scanText(text);
}

/**
 * Per-user rate limit. Returns false if this user should be throttled right now.
 * Max LIMITS.rateLimitMessagesPer10Min messages in any 10 minutes. `now` is only passed by tests.
 */
export function allowMessage(userId: string, now: number = Date.now()): boolean {
  return allowAt(userId, now);
}

/**
 * Check an inbound photo BEFORE it is saved, drafted into a listing, or relayed.
 * explicit (nudity, sexual, gore, hate) → block AND ban the sender.
 * suggestive or couldn't check → block the photo only.
 * Send `reason` to the sender only. `classify` is only passed by tests.
 */
export async function checkImage(
  bytes: Uint8Array,
  mimeType: string,
  userId: string,
  classify?: ImageClassifier,
): Promise<ImageVerdict> {
  return checkPhoto(bytes, mimeType, userId, classify);
}

/** True if this user was banned (explicit photo). Karl should ignore them completely. */
export function isBanned(userId: string): boolean {
  return isBannedUser(userId);
}
