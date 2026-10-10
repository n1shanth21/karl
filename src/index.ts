// Entry point: one process runs Spectrum (texts), the HTTP server, and the timers.
// Owner: Nishanth. Other branches never edit this; they export a start function instead.

import { registerNotifications } from "./agent/notifications";
import { config } from "./config";
import { startHttp } from "./http";
import { startJobs } from "./jobs";
import { backfillEmbeddings } from "./matching";
import { startSpectrum } from "./spectrum/client";
import { handleInbound } from "./spectrum/inbound";
import { initSend } from "./spectrum/send";

console.log(`[karl] booting: messaging=${config.messagingMode} db=${config.dbMode}`);

startHttp();
startJobs();
registerNotifications();
// Embed anything that missed it while Gemini was down (not awaited: texts must start flowing).
if (config.dbMode === "postgres") backfillEmbeddings().catch((e) => console.error("[karl] backfill failed", e));

const app = await startSpectrum();
initSend(app);
console.log(`[karl] ${config.agentName} is listening. Send a message!`);

for await (const [space, message] of app.messages) {
  // Never let one bad message kill the loop.
  handleInbound(space, message).catch((err) => console.error("[karl] inbound failed", err));
}
