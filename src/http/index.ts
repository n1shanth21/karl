// Small HTTP server: health check, dashboard stats, listing photos. Owner: Aarush (backend branch).
// Read-only. Never returns phone numbers or last names.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "../config";
import { db } from "../db";
import { getPublicStats } from "./publicStats";

export const http = new Hono();

http.use("/api/*", cors({ origin: [config.dashboardOrigin, "http://localhost:3001"] }));

http.get("/health", (c) => c.json({ ok: true, name: config.agentName, mode: config.messagingMode, db: config.dbMode }));

http.get("/api/stats", async (c) => c.json(await getPublicStats()));

http.get("/photos/:id", async (c) => {
  const photo = await db.getPhoto(c.req.param("id"));
  if (!photo) return c.notFound();
  return new Response(photo.bytes, { headers: { "content-type": photo.mimeType, "cache-control": "public, max-age=3600" } });
});

export function startHttp(): void {
  Bun.serve({ port: config.port, fetch: http.fetch });
  console.log(`[http] listening on :${config.port}`);
}
