// Gemini retry helper + the loop's error log. No network: attempts are fakes.
import { afterAll, expect, spyOn, test } from "bun:test";
import { resetGeminiForTests, setGeminiForTests, withRetry } from "../../src/agent/gemini";
import { runAgentTurn } from "../../src/agent/loop";
import { fakeUser, resetAll } from "./helpers";

const named = (name: string, extra: Record<string, unknown> = {}) => Object.assign(new Error("boom"), { name }, extra);

/** An attempt that throws each of `errors` in turn, then returns "ok". */
function flaky(...errors: unknown[]) {
  const state = { calls: 0 };
  const attempt = async () => {
    state.calls++;
    if (errors.length) throw errors.shift();
    return "ok";
  };
  return { state, attempt };
}

afterAll(resetGeminiForTests);

test("withRetry: timeout then success returns the result after exactly 2 attempts", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  const { state, attempt } = flaky(named("TimeoutError"));
  expect(await withRetry(attempt, "chat")).toBe("ok");
  expect(state.calls).toBe(2);
  expect(warn).toHaveBeenCalledWith("[gemini] chat retry after TimeoutError");
  warn.mockRestore();
});

test("withRetry: non-retryable error throws after 1 attempt", async () => {
  const { state, attempt } = flaky(named("Error"));
  await expect(withRetry(attempt, "chat")).rejects.toThrow("boom");
  expect(state.calls).toBe(1);
});

test("withRetry: retryable twice throws after exactly 2 attempts", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  const { state, attempt } = flaky(named("AbortError"), named("AbortError"));
  await expect(withRetry(attempt, "chat")).rejects.toThrow("boom");
  expect(state.calls).toBe(2);
  warn.mockRestore();
});

test("withRetry: status 429 is retryable", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  const { state, attempt } = flaky(named("Error", { status: 429 }));
  expect(await withRetry(attempt, "chat")).toBe("ok");
  expect(state.calls).toBe(2);
  warn.mockRestore();
});

test("runAgentTurn: a TimeoutError from chat returns the fallback and logs the error name", async () => {
  await resetAll();
  const err = spyOn(console, "error").mockImplementation(() => {});
  setGeminiForTests({
    async chat() {
      throw new DOMException("The operation timed out.", "TimeoutError");
    },
  });
  expect(await runAgentTurn(await fakeUser(), "hi")).toBe("my brain glitched for a sec, try that again?");
  expect(err.mock.calls.some((c) => String(c[0]).includes("TimeoutError: The operation timed out."))).toBe(true);
  err.mockRestore();
});
