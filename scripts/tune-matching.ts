// Threshold tuning for matching. Embeds the fixture catalog + queries with the real
// Gemini model, then prints how well the right listing scores vs the wrong ones.
// Run: bun --env-file=.env scripts/tune-matching.ts   (about 19 API calls, so don't spam it)
// Owner: Himagna (data branch).
import { embedDocuments, embedQuery } from "../src/matching/embed";
import { LIMITS } from "../src/config";
import { CATALOG, QUERIES } from "../tests/data/fixtures/pairs";

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const f = (n: number) => n.toFixed(3);
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));

// 1. Embed: one call for all docs, then one call per query.
const docVecs = await embedDocuments(CATALOG);
const queryVecs: number[][] = [];
for (const q of QUERIES) queryVecs.push(await embedQuery(q.text));

// 2. Score every query against every listing.
const rightScores: number[] = []; // expected item's score, for queries that have one
const nullTopScores: number[] = []; // top-1 score of queries that should match nothing
const forbiddenScores: number[] = []; // best mustNotMatch score per query
let withExpected = 0;
let top1Correct = 0;
const wrongTop1: string[] = [];

console.log(
  pad("query", 44) + pad("expect", 16) + pad("top1", 16) + "top1sc  rank  exp.sc  forbid",
);
console.log("-".repeat(104));

QUERIES.forEach((q, qi) => {
  const scored = CATALOG.map((c, ci) => ({ key: c.key, score: cosine(queryVecs[qi], docVecs[ci]) }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  let rankText = "-";
  let expText = "-";
  if (q.expectKey) {
    withExpected++;
    const idx = scored.findIndex((s) => s.key === q.expectKey);
    rankText = String(idx + 1);
    expText = f(scored[idx].score);
    rightScores.push(scored[idx].score);
    if (idx === 0) top1Correct++;
    else wrongTop1.push(`"${q.text}" -> ${top.key}`);
  } else {
    nullTopScores.push(top.score);
  }
  let forbidText = "-";
  if (q.mustNotMatch?.length) {
    const best = Math.max(...scored.filter((s) => q.mustNotMatch!.includes(s.key)).map((s) => s.score));
    forbiddenScores.push(best);
    forbidText = f(best);
  }
  console.log(
    pad(q.text, 44) + pad(q.expectKey ?? "(none)", 16) + pad(top.key, 16) +
      pad(f(top.score), 8) + pad(rankText, 6) + pad(expText, 8) + forbidText,
  );
});

// 3. Summary and suggested thresholds.
const minRight = Math.min(...rightScores);
const maxNull = Math.max(...nullTopScores);
const maxForbidden = Math.max(...forbiddenScores);
const maxWrong = Math.max(maxNull, maxForbidden);
const gap = minRight - maxWrong;

console.log("\nSUMMARY");
console.log(`top-1 accuracy:                ${top1Correct}/${withExpected}`);
if (wrongTop1.length) console.log(`wrong top-1:                   ${wrongTop1.join("; ")}`);
console.log(`min score of correct matches:  ${f(minRight)}`);
console.log(`max top-1 of null queries:     ${f(maxNull)}`);
console.log(`max mustNotMatch score:        ${f(maxForbidden)}`);
console.log(`gap (min right - max wrong):   ${f(gap)}`);
console.log(`current config:                matchThreshold=${LIMITS.matchThreshold} searchThreshold=${LIMITS.searchThreshold}`);

if (gap > 0) {
  // Proactive pings are the costly mistake (a bad text), so matchThreshold sits mid-gap.
  // Search results are shown to someone who asked, so searchThreshold sits closer to the wrong scores.
  const match = Math.round((maxWrong + gap * 0.5) * 100) / 100;
  const search = Math.round((maxWrong + gap * 0.25) * 100) / 100;
  console.log(`SUGGESTED matchThreshold:      ${match}`);
  console.log(`SUGGESTED searchThreshold:     ${search}`);
  console.log(
    `rationale: right answers all score >= ${f(minRight)}, wrong ones <= ${f(maxWrong)}; ` +
      `match is the midpoint of that gap, search is 25% up from the wrong scores (more forgiving).`,
  );
} else {
  console.log("SUGGESTED thresholds:          none, right and wrong scores overlap");
  console.log(
    `rationale: a wrong item scores ${f(maxWrong)} but the weakest right one scores ${f(minRight)}; ` +
      "no single cutoff separates them. Improve listing text/query prefixes or rely on ranking, not thresholds.",
  );
}
