import type { ActivityRun, ActivityStep } from "./types";

type Demo = { kind: "sell" | "buy"; firstName: string; itemTitle: string; steps: [string, string][] };

// The demo plays these runs in order, forever. The third one shows the "want saved" ending.
const DEMOS: Demo[] = [
  {
    kind: "sell",
    firstName: "Maya",
    itemTitle: "desk lamp",
    steps: [
      ["received", "Text received"],
      ["photo_converted", "Photo converted"],
      ["vision_draft", "Gemini drafts listing"],
      ["safety", "Safety check"],
      ["awaiting_confirm", "Seller confirms"],
      ["live", "Listing live"],
      ["wants_checked", "Wants checked"],
    ],
  },
  {
    kind: "buy",
    firstName: "Jordan",
    itemTitle: "mini fridge",
    steps: [
      ["received", "Text received"],
      ["understood", "Gemini reads request"],
      ["search", "Searching listings"],
      ["results_sent", "Matches sent"],
    ],
  },
  {
    kind: "buy",
    firstName: "Priya",
    itemTitle: "bike lock",
    steps: [
      ["received", "Text received"],
      ["understood", "Gemini reads request"],
      ["search", "Searching listings"],
      ["want_saved", "Want saved"],
    ],
  },
];

export const SIM_STEP_MS = 1200; // one "tick": time between steps
const HOLD_TICKS = 3; // how many ticks the finished run stays on screen

// Builds the demo run to show at a given tick (0, 1, 2, ... counted by the hook).
// Step times are fake but spaced SIM_STEP_MS apart, so the panel shows "1.2s" per step.
export function simulatedRun(tick: number): ActivityRun {
  const total = DEMOS.reduce((sum, d) => sum + d.steps.length + HOLD_TICKS, 0);
  let t = tick % total;
  let demoIndex = 0;
  while (t >= DEMOS[demoIndex].steps.length + HOLD_TICKS) {
    t -= DEMOS[demoIndex].steps.length + HOLD_TICKS;
    demoIndex += 1;
  }
  const demo = DEMOS[demoIndex];
  const done = Math.min(t, demo.steps.length); // steps finished so far; the next one is active

  const start = Date.UTC(2026, 0, 1); // fixed fake start so server and browser render the same thing
  const steps: ActivityStep[] = demo.steps.map(([key, label], i) => ({
    key,
    label,
    status: i < done ? "done" : i === done ? "active" : "pending",
    at: i <= done ? new Date(start + i * SIM_STEP_MS).toISOString() : null,
  }));
  return {
    id: `demo-${demoIndex}`,
    kind: demo.kind,
    firstName: demo.firstName,
    itemTitle: demo.itemTitle,
    startedAt: new Date(start).toISOString(),
    steps,
  };
}
