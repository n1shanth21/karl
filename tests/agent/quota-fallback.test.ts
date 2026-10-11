// When the main Gemini model hits its daily quota, Karl switches to the backup model instead of "brain glitched".
import { afterAll, beforeEach, expect, test } from "bun:test";
import { currentModel, resetModelCooldownForTests, withRetry } from "../../src/agent/gemini";
import { config } from "../../src/config";

const original = { main: config.geminiModel, backup: config.geminiFallbackModel };
const quotaError = () => Object.assign(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"quota"}}'), { status: 429 });
const rateError = () => Object.assign(new Error("Too many requests, slow down"), { status: 429 });

beforeEach(() => {
  config.geminiModel = "main-model";
  config.geminiFallbackModel = "backup-model";
  resetModelCooldownForTests();
});
afterAll(() => {
  config.geminiModel = original.main;
  config.geminiFallbackModel = original.backup;
  resetModelCooldownForTests();
});

test("quota exhausted on the main model -> same request succeeds on the backup", async () => {
  const seen: string[] = [];
  const out = await withRetry(async (model) => {
    seen.push(model);
    if (model === "main-model") throw quotaError();
    return "ok";
  }, "chat");
  expect(out).toBe("ok");
  expect(seen).toEqual(["main-model", "backup-model"]);
});

test("after a quota error, later calls go straight to the backup (no wasted request)", async () => {
  await withRetry(async (model) => {
    if (model === "main-model") throw quotaError();
    return "ok";
  }, "chat");
  expect(currentModel()).toBe("backup-model");
  const seen: string[] = [];
  await withRetry(async (model) => (seen.push(model), "ok"), "chat");
  expect(seen).toEqual(["backup-model"]);
});

test("the cooldown ends after an hour", () => {
  expect(currentModel(Date.now() + 61 * 60_000)).toBe("main-model");
});

test("a plain 429 (rate, not quota) retries the SAME model once", async () => {
  const seen: string[] = [];
  await expect(
    withRetry(async (model) => {
      seen.push(model);
      throw rateError();
    }, "chat"),
  ).rejects.toThrow();
  expect(seen).toEqual(["main-model", "main-model"]);
});

test("quota error on the backup itself is not retried forever", async () => {
  config.geminiModel = "backup-model";
  const seen: string[] = [];
  await expect(
    withRetry(async (model) => {
      seen.push(model);
      throw quotaError();
    }, "chat"),
  ).rejects.toThrow();
  expect(seen.length).toBeLessThanOrEqual(2);
});
