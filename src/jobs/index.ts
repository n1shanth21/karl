// Every-minute timers. Owner: Aarush (backend branch).
// Jobs never send texts. They update the DB and EMIT bus events; the agent sends the texts.

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
    await expireWants(now); // 3. wants past expiresAt -> closed
  } finally {
    running = false;
  }
}

export function startJobs(): void {
  setInterval(() => tick().catch((err) => console.error("[jobs] tick failed", err)), 60_000);
  console.log("[jobs] scheduler started (every 60s)");
}
