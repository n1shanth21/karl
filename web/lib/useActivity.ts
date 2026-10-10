"use client";
import { useEffect, useState } from "react";
import { SIM_STEP_MS, simulatedRun } from "./simulatedActivity";
import type { ActivityRun } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL;
const POLL_MS = 1000; // fast on purpose: the demo should feel instant
const TIMEOUT_MS = 2500;
const STATUSES = ["pending", "active", "done", "failed"];

const isDate = (s: unknown) => typeof s === "string" && !Number.isNaN(Date.parse(s));

// Checks the payload and drops any bad runs/steps, so a weird response can't crash the page.
// The API returns a bare ActivityRun[]; { runs: [...] } is also accepted just in case.
// Returns null if the top-level shape is wrong.
function cleanRuns(data: unknown): ActivityRun[] | null {
  const list = Array.isArray(data) ? data : (data as { runs?: unknown } | null)?.runs;
  if (!Array.isArray(list)) return null;
  const runs: ActivityRun[] = [];
  for (const r of list as ActivityRun[]) {
    if (
      !r ||
      typeof r.id !== "string" ||
      (r.kind !== "sell" && r.kind !== "buy") ||
      typeof r.firstName !== "string" ||
      (r.itemTitle !== null && typeof r.itemTitle !== "string") ||
      !isDate(r.startedAt) ||
      !Array.isArray(r.steps)
    ) {
      continue;
    }
    const steps = r.steps.filter(
      (s) =>
        !!s &&
        typeof s.key === "string" &&
        typeof s.label === "string" &&
        STATUSES.includes(s.status) &&
        (s.at === null || isDate(s.at)),
    );
    // First word only, in case a full name ever slips through.
    runs.push({ ...r, firstName: r.firstName.trim().split(" ")[0], steps });
  }
  return runs;
}

// Newest run, unless an older one is still in progress (e.g. waiting for the seller's "yes").
function pickRun(runs: ActivityRun[]): ActivityRun | null {
  const inProgress = runs.find((r) => r.steps.some((s) => s.status === "active"));
  return inProgress ?? runs[0] ?? null;
}

// Polls /api/activity. Until the first good response (or if no API is configured)
// it plays a simulated demo run so the panel is never empty. After that, a failed
// poll keeps the last live data instead of falling back to the simulation.
export function useActivity(): { run: ActivityRun | null; simulated: boolean } {
  const [real, setReal] = useState<ActivityRun[] | null>(null); // null until the first success
  const [tick, setTick] = useState(0); // drives the demo, one step per tick
  const simulated = real === null;

  useEffect(() => {
    if (!API_URL) return; // no server configured: stay on the demo
    let stopped = false;
    let inFlight = false;

    async function load() {
      if (inFlight) return; // don't pile up requests
      inFlight = true;
      try {
        const res = await fetch(`${API_URL}/api/activity`, {
          cache: "no-store",
          signal: AbortSignal.timeout(TIMEOUT_MS), // a hung request must not block polling forever
        });
        if (!res.ok) throw new Error(`status ${res.status}`); // 404 until the endpoint exists
        const runs = cleanRuns(await res.json());
        if (!runs) throw new Error("bad shape");
        if (!stopped) setReal(runs);
      } catch {
        // keep whatever we were showing
      } finally {
        inFlight = false;
      }
    }

    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  // Demo clock. Stops as soon as real data arrives.
  useEffect(() => {
    if (!simulated) return;
    const timer = setInterval(() => setTick((t) => t + 1), SIM_STEP_MS);
    return () => clearInterval(timer);
  }, [simulated]);

  return { run: simulated ? simulatedRun(tick) : pickRun(real), simulated };
}
