// What the public dashboard gets from /api/stats: cached for 3 s and scrubbed.
// The DB already returns first names only; this is a second layer so a full
// name or a phone number typed into a title can never reach the public page.

import { db } from "../db";
import { acceptableName } from "../flows/names";
import type { Stats } from "../types";

const CACHE_MS = 3000;
let cached: { at: number; stats: Promise<Stats> } | null = null;

/** "Maya Smith" → "Maya". Never more than one word. */
export function firstNameOnly(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first.length <= 20 && acceptableName(first) ? first : "someone"; // a bad stored name never reaches the public page
}

/** Remove phone numbers, emails, @handles and links from a listing title. */
export function scrubTitle(title: string): string {
  const clean = title
    .replace(/[\w.+-]+@[\w-]+\.[a-z]{2,}/gi, "") // emails
    .replace(/https?:\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+\.(?:com|net|org|io|co|me|ly|gg|app)\b\S*/gi, "") // links
    .replace(/(?:^|\s)@[a-z0-9_.]{2,}/gi, " ") // @handles
    .replace(/\+?\(?\d[\d\s().-]{5,}\d/g, "") // phone-like digit runs (7+ digits)
    .replace(/\s+/g, " ")
    .trim();
  return clean || "item";
}

function scrub(stats: Stats): Stats {
  return {
    ...stats,
    recent: stats.recent.map((r) => ({ ...r, title: scrubTitle(r.title), sellerFirstName: firstNameOnly(r.sellerFirstName) })),
  };
}

/** Stats for the public dashboard. Reuses one DB query for 3 seconds. */
export function getPublicStats(now: number = Date.now()): Promise<Stats> {
  if (!cached || now - cached.at >= CACHE_MS) {
    const stats = db.getStats().then(scrub);
    cached = { at: now, stats };
    // Don't keep a failed query cached; the next request retries.
    stats.catch(() => {
      if (cached?.stats === stats) cached = null;
    });
  }
  return cached.stats;
}

/** Test helper. */
export function clearStatsCache(): void {
  cached = null;
}
