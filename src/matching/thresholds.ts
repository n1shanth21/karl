// Similarity cutoffs for semantic matching (cosine similarity, 0..1). Owner: Himagna (data branch).
// Tuned with scripts/tune-matching.ts on 22 UNC listings x 18 buyer phrasings (gemini-embedding-2, 768 dims):
//   correct matches scored 0.662-0.799; junk ("concert tickets" -> textbook) <= 0.596; "lamp oil" vs a
//   desk-lamp request <= 0.653; demo pairs: "drinks cold" -> mini fridge 0.691, "desk lamp under $20" -> 0.749.
// Search shows results the buyer asked for, so it is looser. A proactive match texts someone unprompted,
// so it is stricter. These replace LIMITS.searchThreshold / LIMITS.matchThreshold (config.ts) in postgres mode.
export const SEARCH_MIN_SCORE = 0.64; // 0.62 let "lamp oil" (0.624) show up for "drinks cold" in a real run
export const MATCH_MIN_SCORE = 0.67;

// Proactive pings also reach a buyer when the listing is a bit over their max (price <= max * 1.5), because the
// buyer may be happy to make an offer. Search stays strict: it only shows listings within the max.
export const NEAR_MISS_FACTOR = 1.5;
