// Meetup time helpers: daytime slots in America/New_York. Owner: Nishanth.

import { MEETUP_SPOTS } from "../config";

const TZ = "America/New_York";
const HALF_HOUR = 30 * 60_000;
const HOUR = 2 * HALF_HOUR;
const DAY = 24 * HOUR;

const wallClock = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
});

/** The wall-clock fields a New York clock shows at this instant. */
function nyParts(d: Date) {
  const fields = Object.fromEntries(wallClock.formatToParts(d).map((p) => [p.type, Number(p.value)]));
  return fields as Record<"year" | "month" | "day" | "hour" | "minute", number>;
}

/** The instant when a New York clock shows this date and time. */
function nyDate(year: number, month: number, day: number, hour: number): Date {
  const guess = Date.UTC(year, month - 1, day, hour);
  const shown = nyParts(new Date(guess));
  return new Date(guess - (Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute) - guess));
}

/** Reads after a spot name: "at 2:30pm" today, "tomorrow at 12pm", or "Friday at 3pm". */
export function describeTime(at: Date, now = new Date()): string {
  const t = nyParts(at);
  const clock = `${t.hour % 12 || 12}${t.minute ? `:${String(t.minute).padStart(2, "0")}` : ""}${t.hour < 12 ? "am" : "pm"}`;
  const n = nyParts(now);
  const days = (Date.UTC(t.year, t.month - 1, t.day) - Date.UTC(n.year, n.month - 1, n.day)) / DAY;
  if (days === 0) return `at ${clock}`;
  if (days === 1) return `tomorrow at ${clock}`;
  return `${at.toLocaleDateString("en-US", { timeZone: TZ, weekday: "long" })} at ${clock}`;
}

/** Why this meetup time won't work (past, or outside 9am-8pm New York), or null if it's fine. */
export function meetupTimeProblem(at: Date, now = new Date()): string | null {
  if (Number.isNaN(at.getTime()) || at.getTime() < now.getTime()) return "that time already passed. what time later works?";
  const { hour, minute } = nyParts(at);
  const hours = hour + minute / 60;
  if (hours < 9 || hours > 20) return "i only set up daytime meetups, between 9am and 8pm. what time works?";
  return null;
}

/** Two daytime options, e.g. "the Pit at 2:30pm or Student Union lobby at 3pm? or suggest a time". */
export function meetupProposal(now = new Date()): string {
  const first = Math.ceil((now.getTime() + HOUR) / HALF_HOUR) * HALF_HOUR;
  let slots = [first, first + HOUR].map((ms) => new Date(ms));
  const isDaytime = (d: Date) => {
    const { hour, minute } = nyParts(d);
    return hour + minute / 60 >= 9 && hour + minute / 60 <= 18;
  };
  if (!slots.every(isDaytime)) {
    const tomorrow = nyParts(new Date(now.getTime() + DAY));
    slots = [12, 15].map((hour) => nyDate(tomorrow.year, tomorrow.month, tomorrow.day, hour));
  }
  const [a, b] = slots.map((slot, i) => `${MEETUP_SPOTS[i]} ${describeTime(slot, now)}`);
  return `${a} or ${b}? or suggest a time`;
}
