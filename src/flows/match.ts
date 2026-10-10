// Match lifecycle: propose → seller accepts (hold) → meetup → did it happen → sold. Owner: Nishanth.

import type { Listing, Match, User } from "../types";

/** Buyer wants listing: create match (proposed), text the SELLER "someone wants your X at $Y, ok to hold it?"
 *  (ref match_request). Returns Karl's reply for the buyer. Refuses own listing / non-active listing. */
export async function proposeMatch(_buyer: User, _listing: Listing): Promise<string> {
  throw new Error("TODO(wave1-match)");
}

/** Seller answers. accept → accepted + holdExpiresAt + listing held + both users state in_handoff + both get
 *  2 meetup options (MEETUP_SPOTS + times). decline → cancelled, buyer told kindly. Returns reply for seller. */
export async function respondToMatch(_seller: User, _matchId: string, _accept: boolean): Promise<string> {
  throw new Error("TODO(wave1-match)");
}

/** Either side picks spot + time → meetup_set; tell the other side. Spot must be in MEETUP_SPOTS. */
export async function setMeetup(_user: User, _matchId: string, _spot: string, _at: Date): Promise<string> {
  throw new Error("TODO(wave1-match)");
}

/** Answer to "did it happen?". Both yes → completed, listing sold, buyer's matching want closed, both thanked
 *  (+ "pay once you have it" is said earlier, at meetup). no → cancelled, listing back to active. */
export async function confirmHappened(_user: User, _matchId: string, _happened: boolean): Promise<string> {
  throw new Error("TODO(wave1-match)");
}

/** Either side backs out: cancelled, listing back to active, other side told. */
export async function cancelMatch(_user: User, _matchId: string): Promise<string> {
  throw new Error("TODO(wave1-match)");
}

export async function getActiveMatches(_user: User): Promise<Match[]> {
  throw new Error("TODO(wave1-match)");
}
