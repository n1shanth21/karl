// Embedding helpers: prefixes, batching, and one live check against the real Gemini API.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { EMBED_DIM } from "../../src/config";
import { embedDocuments, embedQuery, listingDocText, queryText, setEmbedder } from "../../src/matching/embed";

setDefaultTimeout(30_000);

afterEach(() => setEmbedder(null));

const fakeVector = () => new Array(EMBED_DIM).fill(0.5);

describe("embed (fake embedder)", () => {
  test("listing and query prefixes", () => {
    const doc = { title: "Mini fridge", category: "appliance", description: "works great" };
    expect(listingDocText(doc)).toBe("title: Mini fridge | text: appliance. works great");
    expect(queryText("cold drinks")).toBe("task: search result | query: cold drinks");
  });

  test("embedDocuments and embedQuery send prefixed text", async () => {
    const seen: string[][] = [];
    setEmbedder(async (texts) => {
      seen.push(texts);
      return texts.map(fakeVector);
    });
    const vectors = await embedDocuments([
      { title: "Lamp", category: "furniture", description: "desk lamp" },
      { title: "Fridge", category: "appliance", description: "mini" },
    ]);
    expect(vectors.length).toBe(2);
    expect(seen[0]).toEqual(["title: Lamp | text: furniture. desk lamp", "title: Fridge | text: appliance. mini"]);

    await embedQuery("desk lamp");
    expect(seen[1]).toEqual(["task: search result | query: desk lamp"]);
  });

  test("250 texts are split into 3 calls (100, 100, 50)", async () => {
    const sizes: number[] = [];
    setEmbedder(async (texts) => {
      sizes.push(texts.length);
      return texts.map(fakeVector);
    });
    const items = Array.from({ length: 250 }, (_, i) => ({ title: `t${i}`, category: "c", description: "d" }));
    const vectors = await embedDocuments(items);
    expect(sizes).toEqual([100, 100, 50]);
    expect(vectors.length).toBe(250);
  });

  test("embedQuery returns one vector", async () => {
    setEmbedder(async (texts) => texts.map(fakeVector));
    const v = await embedQuery("mini fridge");
    expect(v.length).toBe(EMBED_DIM);
  });

  test("empty input makes no calls", async () => {
    let calls = 0;
    setEmbedder(async (texts) => {
      calls++;
      return texts.map(fakeVector);
    });
    expect(await embedDocuments([])).toEqual([]);
    expect(calls).toBe(0);
  });
});

const cosine = (a: number[], b: number[]) =>
  a.reduce((s, x, i) => s + x * b[i], 0) / Math.hypot(...a) / Math.hypot(...b);

describe("embed (live Gemini)", () => {
  // Live API call: opt-in only (RUN_LIVE_GEMINI=1 bun test ...) so merges never depend on Gemini quota.
  test.skipIf(!process.env.GEMINI_API_KEY || process.env.RUN_LIVE_GEMINI !== "1")("related listing scores higher than unrelated one", async () => {
    const [fridge, oil] = await embedDocuments([
      { title: "Mini fridge", category: "appliance", description: "compact dorm fridge, keeps drinks cold, good condition" },
      { title: "Lamp oil", category: "household", description: "bottle of lamp oil for oil lanterns" },
    ]);
    const q = await embedQuery("something to keep drinks cold");
    expect(fridge.length).toBe(EMBED_DIM);
    expect(q.length).toBe(EMBED_DIM);
    expect(cosine(q, fridge)).toBeGreaterThan(cosine(q, oil));
  });
});
