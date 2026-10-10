// Photo safety check. Gemini looks at every inbound photo before it is saved,
// drafted into a listing, or relayed to the other person.
//   explicit   → block + ban the sender
//   suggestive → block the photo only
//   ok         → allow
//   unknown (Gemini refused, errored, or timed out) → block, no ban
// The reason goes to the SENDER only, in Karl's voice.

import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from "@google/genai";
import { config } from "../config";
import { banUser } from "./bans";

export type ImageLabel = "ok" | "suggestive" | "explicit" | "unknown";
export type ImageVerdict = { action: "allow" | "block"; reason?: string; banned: boolean };

/** Anything that can look at a photo and label it. Tests pass a fake one. */
export type ImageClassifier = (bytes: Uint8Array, mimeType: string) => Promise<ImageLabel>;

const TIMEOUT_MS = 10_000;

const PROMPT = `You are the content moderator for a college campus buy/sell marketplace.
Label this photo with exactly one verdict:
- "explicit": nudity, exposed genitals or breasts, sexual acts or sexual content, graphic gore or violence, hate symbols.
- "suggestive": not explicit, but sexualized or revealing photos of a person (e.g. posing in underwear or lingerie, shirtless selfies).
- "ok": everything else. Normal items for sale, clothing laid flat or on a hanger, fully clothed people, rooms, screenshots of products.
Answer in JSON only.`;

const SCHEMA = {
  type: "object",
  properties: { verdict: { type: "string", enum: ["ok", "suggestive", "explicit"] } },
  required: ["verdict"],
};

let client: GoogleGenAI | null = null;

/** The real classifier: asks Gemini. Returns "unknown" if anything goes wrong. */
export const geminiClassifier: ImageClassifier = async (bytes, mimeType) => {
  if (!config.geminiApiKey) return "unknown";
  client ??= new GoogleGenAI({ apiKey: config.geminiApiKey });
  try {
    const response = await client.models.generateContent({
      model: config.geminiModel,
      contents: [
        {
          role: "user",
          parts: [{ inlineData: { mimeType, data: Buffer.from(bytes).toString("base64") } }, { text: PROMPT }],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: SCHEMA,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        // We want Gemini to label bad photos, not refuse to look at them.
        safetySettings: [
          HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          HarmCategory.HARM_CATEGORY_HARASSMENT,
          HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        ].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_NONE })),
      },
    });
    if (response.promptFeedback?.blockReason) return "unknown";
    const verdict = JSON.parse(response.text ?? "{}").verdict;
    return verdict === "ok" || verdict === "suggestive" || verdict === "explicit" ? verdict : "unknown";
  } catch (err) {
    console.log(`[safety] image check failed: ${err instanceof Error ? err.message : String(err)}`);
    return "unknown";
  }
};

/** Check a photo. Bans the sender if it's explicit. */
export async function checkPhoto(
  bytes: Uint8Array,
  mimeType: string,
  userId: string,
  classify: ImageClassifier = geminiClassifier,
): Promise<ImageVerdict> {
  const label = await classify(bytes, mimeType);
  console.log(`[safety] photo from ${userId}: ${label}`);

  if (label === "explicit") {
    banUser(userId);
    return {
      action: "block",
      reason: "nope. that photo is way out of line, so you're done here. karl won't reply to this number anymore.",
      banned: true,
    };
  }
  if (label === "suggestive") {
    return { action: "block", reason: "can't use that photo. send one of just the item 📸", banned: false };
  }
  if (label === "unknown") {
    return { action: "block", reason: "hmm, i couldn't check that photo. mind sending another one?", banned: false };
  }
  return { action: "allow", banned: false };
}
