// No ghost orders: open listings/wants get a "still selling / still looking?" check every 48 h. Owner: Nishanth.
// State lives in the events table (no schema change): "stale_ping" when Karl asks, "stale_confirm" when the user says yes.
// TODO(wave: lifecycle jobs): implement.

/** The user said 👍 "still selling / still looking": restart the 48 h clock for that listing/want. */
export async function markStillActive(_userId: string, _target: { listingId?: string; wantId?: string }): Promise<void> {
  throw new Error("TODO(lifecycle): markStillActive");
}
