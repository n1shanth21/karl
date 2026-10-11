// No ghost orders: open listings/wants get a "still selling / still looking?" check every 48 h. Owner: Nishanth.
// State lives in the events table (no schema change): "stale_ping" when Karl asks, "stale_confirm" when the user says yes.
// All of that events logic is in this file; src/jobs/lifecycle.ts only calls it. Our own events carry payload.at
// (the time the job/user acted) so the clock follows the tick's `now`, not the wall clock.

import { db } from "../db";
import type { EventRow } from "../db/types";

export const STALE_AFTER_MS = 48 * 60 * 60_000; // quiet this long -> ask; unanswered this long -> ask again
export const MAX_STALE_PINGS = 2; // after this many unanswered pings, close it
const SEND_FROM_HOUR = 10; // Karl only starts these texts between 10:00 and 20:00 New York time
const SEND_UNTIL_HOUR = 20;

export type StaleTarget = { listingId?: string; wantId?: string };

/** True between 10:00 and 20:00 America/New_York (the only time lifecycle texts are triggered). */
export function inSendWindow(now: Date): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(now),
  );
  return hour >= SEND_FROM_HOUR && hour < SEND_UNTIL_HOUR;
}

/** When an event happened: its payload.at (set from the job's `now`), else the row timestamp. */
export function eventTime(e: EventRow): Date {
  const at = typeof e.payload.at === "string" ? new Date(e.payload.at) : null;
  return at && !Number.isNaN(at.getTime()) ? at : e.ts;
}

// Events for one listing live on listing_id; events for one want carry payload.wantId.
const key = (userId: string, t: StaleTarget) =>
  t.listingId ? { userId, listingId: t.listingId } : { userId, payload: { wantId: t.wantId ?? "" } };
const data = (userId: string, t: StaleTarget, now: Date) => ({
  ...key(userId, t),
  payload: { ...(t.wantId ? { wantId: t.wantId } : {}), at: now.toISOString() },
});

/** The user said 👍 "still selling / still looking": restart the 48 h clock for that listing/want. */
export async function markStillActive(userId: string, target: StaleTarget, now = new Date()): Promise<void> {
  await db.logEvent("stale_confirm", data(userId, target, now));
}

/** Last time anything happened: created, the user last confirmed, or the hold on a listing last ran out. */
export async function lastActivity(userId: string, target: StaleTarget, createdAt: Date): Promise<Date> {
  const [confirm] = await db.findEvents("stale_confirm", { ...key(userId, target), limit: 1 });
  const [hold] = target.listingId ? await db.findEvents("hold_expired", { listingId: target.listingId, limit: 1 }) : [];
  return [createdAt, ...[confirm, hold].flatMap((e) => (e ? [eventTime(e)] : []))].reduce((a, b) => (b > a ? b : a));
}

/** True when Karl already asked this user "still selling / looking?" within the last 48 h and they haven't answered. */
export async function hasOpenStaleQuestion(userId: string, now: Date): Promise<boolean> {
  const [ping] = await db.findEvents("stale_ping", { userId, limit: 1 });
  if (!ping) return false;
  const [pingAt, [confirm]] = [eventTime(ping), await db.findEvents("stale_confirm", { userId, limit: 1 })];
  return now.getTime() - pingAt.getTime() < STALE_AFTER_MS && !(confirm && eventTime(confirm) >= pingAt);
}

/** Record that Karl asked "still selling / still looking?" just now. */
export async function recordStalePing(userId: string, target: StaleTarget, now: Date): Promise<void> {
  await db.logEvent("stale_ping", data(userId, target, now));
}

/** What to do with an open listing/want right now: leave it, ask the owner, or close it (2 pings unanswered). */
export async function staleAction(
  userId: string,
  target: StaleTarget,
  createdAt: Date,
  now: Date,
): Promise<"none" | "ping" | "close"> {
  const last = await lastActivity(userId, target, createdAt);
  if (now.getTime() - last.getTime() < STALE_AFTER_MS) return "none";
  const pings = (await db.findEvents("stale_ping", { ...key(userId, target), limit: 10 }))
    .map(eventTime)
    .filter((at) => at > last)
    .sort((a, b) => b.getTime() - a.getTime());
  if (pings[0] && now.getTime() - pings[0].getTime() < STALE_AFTER_MS) return "none"; // asked recently, give them time
  return pings.length >= MAX_STALE_PINGS ? "close" : "ping";
}
