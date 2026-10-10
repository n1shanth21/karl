// Masked relay between buyer and seller DMs. PLAIN CODE routing, never Gemini. Owner: Nishanth.

import type { User } from "../types";

export type RelayOutcome = "relayed" | "blocked" | "asked_which" | "not_relay";

/**
 * Decide if a user's text is meant for their counterpart, and if so forward it.
 * - replyToMatchId set (user used iMessage reply on a relay/match message) → that match
 * - exactly 1 handoff match (accepted|meetup_set) and text isn't addressed to Karl → relay
 * - 2+ handoff matches, no reply target → ask "which one, the fridge or the lamp?" → asked_which
 * - text addressed to Karl ("karl ...", cancel, help, sell/buy/list/need/looking for, yes/no answering
 *   Karl's own pending question) → not_relay
 * Relayed text goes through scanRelayMessage(): block → tell sender why; warn → forward + warn recipient.
 * Forwarded as markdown("**<SenderFirstName> · <listing title>**\n<text>") with ref relay.
 */
export async function routeMessage(_user: User, _text: string, _replyToMatchId?: string): Promise<RelayOutcome> {
  throw new Error("TODO(wave1-match)");
}
