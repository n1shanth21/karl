// SHARED CONTRACT. The event bus is how branches talk without editing each other's files.
// Data + Backend EMIT events. Agent LISTENS and sends the texts.
// Owner: Nishanth. Only add events, never rename/remove.

import { EventEmitter } from "node:events";

export type BusEvents = {
  // Data: a newly active listing satisfies someone's saved want -> agent texts the buyer
  match_found: { wantId: string; listingId: string; buyerId: string; score: number };
  // Backend jobs: a held item wasn't completed in time -> agent tells both sides, item goes back up
  hold_expired: { matchId: string };
  // Backend jobs: meetup time has passed -> agent asks both "did it happen?"
  meetup_checkin_due: { matchId: string };
  // Backend jobs: a saved want hit its expiry -> agent may tell the buyer (optional)
  want_expired: { wantId: string; buyerId: string };
  // Matching: a bid (want) and an ask (listing) are the same item but far apart on price (ask > 1.5x and <= 3x the
  // bid). Agent tells BOTH sides, once per pair, so they can try to meet in the middle with offers.
  spread_found: { wantId: string; listingId: string; buyerId: string; sellerId: string };
  // Jobs: re-ask "did it happen?" for a meetup nobody confirmed (every 24 h, at most twice).
  checkin_reminder_due: { matchId: string };
  // Jobs: an open listing/want has been quiet for 48 h -> ask "still selling / still looking?".
  stale_check_due: { userId: string; listingId?: string; wantId?: string };
  // Jobs: two stale checks went unanswered -> it was closed automatically; agent tells the user.
  stale_auto_closed: { userId: string; listingId?: string; wantId?: string };
  // Jobs: a meetup_set deal got its check-in + 2 reminders and still wasn't confirmed 24 h later -> closed
  // automatically (match expired, listing back up, buyer's want reopened); agent tells both sides.
  deal_auto_closed: { matchId: string };
  // Jobs: a "proposed" match (request/offer nobody answered) sat for 24 h -> match expired, listing stays up,
  // buyer's want reopened; agent texts only the side that was waiting.
  proposal_expired: { matchId: string };
};

type Name = keyof BusEvents;

const emitter = new EventEmitter();

export const bus = {
  emit<K extends Name>(name: K, payload: BusEvents[K]) {
    emitter.emit(name, payload);
  },
  on<K extends Name>(name: K, handler: (payload: BusEvents[K]) => void | Promise<void>) {
    emitter.on(name, (payload) => {
      // A failing listener must never crash the server.
      Promise.resolve(handler(payload)).catch((err) => console.error(`[bus] ${name} handler failed`, err));
    });
  },
};
