// The Gemini tool loop. Owner: Nishanth. CONTRACT: inbound.ts calls runAgentTurn for every
// text message that isn't a command, a relay, or a photo.

import type { User } from "../types";

/**
 * Let Gemini decide what the user wants, run the tools it picks (src/agent/tools.ts → src/flows),
 * and return Karl's reply text. Returns null when the tools already messaged the user
 * (e.g. search results were sent as photos) and nothing else needs saying.
 */
export async function runAgentTurn(_user: User, _text: string): Promise<string | null> {
  throw new Error("TODO(wave1-brain)");
}
