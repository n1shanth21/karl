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
}

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

async function describeItem(jpeg: Uint8Array, caption?: string): Promise<ListingDraft | null> {
  const prompt = caption ? `${VISION_PROMPT}\nThe seller's caption: "${caption}"` : VISION_PROMPT;
  const res = await ai().models.generateContent({
    model: config.geminiModel,
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

async function chat(req: { system: string; contents: Content[]; tools: ToolSpec[] }): Promise<Content> {
  const res = await ai().models.generateContent({
    model: config.geminiModel,
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

const real: GeminiApi = { describeItem, chat };
let impl: GeminiApi = real;

export const gemini: GeminiApi = {
  describeItem: (jpeg, caption) => impl.describeItem(jpeg, caption),
  chat: (req) => impl.chat(req),
};

export function setGeminiForTests(fake: Partial<GeminiApi>): void {
  impl = { ...impl, ...fake };
}

/** Put the real Gemini back after a test faked it. */
export function resetGeminiForTests(): void {
  impl = real;
}
