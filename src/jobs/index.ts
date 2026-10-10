// Every-minute timers. Owner: Aarush (backend branch).
// Jobs never send texts. They update the DB and EMIT bus events; the agent sends the texts.
// TODO(Aarush, Phase B2): implement the ticks below.

import { bus } from "../bus";
import { db } from "../db";

export async function tick(now = new Date()): Promise<void> {
  // 1. Holds that ran out -> match "expired", listing back to "active", emit hold_expired
  // 2. Meetups past meetupAt + LIMITS.meetupCheckinDelayMin -> emit meetup_checkin_due (once per match!)
  // 3. Wants past expiresAt -> status "closed", emit want_expired
  void bus;
  void db;
  void now;
}

export function startJobs(): void {
  setInterval(() => tick().catch((err) => console.error("[jobs] tick failed", err)), 60_000);
  console.log("[jobs] scheduler started (every 60s)");
}
