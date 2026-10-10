// Live pipeline activity for the demo dashboard. In-memory, last 5 runs, newest first.
// Privacy: first names + item titles only, never phone numbers or message text.
// Everything here is synchronous and never throws, so it can't break a user flow.

import type { ActivityRun, ActivityStep } from "../types";

const STEPS = {
  sell: [
    ["received", "photo received"],
    ["photo_converted", "photo converted"],
    ["vision_draft", "gemini drafting"],
    ["safety", "safety check"],
    ["awaiting_confirm", "waiting for seller"],
    ["live", "listing live"],
    ["wants_checked", "matched to wants"],
  ],
  buy: [
    ["received", "text received"],
    ["understood", "gemini understood"],
    ["search", "searching"],
    ["results_sent", "results sent"],
    ["want_saved", "want saved"],
  ],
} as const;

const MAX_RUNS = 5;
let runs: ActivityRun[] = []; // newest first
const listingRuns = new Map<string, string>(); // listingId -> run id
let counter = 0;

export function startRun(kind: "sell" | "buy", firstName: string | null): string {
  const id = `run-${Date.now().toString(36)}-${++counter}`;
  const steps: ActivityStep[] = STEPS[kind].map(([key, label]) => ({ key, label, status: "pending", at: null }));
  runs.unshift({ id, kind, firstName: firstName?.trim() || "someone", itemTitle: null, startedAt: new Date().toISOString(), steps });
  for (const dropped of runs.splice(MAX_RUNS)) for (const [listingId, runId] of listingRuns) if (runId === dropped.id) listingRuns.delete(listingId);
  return id;
}

export function setStep(id: string | undefined, key: string, status: ActivityStep["status"]): void {
  const step = runs.find((r) => r.id === id)?.steps.find((s) => s.key === key);
  if (!step) return;
  step.status = status;
  step.at = new Date().toISOString();
}

export function setItem(id: string | undefined, itemTitle: string): void {
  const run = runs.find((r) => r.id === id);
  if (run) run.itemTitle = itemTitle;
}

/** Remember (with runId) or look up (without) which sell run a listing belongs to. */
export function runForListing(listingId: string, runId?: string): string | undefined {
  if (runId) listingRuns.set(listingId, runId);
  return listingRuns.get(listingId);
}

export function recentRuns(): ActivityRun[] {
  return structuredClone(runs);
}

export function resetActivityForTests(): void {
  runs = [];
  listingRuns.clear();
}
