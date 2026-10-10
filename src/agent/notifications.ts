// Turns bus events into texts. Owner: Nishanth (agent branch).
// TODO(Nishanth, Phase A2): write the real messages for each event.

import { bus } from "../bus";

export function registerNotifications(): void {
  bus.on("match_found", (e) => console.log("[notify] match_found (not wired yet)", e));
  bus.on("hold_expired", (e) => console.log("[notify] hold_expired (not wired yet)", e));
  bus.on("meetup_checkin_due", (e) => console.log("[notify] meetup_checkin_due (not wired yet)", e));
  bus.on("want_expired", (e) => console.log("[notify] want_expired (not wired yet)", e));
}
