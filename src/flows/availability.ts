// Meetup scheduling by OVERLAP: both people say when they're free, Karl finds a shared slot. Owner: Nishanth.
// CONTRACT (stubs): the engine builder implements these; the flow builder calls them.

/** A time someone is free. Dates are absolute (already resolved from "tmr after 2" using `now`, America/New_York). */
export type Window = { start: Date; end: Date };
/** A concrete proposal: a start time inside the overlap, at a campus spot from MEETUP_SPOTS. */
export type Slot = { start: Date; spot: string };

/**
 * Free text -> windows, e.g. "tmr after 2" -> [{tomorrow 14:00, tomorrow 20:00}], "sat 11-3" -> [{sat 11:00, 15:00}].
 * Resolves relative days against `now` in America/New_York ("tmr" is ALWAYS tomorrow, even at 9:30 PM).
 * Clips to daytime (MEETUP_HOURS) and the next 7 days; drops past windows. Also returns a campus spot if one was named.
 * Returns { windows: [] } when it can't read any time (caller asks again). TODO(engine)
 */
export async function parseAvailability(_text: string, _now: Date): Promise<{ windows: Window[]; spot: string | null }> {
  throw new Error("TODO(engine): parseAvailability");
}

/**
 * Candidate meetup slots from two people's windows, earliest first: each overlap of >= 30 min yields a slot starting at
 * the overlap start rounded UP to :00/:30 (and >= now + 30 min). spotPrefs (either person's named spot) wins; otherwise
 * MEETUP_SPOTS[0]. At most `limit` slots (default 3). Pure function. TODO(engine)
 */
export function overlapSlots(_a: Window[], _b: Window[], _now: Date, _opts: { spotPrefs?: string[]; limit?: number } = {}): Slot[] {
  throw new Error("TODO(engine): overlapSlots");
}

/** Short human form for texts: "tomorrow 2–4pm", "sat 11am–3pm". TODO(engine) */
export function describeWindows(_windows: Window[], _now: Date): string {
  throw new Error("TODO(engine): describeWindows");
}
