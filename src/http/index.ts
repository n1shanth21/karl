// Small HTTP server: health check, dashboard stats, activity, sign-up, listing photos. Owner: Aarush (backend branch).
// Read-only. Never returns phone numbers or last names.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { recentRuns } from "../agent/activity";
import { config } from "../config";
import { db } from "../db";
import { firstNameOnly, getPublicStats, scrubTitle } from "./publicStats";
import { signupRoutes } from "./signup";

export const http = new Hono();

http.use("/api/*", cors({ origin: [config.dashboardOrigin, "http://localhost:3001"] }));

http.get("/health", (c) => c.json({ ok: true, name: config.agentName, mode: config.messagingMode, db: config.dbMode }));

http.get("/api/stats", async (c) => c.json(await getPublicStats()));

// Live pipeline steps for the demo dashboard. Same scrubbing as /api/stats.
http.get("/api/activity", (c) =>
  c.json(
    recentRuns().map((run) => ({
      ...run,
      firstName: firstNameOnly(run.firstName),
      itemTitle: run.itemTitle === null ? null : scrubTitle(run.itemTitle),
    })),
  ),
);

// GET /signup page + POST /api/signup (adds the phone to Photon's Users list).
http.route("/", signupRoutes());

http.get("/photos/:id", async (c) => {
  const photo = await db.getPhoto(c.req.param("id"));
  if (!photo) return c.notFound();
  return new Response(photo.bytes, { headers: { "content-type": photo.mimeType, "cache-control": "public, max-age=3600" } });
});

export function startHttp(): void {
  Bun.serve({ port: config.port, fetch: http.fetch });
  console.log(`[http] listening on :${config.port}`);
}
