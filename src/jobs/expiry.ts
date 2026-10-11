// No ghost orders, part 2: deals and requests that nobody finishes get closed, and the listing goes back up.
// Jobs never send texts: they update the DB, log events and emit bus events; src/agent/lifecycle.ts sends.
// Both passes only run between 10:00 and 20:00 New York time (decided on the tick's `now`), like the stale sweep.
// An expired match is never "meetup_set" or "proposed" again, so each match is handled exactly once.

import { reopenOfferedWant } from "../agent/notifications";
import { bus } from "../bus";
import { LIMITS } from "../config";
import { db } from "../db";
import { releaseHold } from "../flows/holds";
import { clearOffer, offerWaiter } from "../flows/offers";
import { eventTime, inSendWindow } from "../flows/staleness";
import { DAY_MS, MAX_REMINDERS, MINUTE_MS } from "./lifecycle";

export const PROPOSAL_EXPIRES_MS = DAY_MS; // an unanswered request/offer lives this long

function logError(job: string, id: string, err: unknown): void {
  console.error(`[jobs] ${job} failed for ${id}:`, err instanceof Error ? err.message : err);
}

/** meetup_set matches with the check-in and both reminders sent, still unconfirmed 24 h after the last reminder. */
export async function closeStuckDeals(now: Date): Promise<void> {
  if (!inSendWindow(now)) return;
  // The check-in is at meetupAt + delay, reminders follow at +24 h and +48 h, so nothing can be stuck before +72 h
  // (query is strict "<", hence +1 ms).
  const candidates = await db.matchesDueForCheckin(new Date(now.getTime() - LIMITS.meetupCheckinDelayMin * MINUTE_MS - 3 * DAY_MS + 1));
  for (const match of candidates) {
    try {
      const past = await db.findEvents("checkin_reminder", { payload: { matchId: match.id }, limit: MAX_REMINDERS + 1 });
      if (past.length < MAX_REMINDERS) continue;
      const lastReminder = past.map((e) => eventTime(e).getTime()).reduce((a, b) => Math.max(a, b));
      if (now.getTime() - lastReminder < DAY_MS) continue;

      await db.updateMatch(match.id, { status: "expired" });
      await releaseHold(await db.getListing(match.listingId)); // held -> active again, original ask restored
      await reopenOfferedWant(match.buyerId, match.listingId);
      await db.logEvent("deal_auto_closed", { userId: match.buyerId, listingId: match.listingId, payload: { matchId: match.id, at: now.toISOString() } });
      bus.emit("deal_auto_closed", { matchId: match.id });
    } catch (err) {
      logError("closeStuckDeals", match.id, err);
    }
  }
}

/** "proposed" matches nobody answered for 24 h: expired, listing stays up (it was never held), buyer's want reopened. */
export async function expireProposals(now: Date): Promise<void> {
  if (!inSendWindow(now)) return;
  for (const match of await db.matchesByStatus("proposed", new Date(now.getTime() - PROPOSAL_EXPIRES_MS + 1))) {
    try {
      const waiting = offerWaiter(match.id); // who named the price on the table, i.e. who is waiting for an answer
      await db.updateMatch(match.id, { status: "expired" });
      clearOffer(match.id);
      // A proposed match never held the listing or changed its price, so there is nothing to undo there.
      // (Do not releaseHold: another buyer's accepted deal may be holding it.)
      await reopenOfferedWant(match.buyerId, match.listingId);
      await db.logEvent("proposal_expired", {
        userId: match.buyerId,
        listingId: match.listingId,
        payload: { matchId: match.id, waiting, at: now.toISOString() },
      });
      bus.emit("proposal_expired", { matchId: match.id });
    } catch (err) {
      logError("expireProposals", match.id, err);
    }
  }
}
