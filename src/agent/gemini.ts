// Gemini wrapper. Owner: Nishanth. CONTRACT (agent-internal): other agent files use only these exports.
// Implementation: Wave 1, agent "brain". Tests swap the client with setGeminiForTests().

import type { ListingDraft } from "../types";

export interface GeminiApi {
  /** Vision: identify the item in a JPEG and draft a listing. null = can't tell what it is (ask for another angle). */
  describeItem(jpeg: Uint8Array, caption?: string): Promise<ListingDraft | null>;
}

let impl: GeminiApi = {
  async describeItem() {
    throw new Error("TODO(wave1-brain): implement describeItem with @google/genai");
  },
};

export const gemini: GeminiApi = {
  describeItem: (jpeg, caption) => impl.describeItem(jpeg, caption),
};

export function setGeminiForTests(fake: Partial<GeminiApi>): void {
  impl = { ...impl, ...fake };
}
