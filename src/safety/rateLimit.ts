// Per-user rate limit: a sliding 10-minute window kept in memory.
// Stops one person (or a stuck loop) from flooding Karl and burning Gemini calls.

import { LIMITS } from "../config";

const WINDOW_MS = 10 * 60 * 1000;
const recent = new Map<string, number[]>(); // userId -> timestamps (ms) inside the window

/** Records this message and returns false if the user is over the limit. */
export function allowAt(userId: string, now: number): boolean {
  const times = (recent.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= LIMITS.rateLimitMessagesPer10Min) {
    recent.set(userId, times);
    return false;
  }
  times.push(now);
  recent.set(userId, times);
  return true;
}
