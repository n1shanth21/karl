// Meetup scheduling by OVERLAP: both people say when they're free, Karl finds a shared slot. Owner: Nishanth.
// parseAvailability tries a small deterministic parser first ("tmr after 2", "sat 11-3"); only odd phrasing costs a Gemini call.

import { gemini } from "../agent/gemini";
import { MEETUP_SPOTS } from "../config";
import { MEETUP_HOURS, nyDate, nyParts } from "./meetup";

/** A time someone is free. Dates are absolute (already resolved from "tmr after 2" using `now`, America/New_York). */
export type Window = { start: Date; end: Date };
/** A concrete proposal: a start time inside the overlap, at a campus spot from MEETUP_SPOTS. */
export type Slot = { start: Date; spot: string };

const MIN = 60_000;
const HALF_HOUR = 30 * MIN;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// ---- spots ----

const SPOT_ALIASES: [RegExp, string][] = [
  [/\b(?:student )?union\b/i, "Student Union lobby"],
  [/\bpit\b/i, "the Pit"],
  [/\b(?:davis|library)\b/i, "Davis Library entrance"],
  [/\blenoir\b/i, "Lenoir Dining Hall entrance"],
  [/\brams?(?: head)?\b/i, "Rams Head Plaza"],
];

/** The campus spot named in free text ("meet at the union"), as it appears in MEETUP_SPOTS, or null. First one named wins. */
export function spotFromText(text: string): string | null {
  const hits = SPOT_ALIASES.map(([re, spot]) => ({ spot, at: text.search(re) })).filter((h) => h.at >= 0 && MEETUP_SPOTS.includes(h.spot));
  const exact = MEETUP_SPOTS.map((spot) => ({ spot, at: text.toLowerCase().indexOf(spot.toLowerCase()) })).filter((h) => h.at >= 0);
  return [...exact, ...hits].sort((a, b) => a.at - b.at)[0]?.spot ?? null;
}

// ---- clipping ----

/** Keep only the part of a window that is in the future, within 7 days, and inside MEETUP_HOURS (split per day). */
function clipToDaytime(w: Window, now: Date): Window[] {
  const lo = Math.max(w.start.getTime(), now.getTime());
  const hi = Math.min(w.end.getTime(), now.getTime() + WEEK);
  const out: Window[] = [];
  if (!(hi > lo)) return out;
  const first = nyParts(new Date(lo));
  for (let i = 0; i < 9; i++) {
    const open = nyDate(first.year, first.month, first.day + i, MEETUP_HOURS.start).getTime();
    const close = nyDate(first.year, first.month, first.day + i, MEETUP_HOURS.end).getTime();
    if (open >= hi) break;
    const start = Math.max(open, lo);
    const end = Math.min(close, hi);
    if (end > start) out.push({ start: new Date(start), end: new Date(end) });
  }
  return out;
}

/** The instant for "hour" (may be fractional, 14.5 = 2:30pm) on the New York day `offset` days after now's day. */
function onDay(now: Date, offset: number, hour: number): Date {
  const n = nyParts(now);
  const whole = Math.floor(hour);
  return new Date(nyDate(n.year, n.month, n.day + offset, whole).getTime() + Math.round((hour - whole) * 60) * MIN);
}

// ---- deterministic parser ----

const DAY_WORDS = "today|tonight|tmr|tmrw|tmrrw|tomorrow|tomorow|tommorow|2morrow|2moro|sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?";
const T = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b`;
const RANGE = new RegExp(String.raw`\b${T}\s*(?:-|–|—|to|until|till)\s*${T}`);
const AFTER = new RegExp(String.raw`\b(?:after|from|starting(?: at)?)\s+${T}`);
const BEFORE = new RegExp(String.raw`\b(?:before|by)\s+${T}`);
const AT = new RegExp(String.raw`(?:\b(?:at|around|@)\s*|\b(?:${DAY_WORDS})\s+)${T}|\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(\d{1,2}):(\d{2})\b`);
const BAILOUT = /\b(not|can't|cant|except|but|busy|unless|no|next|or|and|day after|midnight|class(?:es)?|lecture|meeting|shift|practice|lab)\b|\d\/\d|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d/;

const TIMEY = new RegExp(String.raw`\d|\b(?:${DAY_WORDS}|noon|midnight|morning|afternoon|evening|night|lunch|weekend|week|whenever|any ?time)\b`, "i");

/** "3" -> 15, "11" -> 11, "11:30pm" -> 23.5. Bare hours are read as daytime (1-8 = afternoon). null = not a time. */
function toHour(h: string | undefined, m: string | undefined, ap: string | undefined): number | null {
  const hour = Number(h);
  const min = m ? Number(m) : 0;
  if (!h || hour < 1 || hour > 24 || min > 59) return null;
  if (ap) return (hour % 12) + (ap === "pm" ? 12 : 0) + min / 60;
  return (hour >= 1 && hour <= 8 ? hour + 12 : hour) + min / 60;
}

/** [start, end] hours of the day from the text, or null if the text isn't one simple time. */
function timeSpec(t: string): [number, number] | null {
  const r = RANGE.exec(t);
  if (r) {
    let start = toHour(r[1], r[2], r[3]);
    const end = toHour(r[4], r[5], r[6]);
    const shared = !r[3] && r[6] ? toHour(r[1], r[2], r[6]) : null; // "9-11pm": the end's am/pm covers both when that reads right
    if (shared !== null && end !== null && shared < end) start = shared;
    if (start === null || end === null) return null;
    return [start, end <= start && end < 12 ? end + 12 : end];
  }
  const a = AFTER.exec(t);
  if (a) return toHour(a[1], a[2], a[3]) === null ? null : [toHour(a[1], a[2], a[3])!, MEETUP_HOURS.end];
  const b = BEFORE.exec(t);
  if (b) return toHour(b[1], b[2], b[3]) === null ? null : [MEETUP_HOURS.start, toHour(b[1], b[2], b[3])!];
  const at = AT.exec(t);
  if (at) {
    const h = at[1] ? toHour(at[1], at[2], at[3]) : at[4] ? toHour(at[4], at[5], at[6]) : toHour(at[7], at[8], undefined);
    return h === null ? null : [h, h + 1];
  }
  if (/\b(any ?time|all day|whenever|any time)\b/.test(t)) return [MEETUP_HOURS.start, MEETUP_HOURS.end];
  if (/\bmorning\b/.test(t)) return [MEETUP_HOURS.start, 12];
  if (/\bafternoon\b/.test(t)) return [12, 17];
  if (/\blunch/.test(t)) return [11, 14];
  if (/\b(evening|tonight)\b/.test(t)) return [17, MEETUP_HOURS.end];
  return null;
}

/** Windows for one simple phrase, or null when it needs real language understanding (-> Gemini). */
function parseSimple(text: string, now: Date): Window[] | null {
  const t = text.toLowerCase().replace(/\b(?:noon|midday)\b/g, "12pm");
  if (BAILOUT.test(t)) return null;
  const days = [...new Set(t.match(new RegExp(String.raw`\b(?:${DAY_WORDS})\b`, "g")) ?? [])];
  if (days.length > 1) return null;
  // A bare day ("tmr", "tmr im free") is the whole day, but only when nothing else is left to read ("tmr after class" -> Gemini).
  const leftover = SPOT_ALIASES.reduce((r, [re]) => r.replace(new RegExp(re.source, "gi"), ""), t).replace(new RegExp(String.raw`\b(?:${DAY_WORDS}|free|i'?m|i am|works?|is|ok|okay|good|fine|for|me|on|the|a|just|open|available)\b`, "g"), "").replace(/[^a-z0-9]/g, "");
  const spec = timeSpec(t) ?? (days.length && !leftover ? [MEETUP_HOURS.start, MEETUP_HOURS.end] : null);
  if (!spec) return null;

  const day = days[0] ?? "";
  const today = nyParts(now);
  const dow = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
  const weekday = WEEKDAYS.indexOf(day.slice(0, 3));
  // Candidate days in order; the first one that still has time left wins ("union at 4pm" at 9:27pm -> tomorrow).
  let offsets = [0, 1];
  if (/^to(day|night)/.test(day)) offsets = [0];
  else if (/^(tm|to?m|2m)/.test(day)) offsets = [today.hour < 5 ? 0 : 1]; // 12:30am "tmr" means the coming daytime
  else if (weekday >= 0) offsets = (weekday - dow + 7) % 7 === 0 ? [0, 7] : [(weekday - dow + 7) % 7];
  for (const offset of offsets) {
    const clipped = clipToDaytime({ start: onDay(now, offset, spec[0]), end: onDay(now, offset, spec[1]) }, now);
    if (clipped.length) return clipped;
  }
  return [];
}

// ---- Gemini fallback ----

/** "2026-10-11T14:00:00-04:00" as is; an ISO string with no offset is read as New York wall time. */
function parseIso(iso: string): Date | null {
  const m = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)(?!.*(?:Z|[+-]\d\d:?\d\d)$)/.exec(iso.trim());
  const d = m ? new Date(nyDate(+m[1]!, +m[2]!, +m[3]!, +m[4]!).getTime() + +m[5]! * MIN) : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Free text -> windows, e.g. "tmr after 2" -> [{tomorrow 14:00, tomorrow 20:00}], "sat 11-3" -> [{sat 11:00, 15:00}].
 * Resolves relative days against `now` in America/New_York ("tmr" is tomorrow, even at 9:30 PM; between midnight and 5am it means the coming daytime).
 * Clips to daytime (MEETUP_HOURS) and the next 7 days; drops past windows. Also returns a campus spot if one was named.
 * Returns { windows: [] } when it can't read any time (caller asks again).
 */
export async function parseAvailability(text: string, now: Date): Promise<{ windows: Window[]; spot: string | null }> {
  const simple = parseSimple(text, now);
  if (simple) return { windows: simple, spot: spotFromText(text) };
  if (!TIMEY.test(text) && !spotFromText(text)) return { windows: [], spot: null }; // plain chat ("omw", "thanks!") never costs a Gemini call
  try {
    const out = await gemini.extractAvailability(text, now.toISOString());
    const windows = out.windows.slice(0, 6).flatMap(({ startIso, endIso }) => {
      const start = parseIso(startIso);
      const end = parseIso(endIso);
      return start && end && end > start ? clipToDaytime({ start, end }, now) : [];
    });
    return { windows, spot: (out.spot && spotFromText(out.spot)) || spotFromText(text) };
  } catch (err) {
    console.warn("[availability] couldn't read times:", err instanceof Error ? err.message : err);
    return { windows: [], spot: spotFromText(text) };
  }
}

// ---- overlap ----

/**
 * Candidate meetup slots from two people's windows, earliest first: each overlap of >= 30 min yields a slot starting at
 * the overlap start rounded UP to :00/:30 (and >= now + 30 min). A long overlap yields more slots 2 hours apart so a 👎 has
 * somewhere to go. spotPrefs (either person's named spot) wins; otherwise MEETUP_SPOTS[0]. At most `limit` slots (default 3).
 */
export function overlapSlots(a: Window[], b: Window[], now: Date, opts: { spotPrefs?: string[]; limit?: number } = {}): Slot[] {
  const spot = opts.spotPrefs?.find((s) => MEETUP_SPOTS.includes(s)) ?? MEETUP_SPOTS[0]!;
  const earliest = now.getTime() + HALF_HOUR;
  const starts = new Set<number>();
  for (const x of a) {
    for (const y of b) {
      const end = Math.min(x.end.getTime(), y.end.getTime());
      const from = Math.ceil(Math.max(x.start.getTime(), y.start.getTime(), earliest) / HALF_HOUR) * HALF_HOUR;
      for (let s = from; end - s >= HALF_HOUR; s += 2 * HOUR) starts.add(s);
    }
  }
  return [...starts]
    .sort((p, q) => p - q)
    .slice(0, opts.limit ?? 3)
    .map((s) => ({ start: new Date(s), spot }));
}

// ---- describing ----

function clock(hour: number, minute: number, suffix: boolean): string {
  return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, "0")}` : ""}${suffix ? (hour < 12 ? "am" : "pm") : ""}`;
}

/** Short human form for texts: "tomorrow 2–4pm", "sat 11am–3pm". Several windows are comma separated. */
export function describeWindows(windows: Window[], now: Date): string {
  const n = nyParts(now);
  return [...windows]
    .sort((p, q) => p.start.getTime() - q.start.getTime())
    .map(({ start, end }) => {
      const s = nyParts(start);
      const e = nyParts(end);
      const days = (Date.UTC(s.year, s.month - 1, s.day) - Date.UTC(n.year, n.month - 1, n.day)) / DAY;
      const weekday = start.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" }).toLowerCase();
      const label = days <= 0 ? "today" : days === 1 ? "tomorrow" : days >= 7 ? `next ${weekday}` : weekday;
      const sameHalf = s.hour < 12 === e.hour < 12;
      return `${label} ${clock(s.hour, s.minute, !sameHalf)}–${clock(e.hour, e.minute, true)}`;
    })
    .join(", ");
}
