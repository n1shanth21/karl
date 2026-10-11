// Gemini wrapper. Owner: Nishanth. CONTRACT (agent-internal): other agent files use only these exports.
// Tests swap the client with setGeminiForTests(); nothing in tests should reach the real API.

import { GoogleGenAI, ThinkingLevel, type Content } from "@google/genai";
import { config } from "../config";
import type { Condition, ListingDraft } from "../types";

const TIMEOUT_MS = 20_000;
export const CONDITIONS: Condition[] = ["new", "like_new", "good", "fair", "poor"];

export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> }; // JSON Schema

export interface GeminiApi {
  /** Vision: identify the item in a JPEG and draft a listing. null = can't tell what it is (ask for another angle). */
  describeItem(jpeg: Uint8Array, caption?: string): Promise<ListingDraft | null>;
  /** One model turn. Returns the model's Content untouched: Gemini 3 needs it (thought signatures
   *  included) appended to the history as-is on the next call. */
  chat(req: { system: string; contents: Content[]; tools: ToolSpec[] }): Promise<Content>;
  /** Which listing titles ARE the item the buyer asked for (same kind of item)? 0-based indices; [] = none. */
  pickRelevant(request: string, titles: string[]): Promise<number[]>;
  /** Free text about when someone is free -> absolute windows (ISO 8601, New York time) + a campus spot if they named one. */
  extractAvailability(text: string, nowIso: string): Promise<{ windows: { startIso: string; endIso: string }[]; spot: string | null }>;
  /** A mid-deal text that isn't obviously chat: is it for Karl (an instruction or question to the assistant) or for the other person? */
  classifyDealMessage(text: string, ctx: DealMessageContext): Promise<{ to: "karl" | "counterpart" }>;
}

export type DealMessageContext = { item: string; counterpartName: string; role: "buyer" | "seller" };

let client: GoogleGenAI | null = null;
function ai(): GoogleGenAI {
  if (!config.geminiApiKey) throw new Error("GEMINI_API_KEY is not set");
  return (client ??= new GoogleGenAI({ apiKey: config.geminiApiKey }));
}

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: 'Short, like "Mini fridge (Galanz 3.1 cu ft)"' },
    description: { type: "string", description: "One sentence" },
    category: { type: "string", description: 'Lowercase noun, e.g. "mini fridge"' },
    condition: { type: "string", enum: CONDITIONS },
    priceCents: { type: "integer", description: "Fair USED price a UNC student would pay, in cents. Round to $5 above $20." },
    confidence: { type: "number", description: "0..1, how sure you are of what the single item is. Use 0 if there is no single sellable item." },
  },
  required: ["title", "description", "category", "condition", "priceCents", "confidence"],
};

const VISION_PROMPT =
  "You help UNC Chapel Hill students sell used stuff. Identify the single item for sale in this photo and draft a listing for it.";

/** Timeouts/aborts and 429/500/503 are worth one more try; anything else (bad key, bad request) is not. */
function retryReason(err: unknown): string | number | null {
  const { name, status } = (err ?? {}) as { name?: string; status?: unknown };
  if (name === "TimeoutError" || name === "AbortError") return name;
  return status === 429 || status === 500 || status === 503 ? status : null;
}

/** A daily/free-tier quota error: retrying the same model is pointless until tomorrow. */
function isQuotaError(err: unknown): boolean {
  const { status, message } = (err ?? {}) as { status?: unknown; message?: unknown };
  return status === 429 && /RESOURCE_EXHAUSTED|quota/i.test(String(message ?? ""));
}

// Once the main model's quota runs out, use the backup model for a while instead of failing every message.
let mainModelOutUntil = 0;
const QUOTA_COOLDOWN_MS = 60 * 60_000;

/** The model to use right now: the main one, or the backup while the main one is out of quota. */
export function currentModel(now = Date.now()): string {
  return now < mainModelOutUntil ? config.geminiFallbackModel : config.geminiModel;
}

/** Run `attempt(model)` (it must make a fresh request, with a fresh timeout, each call). One retry:
 *  quota exhausted -> same request on the backup model; timeout/429/500/503 -> same model again. */
export async function withRetry<T>(attempt: (model: string) => Promise<T>, label: string): Promise<T> {
  const model = currentModel();
  try {
    return await attempt(model);
  } catch (err) {
    if (isQuotaError(err) && model !== config.geminiFallbackModel) {
      mainModelOutUntil = Date.now() + QUOTA_COOLDOWN_MS;
      console.warn(`[gemini] ${label}: ${model} out of quota, switching to ${config.geminiFallbackModel}`);
      return attempt(config.geminiFallbackModel);
    }
    const reason = retryReason(err);
    if (reason === null) throw err;
    console.warn(`[gemini] ${label} retry after ${reason}`);
    return attempt(model);
  }
}

/** Tests only: forget a quota cooldown. */
export function resetModelCooldownForTests(): void {
  mainModelOutUntil = 0;
}

async function describeItemOnce(model: string, jpeg: Uint8Array, caption?: string): Promise<ListingDraft | null> {
  const prompt = caption ? `${VISION_PROMPT}\nThe seller's caption: "${caption}"` : VISION_PROMPT;
  const res = await ai().models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: Buffer.from(jpeg).toString("base64") } }, { text: prompt }] }],
    config: { responseMimeType: "application/json", responseJsonSchema: DRAFT_SCHEMA, abortSignal: AbortSignal.timeout(TIMEOUT_MS) },
  });
  const draft = JSON.parse(res.text ?? "{}") as Partial<ListingDraft>;
  if (!draft.title || !draft.condition || !CONDITIONS.includes(draft.condition)) return null;
  if (typeof draft.priceCents !== "number" || typeof draft.confidence !== "number" || draft.confidence < 0.4) return null;
  return {
    title: draft.title,
    description: draft.description ?? "",
    category: (draft.category ?? "").toLowerCase(),
    condition: draft.condition,
    priceCents: Math.max(100, Math.round(draft.priceCents)),
    confidence: Math.min(1, draft.confidence),
  };
}

async function chatOnce(model: string, req: { system: string; contents: Content[]; tools: ToolSpec[] }): Promise<Content> {
  const res = await ai().models.generateContent({
    model,
    contents: req.contents,
    config: {
      systemInstruction: req.system,
      tools: req.tools.length ? [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }] : undefined,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, // texting needs to feel fast
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    },
  });
  const content = res.candidates?.[0]?.content;
  if (!content) throw new Error("Gemini returned no content");
  return content;
}

const RELEVANT_SCHEMA = {
  type: "object",
  properties: { indices: { type: "array", items: { type: "integer" }, description: "0-based indices of the titles that are the requested item" } },
  required: ["indices"],
};

async function pickRelevantOnce(model: string, request: string, titles: string[]): Promise<number[]> {
  const list = titles.map((t, i) => `${i}: ${t}`).join("\n");
  const prompt =
    `A buyer texted: "${request}"\nWhich of these listings ARE the item they asked for? Same kind of item only: ` +
    `a desk fan is not a desk lamp, but a mini fridge is "something to keep drinks cold". Return the 0-based indices, or an empty list if none.\n${list}`;
  const res = await ai().models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: RELEVANT_SCHEMA,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      abortSignal: AbortSignal.timeout(10_000),
    },
  });
  const { indices } = JSON.parse(res.text ?? "{}") as { indices?: unknown };
  if (!Array.isArray(indices)) throw new Error("Gemini returned no indices");
  return indices.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < titles.length);
}

const AVAILABILITY_SCHEMA = {
  type: "object",
  properties: {
    windows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          startIso: { type: "string", description: 'ISO 8601 with New York offset, like "2026-10-11T14:00:00-04:00"' },
          endIso: { type: "string", description: "Same format; after startIso" },
        },
        required: ["startIso", "endIso"],
      },
    },
    spot: { type: "string", description: "A campus meetup spot they named (the Pit, student union, Davis library, Lenoir, Rams Head), else empty string" },
  },
  required: ["windows", "spot"],
};

async function extractAvailabilityOnce(model: string, text: string, nowIso: string) {
  const when = new Date(nowIso).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "short" });
  const prompt =
    `It is right now ${when} in New York (${nowIso}). A UNC student texted when they are free to meet to hand off an item: "${text}"\n` +
    `Return the time windows they are free as absolute ISO 8601 timestamps with the New York offset. "today", "tmr" and "tomorrow" are relative to the current ` +
    `date above (tmr is the next calendar day, even at 9pm, but between midnight and 5am it means the coming daytime, i.e. today). A single time like "6pm" is a one hour window. "after 2" runs to 8pm. ` +
    `Only consider 9am to 8pm and the next 7 days. If they name no usable time, return an empty list.`;
  const res = await ai().models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: AVAILABILITY_SCHEMA,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      abortSignal: AbortSignal.timeout(10_000),
    },
  });
  const out = JSON.parse(res.text ?? "{}") as { windows?: unknown; spot?: unknown };
  if (!Array.isArray(out.windows)) throw new Error("Gemini returned no windows");
  const windows = out.windows.filter((w): w is { startIso: string; endIso: string } => typeof w?.startIso === "string" && typeof w?.endIso === "string");
  return { windows, spot: typeof out.spot === "string" && out.spot.trim() ? out.spot.trim() : null };
}

const ROUTE_SCHEMA = {
  type: "object",
  properties: { to: { type: "string", enum: ["karl", "counterpart"], description: "who the text is addressed to" } },
  required: ["to"],
};

async function classifyDealMessageOnce(model: string, text: string, ctx: DealMessageContext): Promise<{ to: "karl" | "counterpart" }> {
  const other = ctx.role === "buyer" ? "seller" : "buyer";
  const prompt =
    `A ${ctx.role} is mid-deal for a "${ctx.item}" with the ${other} (${ctx.counterpartName}). Their texts go to Karl, an assistant who normally forwards them to ${ctx.counterpartName}.\n` +
    `Text: "${text}"\n` +
    `Is this text addressed to Karl (asking or telling the assistant to do something, asking about their own listings or deals, or talking ABOUT ${ctx.counterpartName} in the third person) ` +
    `or is it a message meant for ${ctx.counterpartName} (talking TO them: meetup logistics, questions about the item, small talk)? When unsure, answer "counterpart".`;
  const res = await ai().models.generateContent({
    model,
    contents: prompt,
    config: { responseMimeType: "application/json", responseJsonSchema: ROUTE_SCHEMA, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, abortSignal: AbortSignal.timeout(3_000) },
  });
  const { to } = JSON.parse(res.text ?? "{}") as { to?: unknown };
  if (to !== "karl" && to !== "counterpart") throw new Error("Gemini returned no routing");
  return { to };
}

const real: GeminiApi = {
  describeItem: (jpeg, caption) => withRetry((model) => describeItemOnce(model, jpeg, caption), "describeItem"),
  chat: (req) => withRetry((model) => chatOnce(model, req), "chat"),
  pickRelevant: (request, titles) => withRetry((model) => pickRelevantOnce(model, request, titles), "pickRelevant"),
  extractAvailability: (text, nowIso) => withRetry((model) => extractAvailabilityOnce(model, text, nowIso), "extractAvailability"),
  classifyDealMessage: (text, ctx) => classifyDealMessageOnce(currentModel(), text, ctx), // no retry: a relay must not wait
};
// Under `bun test` the real API is off limits (bun loads .env, so a missing fake would bill a real call).
const offline = (name: string) => async (): Promise<never> => {
  throw new Error(`real Gemini ${name}() called from a test: fake it with setGeminiForTests`);
};
const base: GeminiApi =
  process.env.NODE_ENV === "test" ? { describeItem: offline("describeItem"), chat: offline("chat"), pickRelevant: offline("pickRelevant"), extractAvailability: offline("extractAvailability"), classifyDealMessage: offline("classifyDealMessage") } : real;
let impl: GeminiApi = base;

export const gemini: GeminiApi = {
  describeItem: (jpeg, caption) => impl.describeItem(jpeg, caption),
  chat: (req) => impl.chat(req),
  pickRelevant: (request, titles) => impl.pickRelevant(request, titles),
  extractAvailability: (text, nowIso) => impl.extractAvailability(text, nowIso),
  classifyDealMessage: (text, ctx) => impl.classifyDealMessage(text, ctx),
};

export function setGeminiForTests(fake: Partial<GeminiApi>): void {
  impl = { ...impl, ...fake };
}

/** Drop a test's fakes (back to the offline guard under bun test). */
export function resetGeminiForTests(): void {
  impl = base;
}
