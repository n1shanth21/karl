// Remembers what each message Karl sent was ABOUT, so a tapback or threaded reply on it
// can be routed (❤️ on a draft = confirm, ❤️ on a match request = accept, reply on a relay = that match).
// In-memory: a restart forgets old refs, which only means old tapbacks get ignored.

export type Ref =
  | { kind: "draft"; listingId: string } // "mini fridge, good, $45. post it?"
  | { kind: "result"; listingId: string } // one search result shown to a buyer
  | { kind: "offer"; listingId: string; wantId: string; spread?: true } // proactive "someone just listed X, want it?" (spread: ask is far over the bid, so a "yes" needs a price)
  | { kind: "match_request"; matchId: string } // to seller: "someone wants your X, ok to hold?"
  | { kind: "counter"; matchId: string } // a price offer/counter-offer waiting for the other side's answer
  | { kind: "relay"; matchId: string } // a relayed message or handoff info for this match
  | { kind: "checkin"; matchId: string } // "did the sale happen?"
  | { kind: "bid"; listingId: string; wantId: string } // to seller: "someone wants one around $15 (you're at $30). offer them a price?"
  | { kind: "still_active"; listingId?: string; wantId?: string } // "still selling X? / still looking for X?"
  | { kind: "availability"; matchId: string } // "when are you free to meet?" (any text reply = their availability)
  | { kind: "meetup_slot"; matchId: string; start: string; spot: string }; // "the Pit tomorrow 2pm? 👍 or 👎" (start = ISO)

const refs = new Map<string, Ref>();

export function rememberRef(messageId: string, ref: Ref): void {
  refs.set(messageId, ref);
}

export function lookupRef(messageId: string): Ref | undefined {
  return refs.get(messageId);
}
