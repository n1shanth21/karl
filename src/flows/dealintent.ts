// Plain-code read of what a user in an active deal is really saying (never Gemini). Owner: Nishanth.
// Used by the relay: a text that ends the deal, starts a NEW request, or is addressed to Karl must not be forwarded.

// "instruct" = addressed to Karl ABOUT the other person ("can you ask him for 55", "tell her i'm outside").
export type DealIntent = "done" | "off" | "new_request" | "to_karl" | "instruct";

const DONE = [
  /\b(sale|deal)\s*(is|'s)?\s*(done|complete|completed|finished)\b/,
  /\bsold it\b/,
  /\bpicked it up\b/,
  /\bhanded (it )?off\b/,
  /\bwe('re| are) all set[.!\s]*$/,
];
// Looser ways to say it happened. The WHOLE message must say it ("we met", "he paid me"): "got cash, omw" or
// "we met yesterday at the career fair" are ordinary chat. Not for questions or "if/when/once" talk about the future.
const LOOSE_OPEN = String.raw`^(?:(?:ok|so|yeah|yep|and|alright),?\s+)*`;
const LOOSE_END = String.raw`[.!\s]*$`;
const DONE_LOOSE = [
  String.raw`we (?:just )?(?:did (?:the deal|it)|met(?: up)?(?: and (?:he|she|they) paid(?: me)?)?)`,
  String.raw`deal (?:went through|happened)`,
  String.raw`(?:he|she|they) paid(?: me)?`,
  String.raw`i paid(?: him| her| them)?`,
  String.raw`handed it (?:over|off)`,
  String.raw`all good,? (?:it'?s )?done`,
].map((r) => new RegExp(LOOSE_OPEN + r + LOOSE_END));
const FUTURE_TALK = /\?|\b(if|when|once|until|unless|before|will|gonna|going to|wanna|can we|should)\b/;
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

// "ask him", "tell her", "<name>": the counterpart in the third person. Only command-shaped, so "i'll tell him later" stays chat.
const ASK_LEAD = String.raw`(?:^|[.!?,]\s*)(?:(?:hey|ok|also|btw|pls|please|karl|and|then|so)[,\s]+)*`;
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function instructPatterns(counterpartName?: string): RegExp[] {
  const who = String.raw`(?:him|her|them|the seller|the buyer${counterpartName ? `|${escapeRegExp(counterpartName.toLowerCase())}` : ""})`;
  return [
    new RegExp(ASK_LEAD + String.raw`(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:ask|tell|let|message|text|remind|offer|check with)\s+${who}\b`),
    new RegExp(ASK_LEAD + String.raw`(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:see if|find out if|find out whether|check if|check whether|ask if|ask whether)\s+(?:he|she|they)\b`),
    new RegExp(ASK_LEAD + String.raw`(?:does|did)\s+(?:he|she|they)\b`),
    new RegExp(ASK_LEAD + String.raw`is\s+(?:he|she|they)\s+(?:ok|okay|cool|fine|down|good)\b`),
  ];
}

const FILLER = new Set("with used good great like brand size pair black white small large free this that your from".split(" "));
const words = (s: string) => (s.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !FILLER.has(w));

/** What the text means for the deal; null = ordinary chat for the other person. `listingTitle` keeps "selling this monitor" chat about the current item; `counterpartName` lets "ask maya for 55" count as an instruction. */
export function dealIntent(text: string, listingTitle?: string, counterpartName?: string): DealIntent | null {
  const t = text.toLowerCase().replace(/[’‘]/g, "'");
  const item = listingTitle ? words(listingTitle) : [];
  const aboutThisItem = item.some((w) => new RegExp(`\\b${w}\\b`).test(t));
  if (!aboutThisItem && NEW_REQUEST.some((r) => r.test(t))) return "new_request";
  if (DONE.some((r) => r.test(t)) || (!FUTURE_TALK.test(t) && DONE_LOOSE.some((r) => r.test(t)))) return "done";
  if (OFF.some((r) => r.test(t))) return "off";
  if (instructPatterns(counterpartName).some((r) => r.test(t))) return "instruct";
  return /\bkarl\b/.test(t) ? "to_karl" : null;
}

/** A text that is not plain chat for the other person (inbound's scheduling/shortcut/dispute readers must leave it alone). */
export const isDealCommand = (text: string) => ["done", "off", "new_request", "instruct"].includes(dealIntent(text) ?? "");
