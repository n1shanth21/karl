// Every-minute timers. Owner: Aarush (backend branch).
// Jobs never send texts. They update the DB and EMIT bus events; the agent sends the texts.

import { config } from "../config";
import { runBackfill } from "./backfill";
import { expireProposals, closeStuckDeals } from "./expiry";
import { checkinReminders, staleSweep } from "./lifecycle";
import { dueCheckins, expireHolds, expireWants } from "./timers";

let running = false;

/** One pass of every job. Skips if the previous tick is still running (so nothing fires twice). */
export async function tick(now = new Date()): Promise<void> {
  if (running) {
    console.log("[jobs] previous tick still running, skipping");
    return;
  }
  running = true;
  try {
    await expireHolds(now); // 1. holds that ran out -> match expired, listing active
    await dueCheckins(now); // 2. meetups past meetupAt + delay -> ask "did it happen?" (once)
    await checkinReminders(now); // 3. unconfirmed meetups: re-ask every 24 h, at most twice
    await expireWants(now); // 4. wants past expiresAt -> closed
    await staleSweep(now); // 5. open listings/wants quiet for 48 h -> "still selling?", then auto-close
    await closeStuckDeals(now); // 6. meetups still unconfirmed 24 h after the 2nd reminder -> deal closed, listing back up
    await expireProposals(now); // 7. requests/offers nobody answered for 24 h -> match expired, listing stays up
  } finally {
    running = false;
  }
}

export function startJobs(): void {
  setInterval(() => tick().catch((err) => console.error("[jobs] tick failed", err)), 60_000);
  // Startup backfill already runs in src/index.ts; this catches anything that misses Gemini later.
  if (config.dbMode === "postgres") setInterval(() => void runBackfill(), 5 * 60_000);
  console.log("[jobs] scheduler started (tick every 60s, backfill every 5 min in postgres mode)");
}
