// Spectrum connection. Owner: Nishanth (agent branch).
// Spectrum reads SPECTRUM_PROJECT_ID / SPECTRUM_PROJECT_SECRET from the environment automatically.

import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { terminal } from "spectrum-ts/providers/terminal";
import { config } from "../config";

export type App = Awaited<ReturnType<typeof startSpectrum>>;

export async function startSpectrum() {
  const useIMessage = config.messagingMode === "imessage" || config.messagingMode === "both";
  const useTerminal = config.messagingMode === "terminal" || config.messagingMode === "both";

  if (useIMessage && (!process.env.SPECTRUM_PROJECT_ID || !process.env.SPECTRUM_PROJECT_SECRET)) {
    throw new Error(`MESSAGING_MODE=${config.messagingMode} needs SPECTRUM_PROJECT_ID and SPECTRUM_PROJECT_SECRET in .env`);
  }
  console.log(`[spectrum] starting in "${config.messagingMode}" mode`);

  return Spectrum({
    providers: [...(useIMessage ? [imessage.config()] : []), ...(useTerminal ? [terminal.config()] : [])],
  });
}
