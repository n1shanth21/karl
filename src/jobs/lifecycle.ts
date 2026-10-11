// Lifecycle timers: meetup check-in reminders and the "no ghost orders" staleness sweep.
// Jobs never send texts: they log events, update the DB and emit bus events; src/agent/lifecycle.ts sends.
// Both only fire between 10:00 and 20:00 New York time, decided on the tick's `now`.

import { bus } from "../bus";
import { LIMITS } from "../config";
import { db } from "../db";
import { eventTime, hasOpenStaleQuestion, inSendWindow, recordStalePing, staleAction, type StaleTarget } from "../flows/staleness";
import type { User } from "../types";

export const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 60 * MINUTE_MS;
export const MAX_REMINDERS = 2; // re-ask "did it happen?" at +24 h and +48 h after the check-in, never a 3rd
const REMINDER_LOOKBACK_MS = 4 * DAY_MS; // don't nag about meetups older than this (e.g. after a long outage)
const SWEEP_LIMIT = 10_000;

function logError(job: string, id: string, err: unknown): void {
  console.error(`[jobs] ${job} failed for ${id}:`, err instanceof Error ? err.message : err);
}

/** Meetups nobody confirmed: re-ask every 24 h after the last check-in, at most twice. */
export async function checkinReminders(now: Date): Promise<void> {
  if (!inSendWindow(now)) return;
  const delayMs = LIMITS.meetupCheckinDelayMin * MINUTE_MS;
  // status meetup_set + check-in time (meetupAt + delay) at least 24 h ago (the query is strict "<", hence +1 ms)
  for (const match of await db.matchesDueForCheckin(new Date(now.getTime() - delayMs - DAY_MS + 1))) {
    try {
      if (!match.meetupAt) continue;
      const checkinAt = match.meetupAt.getTime() + delayMs;
      if (checkinAt < now.getTime() - REMINDER_LOOKBACK_MS) continue;
      const past = await db.findEvents("checkin_reminder", { payload: { matchId: match.id }, limit: MAX_REMINDERS + 1 });
      if (past.length >= MAX_REMINDERS) continue;
      const lastAsked = past.length ? eventTime(past[0]!).getTime() : checkinAt;
      if (now.getTime() - lastAsked < DAY_MS) continue;
      await db.logEvent("checkin_reminder", {
        listingId: match.listingId,
        payload: { matchId: match.id, at: now.toISOString() },
      });
      bus.emit("checkin_reminder_due", { matchId: match.id });
    } catch (err) {
      logError("checkinReminders", match.id, err);
    }
  }
}

/** Open listings/wants quiet for 48 h: ask the owner; two unanswered asks: close it. Seed + opted-out users are skipped. */
export async function staleSweep(now: Date): Promise<void> {
  if (!inSendWindow(now)) return;
  const users = new Map<string, User | null>();
  const askable = async (userId: string): Promise<boolean> => {
    if (!users.has(userId)) users.set(userId, await db.getUser(userId));
    const u = users.get(userId);
    return !!u && !u.optedOut && !u.phone.startsWith("seed:") && u.spaceId !== "seed";
  };

  const handle = async (userId: string, target: StaleTarget, createdAt: Date, close: () => Promise<unknown>) => {
    if (!(await askable(userId))) return;
    const action = await staleAction(userId, target, createdAt, now);
    if (action === "ping") {
      if (await hasOpenStaleQuestion(userId, now)) return; // one open question per user; the next tick retries
      await recordStalePing(userId, target, now);
      bus.emit("stale_check_due", { userId, ...target });
    } else if (action === "close") {
      await close();
      await db.logEvent("stale_auto_closed", {
        userId,
        listingId: target.listingId,
        payload: { ...(target.wantId ? { wantId: target.wantId } : {}), at: now.toISOString() },
      });
      bus.emit("stale_auto_closed", { userId, ...target });
    }
  };

  for (const l of await db.activeListings(SWEEP_LIMIT)) {
    try {
      if ((await db.activeMatchesForUser(l.sellerId)).some((m) => m.listingId === l.id)) continue; // a deal is in progress: not stale
      await handle(l.sellerId, { listingId: l.id }, l.createdAt, () => db.updateListing(l.id, { status: "removed" }));
    } catch (err) {
      logError("staleSweep listing", l.id, err);
    }
  }
  for (const w of await db.openWants(SWEEP_LIMIT)) {
    await handle(w.buyerId, { wantId: w.id }, w.createdAt, () => db.updateWantStatus(w.id, "closed")).catch((err) =>
      logError("staleSweep want", w.id, err),
    );
  }
}
