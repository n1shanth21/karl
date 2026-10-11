// Texts for lifecycle bus events (order-book spreads are in notifications.ts). Owner: Nishanth.
// TODO(wave: conversation): checkin_reminder_due, stale_check_due, stale_auto_closed.

let registered = false;

export function registerLifecycle(): void {
  if (registered) return;
  registered = true;
}
