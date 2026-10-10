// Phase 0 placeholder scorer: fraction of query words found in the text. Owner: Himagna.
// Replaced by embeddings later, but kept as the memory-mode fallback.

const STOP = new Set(["a", "an", "the", "for", "my", "i", "need", "want", "looking", "under", "to", "of", "and", "or", "some", "any", "with"]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w));
}

export function keywordScore(query: string, text: string): number {
  const q = words(query);
  if (q.length === 0) return 0;
  const haystack = new Set(words(text));
  const hits = q.filter((w) => haystack.has(w) || haystack.has(w.replace(/s$/, ""))).length;
  return hits / q.length;
}
