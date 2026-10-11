// The three every-minute jobs. Each one updates the DB and emits a bus event.
// Jobs never send texts: src/agent/notifications.ts listens and does that.

import { bus } from "../bus";
import { LIMITS } from "../config";
import { db } from "../db";
import { releaseHold } from "../flows/holds";

const MINUTE_MS = 60_000;
// Only ask "did it happen?" about meetups from the last 12 hours. After a server
// restart (which forgets checkinsSent) this keeps re-asks to recent meetups only.
const CHECKIN_LOOKBACK_MS = 12 * 60 * MINUTE_MS;

// Match ids we already emitted meetup_checkin_due for. In memory; a restart clears it.
const checkinsSent = new Set<string>();

function logError(job: string, id: string, err: unknown): void {
  console.error(`[jobs] ${job} failed for ${id}:`, err instanceof Error ? err.message : err);
}

/** Holds that ran out → match "expired", listing back to "active", emit hold_expired. */
export async function expireHolds(now: Date): Promise<void> {
  for (const match of await db.matchesWithExpiredHold(now)) {
    try {
      await db.updateMatch(match.id, { status: "expired" });
      const listing = await db.getListing(match.listingId);
      // Never bring back a listing that sold or was removed in the meantime.
      // Do NOT call onListingActivated here: buyers were already pinged when it first went live.
      await releaseHold(listing); // also puts back the original asking price if a negotiated one was held
      await db.logEvent("hold_expired", { listingId: match.listingId });
      bus.emit("hold_expired", { matchId: match.id });
    } catch (err) {
      logError("expireHolds", match.id, err);
    }
  }
}

/** Meetups whose time + check-in delay has passed → emit meetup_checkin_due, once per match. */
export async function dueCheckins(now: Date): Promise<void> {
  const dueBefore = new Date(now.getTime() - LIMITS.meetupCheckinDelayMin * MINUTE_MS);
  const oldestAllowed = dueBefore.getTime() - CHECKIN_LOOKBACK_MS;
  for (const match of await db.matchesDueForCheckin(dueBefore)) {
    if (checkinsSent.has(match.id)) continue;
    if (match.meetupAt && match.meetupAt.getTime() < oldestAllowed) continue;
    checkinsSent.add(match.id);
    bus.emit("meetup_checkin_due", { matchId: match.id });
  }
}

/** Wants past expiresAt → status "closed", emit want_expired. */
export async function expireWants(now: Date): Promise<void> {
  for (const want of await db.openWantsExpiredBefore(now)) {
    try {
      await db.updateWantStatus(want.id, "closed");
      await db.logEvent("want_expired", { userId: want.buyerId });
      bus.emit("want_expired", { wantId: want.id, buyerId: want.buyerId });
    } catch (err) {
      logError("expireWants", want.id, err);
    }
  }
}
