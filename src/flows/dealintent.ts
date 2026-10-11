// Plain-code read of what a user in an active deal is really saying (never Gemini). Owner: Nishanth.
// Used by the relay: a text that ends the deal, starts a NEW request, or is addressed to Karl must not be forwarded.

export type DealIntent = "done" | "off" | "new_request" | "to_karl";

const DONE = [
  /\b(sale|deal)\s*(is|'s)?\s*(done|complete|completed|finished)\b/,
  /\bsold it\b/,
  /\bpicked it up\b/,
  /\bhanded (it )?off\b/,
  /\bwe('re| are) all set[.!\s]*$/,
];
const OFF = [
  /\bdeal('s| is) off\b/,
  /\bme and (this|the) (buyer|seller) are done\b/,
  /\b(we're|we are) done with (this|the) (buyer|seller)\b/,
  /\blet'?s move on\b/,
  /\bbacking out\b/,
  /\b(don't|do not) want it anymore\b/,
  /\bno longer (selling|interested)\b/,
];
// Request-shaped openings only: "looking for parking" / "we need a place" are meetup chat.
const LEAD = String.raw`(?:^|[.!?,]\s*)(?:(?:hey|ok|also|btw)\s+)*`;
const NEW_REQUEST = [
  /\b(i'm|im|i am) selling\b/,
  /\bselling (my|a|an|this)\b/,
  /\b(want|trying|wanna) to sell\b/,
  new RegExp(LEAD + String.raw`(?:i'?m |im |i am )?looking for (a|an|some)\b`),
  new RegExp(LEAD + String.raw`(?:i )?need (a|an|some)\b(?! (min|minute|sec|second|moment|bit|few|little|hand|ride|break|hour)\b)`),
  /\banyone selling\b/,
  /\bwant to buy\b/,
];

const FILLER = new Set("with used good great like brand size pair black white small large free this that your from".split(" "));
const words = (s: string) => (s.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !FILLER.has(w));

/** What the text means for the deal; null = ordinary chat for the other person. `listingTitle` keeps "selling this monitor" chat about the current item. */
export function dealIntent(text: string, listingTitle?: string): DealIntent | null {
  const t = text.toLowerCase().replace(/[’‘]/g, "'");
  const item = listingTitle ? words(listingTitle) : [];
  const aboutThisItem = item.some((w) => new RegExp(`\\b${w}\\b`).test(t));
  if (!aboutThisItem && NEW_REQUEST.some((r) => r.test(t))) return "new_request";
  if (DONE.some((r) => r.test(t))) return "done";
  if (OFF.some((r) => r.test(t))) return "off";
  return /\bkarl\b/.test(t) ? "to_karl" : null;
}
