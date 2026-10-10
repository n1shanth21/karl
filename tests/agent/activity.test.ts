// Activity tracker: ring buffer behaviour + a real sell flow lighting up every step.
import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { recentRuns, resetActivityForTests, setStep, startRun } from "../../src/agent/activity";
import { resetGeminiForTests, setGeminiForTests } from "../../src/agent/gemini";
import { tools } from "../../src/agent/tools";
import { setResultPauseForTests } from "../../src/flows/buy";
import * as photoModule from "../../src/flows/photo";
import { confirmDraft, draftFromPhoto } from "../../src/flows/sell";
import type { ListingDraft } from "../../src/types";
import { fakeUser, resetAll } from "./helpers";

afterEach(() => mock.restore());
afterAll(() => {
  mock.restore();
  resetGeminiForTests();
  resetActivityForTests();
});

beforeEach(async () => {
  spyOn(photoModule, "toJpeg").mockImplementation(async (bytes) => ({ bytes, mimeType: "image/jpeg" }));
  spyOn(photoModule, "photoAttachment").mockImplementation(async () => null);
  setResultPauseForTests(0);
  resetActivityForTests();
  await resetAll();
});

test("keeps only the 5 most recent runs, newest first", () => {
  const ids = Array.from({ length: 7 }, (_, i) => startRun("buy", `User${i}`));
  const runs = recentRuns();
  expect(runs.map((r) => r.id)).toEqual(ids.slice(2).reverse());
  expect(runs[0]!.firstName).toBe("User6");
});

test("setStep on an unknown run or step is a no-op and falls back to 'someone'", () => {
  const id = startRun("sell", null);
  expect(() => setStep("nope", "received", "done")).not.toThrow();
  expect(() => setStep(id, "nope", "done")).not.toThrow();
  const [run] = recentRuns();
  expect(run!.firstName).toBe("someone");
  expect(run!.steps.every((s) => s.status === "pending" && s.at === null)).toBe(true);
});

test("recentRuns returns copies callers cannot mutate", () => {
  startRun("buy", "Maya");
  recentRuns()[0]!.firstName = "hacked";
  expect(recentRuns()[0]!.firstName).toBe("Maya");
});

test("sell flow photo -> draft -> confirm ends with every step done and no phone digits", async () => {
  const draft: ListingDraft = { title: "Mini Fridge", description: "works great", category: "mini fridge", condition: "like_new", priceCents: 4500, confidence: 0.9 };
  setGeminiForTests({ describeItem: async () => draft });
  const seller = await fakeUser("Sam");
  const result = await draftFromPhoto(seller, { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/heic" });
  expect(result.ok).toBe(true);
  expect(recentRuns()[0]!.steps.find((s) => s.key === "awaiting_confirm")!.status).toBe("active");
  expect((await confirmDraft(seller)).ok).toBe(true);

  const [run] = recentRuns();
  expect(run!.kind).toBe("sell");
  expect(run!.firstName).toBe("Sam");
  expect(run!.itemTitle).toBe("Mini Fridge");
  expect(run!.steps.map((s) => s.status)).toEqual(Array(7).fill("done"));
  expect(JSON.stringify(recentRuns())).not.toMatch(/\d{7,}/);
  expect(JSON.stringify(recentRuns())).not.toContain(seller.phone);
});

test("search tool records a buy run with a saved want when nothing matches, without the query text", async () => {
  const buyer = await fakeUser("Maya");
  const search = tools.find((t) => t.name === "search")!;
  await search.run(buyer, { query: "zzz secret query" });
  const [run] = recentRuns();
  expect(run!.kind).toBe("buy");
  expect(run!.itemTitle).toBeNull();
  expect(run!.steps.map((s) => s.status)).toEqual(["done", "done", "done", "pending", "done"]);
  expect(JSON.stringify(run)).not.toContain("secret");
});
