// SHARED CONTRACT for safety. Owner of the implementation: Aarush (backend branch).
// Agent calls these before listing an item and before relaying any message.
// Phase 0 stubs allow everything. TODO(Aarush, Phase B1): real rules + tests.

import type { ListingDraft, SafetyVerdict } from "../types";

/** Block prohibited items (alcohol, drugs, meds, weapons, vapes, tickets, stolen-looking, digital accounts). */
export function checkProhibited(_draft: ListingDraft): SafetyVerdict {
  return { action: "allow" };
}

/**
 * Scan a message before Karl relays it to the other person.
 * block: phone numbers, emails, social handles, outside links, gift cards / wire requests.
 * warn:  "pay first" / deposit requests, pressure to move off-platform.
 * allow: everything normal ("omw", "running 5 late", "can we do the Pit instead").
 * The reason is shown to the user, so write it in Karl's voice.
 */
export async function scanRelayMessage(_text: string): Promise<SafetyVerdict> {
  return { action: "allow" };
}

/** Per-user rate limit. Returns false if this user should be throttled right now. */
export function allowMessage(_userId: string): boolean {
  return true;
}
