// Every 5 minutes: embed listings/wants that missed Gemini (it was down or slow),
// so search and want matching can find them. Postgres mode only; never pings buyers.

import { backfillEmbeddings } from "../matching";

type Backfill = () => Promise<{ listings: number; wants: number }>;

let running = false;

/** One backfill pass. Never throws; skips if the last pass is still going. */
export async function runBackfill(backfill: Backfill = backfillEmbeddings): Promise<void> {
  if (running) return;
  running = true;
  try {
    const fixed = await backfill();
    if (fixed.listings > 0 || fixed.wants > 0) {
      console.log(`[jobs] backfill embedded ${fixed.listings} listings, ${fixed.wants} wants`);
    }
  } catch (err) {
    console.error("[jobs] backfill failed:", err instanceof Error ? err.message : err);
  } finally {
    running = false;
  }
}
