// searchAndShow only offers results that are really the item asked for. Gemini is always faked.
import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { resetGeminiForTests, setGeminiForTests } from "../../src/agent/gemini";
import { db } from "../../src/db";
import { searchAndShow, setResultPauseForTests } from "../../src/flows/buy";
import * as photoModule from "../../src/flows/photo";
import { fakeUser, resetAll, sentTo } from "./helpers";

afterEach(() => mock.restore());
afterAll(() => {
  mock.restore();
  resetGeminiForTests();
});

beforeEach(async () => {
  spyOn(photoModule, "photoAttachment").mockResolvedValue(null);
  setResultPauseForTests(0);
  await resetAll();
});

async function list(title: string, category: string) {
  const seller = await fakeUser("Sam");
  const listing = await db.createListing({ sellerId: seller.id, draft: { title, description: "", category, condition: "good", priceCents: 1500, confidence: 0.9 }, photoId: null });
  await db.updateListing(listing.id, { status: "active" });
  const { onListingActivated } = await import("../../src/matching");
  await onListingActivated((await db.getListing(listing.id))!);
  return listing;
}

// The test search is keyword-based, so "desk" is enough for the fan to come back as a candidate.
test("a close-but-wrong result is dropped: nothing is sent and no state is set", async () => {
  const asked: string[][] = [];
  setGeminiForTests({ pickRelevant: async (_request, titles) => (asked.push(titles), []) });
  await list("Blue USB desk fan", "fan");
  const buyer = await fakeUser("Maya");

  expect(await searchAndShow(buyer, "desk lamp", 2000)).toEqual([]);
  expect(asked).toEqual([["Blue USB desk fan"]]);
  expect(sentTo(buyer)).toHaveLength(0);
  expect((await db.getUser(buyer.id))?.state).toEqual({ kind: "idle" });
});

test("only the indices Gemini keeps are shown, in order", async () => {
  setGeminiForTests({ pickRelevant: async (_request, titles) => titles.flatMap((t, i) => (t.includes("lamp") ? [i] : [])) });
  await list("Blue USB desk fan", "fan");
  const lamp = await list("IKEA desk lamp", "desk lamp");
  const buyer = await fakeUser("Maya");

  const shown = await searchAndShow(buyer, "desk lamp", 2000);
  expect(shown.map((l) => l.id)).toEqual([lamp.id]);
  expect(sentTo(buyer).map((s) => s.text)).toEqual(["[content]", "reply with the number (or ❤️ one) and i'll check with the seller"]);
});

test("if Gemini fails, a lone desk fan is dropped and the desk lamp is kept", async () => {
  setGeminiForTests({
    pickRelevant: async () => {
      throw new Error("gemini down");
    },
  });
  spyOn(console, "error").mockImplementation(() => {});
  await list("Blue USB desk fan", "fan");
  const lamp = await list("IKEA desk lamp", "desk lamp");
  const buyer = await fakeUser("Maya");

  const shown = await searchAndShow(buyer, "need a desk lamp under $20", 2000);
  expect(shown.map((l) => l.id)).toEqual([lamp.id]);
  await db.updateListing(lamp.id, { status: "held" });
  expect(await searchAndShow(buyer, "need a desk lamp under $20", 2000)).toEqual([]);
});
