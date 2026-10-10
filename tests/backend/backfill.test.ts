// Tests for the 5-minute embedding backfill job (Gemini is never called here).
import { expect, spyOn, test } from "bun:test";
import { runBackfill } from "../../src/jobs/backfill";

test("calls backfill and logs what it fixed", async () => {
  const log = spyOn(console, "log").mockImplementation(() => {});
  let calls = 0;
  await runBackfill(async () => {
    calls++;
    return { listings: 2, wants: 1 };
  });
  const printed = log.mock.calls.flat().join(" ");
  log.mockRestore();
  expect(calls).toBe(1);
  expect(printed).toContain("2 listings, 1 wants");
});

test("a failing backfill is caught, never thrown", async () => {
  const error = spyOn(console, "error").mockImplementation(() => {});
  await expect(runBackfill(async () => Promise.reject(new Error("gemini down")))).resolves.toBeUndefined();
  error.mockRestore();
});

test("overlapping runs are skipped", async () => {
  let calls = 0;
  let finish: () => void = () => {};
  const slow = () =>
    new Promise<{ listings: number; wants: number }>((resolve) => {
      calls++;
      finish = () => resolve({ listings: 0, wants: 0 });
    });
  const first = runBackfill(slow);
  await runBackfill(slow); // still running -> skipped
  finish();
  await first;
  expect(calls).toBe(1);
});
