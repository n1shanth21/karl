// Gemini embeddings. Owner: Himagna (data branch).
// gemini-embedding-2 does NOT take a taskType. The "task" goes into the text itself:
// documents get a "title: ... | text: ..." prefix, queries get "task: search result | query: ...".
import { GoogleGenAI } from "@google/genai";
import { config, EMBED_DIM } from "../config";

// Raw embedder: already-prefixed texts in, one vector per text out.
export type Embedder = (texts: string[]) => Promise<number[][]>;

const BATCH_SIZE = 100;
const RETRY_DELAY_MS = 1500;

type DocInput = { title: string; category: string; description: string };

export function listingDocText(l: DocInput): string {
  return `title: ${l.title} | text: ${l.category}. ${l.description}`;
}

export function queryText(q: string): string {
  return `task: search result | query: ${q}`;
}

let ai: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (!config.geminiApiKey) {
    throw new Error("GEMINI_API_KEY is empty. Add it to .env (see .env.example) to use embeddings.");
  }
  if (!ai) ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  return ai;
}

// True for HTTP 429 and 5xx. The SDK's ApiError has a numeric `status`; fall back to the message.
function isRetryable(err: unknown): boolean {
  const status = (err as { status?: unknown })?.status;
  if (typeof status === "number") return status === 429 || status >= 500;
  const message = err instanceof Error ? err.message : String(err);
  return /\b(429|5\d\d)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|INTERNAL/.test(message);
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await client().models.embedContent({
    model: config.geminiEmbedModel,
    contents: texts.map((t) => ({ parts: [{ text: t }] })), // one Content each => one vector each
    config: { outputDimensionality: EMBED_DIM },
  });
  const vectors = (res.embeddings ?? []).map((e) => e.values ?? []);
  if (vectors.length !== texts.length) {
    throw new Error(`Gemini returned ${vectors.length} embeddings for ${texts.length} texts`);
  }
  for (const v of vectors) {
    if (v.length !== EMBED_DIM) throw new Error(`Expected ${EMBED_DIM}-dim embedding, got ${v.length}`);
  }
  return vectors;
}

// One call (run() below keeps each call to at most BATCH_SIZE texts). Retries once on 429/5xx.
async function geminiEmbedder(texts: string[]): Promise<number[][]> {
  try {
    return await embedBatch(texts);
  } catch (err) {
    if (!isRetryable(err)) throw err;
    console.warn(`[embed] retrying batch of ${texts.length} texts after a 429/5xx`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return embedBatch(texts);
  }
}

// Tests inject a fake here; null restores the real Gemini embedder.
let embedder: Embedder = geminiEmbedder;
export function setEmbedder(fn: Embedder | null): void {
  embedder = fn ?? geminiEmbedder;
}

// Splits into batches of at most BATCH_SIZE (100) texts, for the real embedder and for fakes.
async function run(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    out.push(...(await embedder(texts.slice(i, i + BATCH_SIZE))));
  }
  return out;
}

export async function embedDocuments(items: DocInput[]): Promise<number[][]> {
  return run(items.map(listingDocText));
}

export async function embedQuery(q: string): Promise<number[]> {
  return (await run([queryText(q)]))[0];
}
