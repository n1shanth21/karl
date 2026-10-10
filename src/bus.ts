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
