// The ONE place user-facing money, item names and conditions are formatted. Owner: Nishanth.

import type { Listing } from "../types";

/** 4500 -> "$45", 4550 -> "$45.50". */
export const dollars = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;

/** Listing title as Karl says it mid-sentence: "Mini Fridge (Galanz)" -> "mini fridge (galanz)". */
export const itemName = (listing: Pick<Listing, "title">) => listing.title.toLowerCase();

/** "like_new" -> "like new". */
export const conditionText = (condition: Listing["condition"]) => condition.replace("_", " ");

const NUMBER = String.raw`\$?(\d{1,4}(?:\.\d{1,2})?)(?:\s*(?:bucks|dollars?|usd))?`;
// "15", "$15", "how about 15", "can do 15 bucks", "15 instead?" (a reply that is only a price, plus filler words)
const BARE_PRICE = new RegExp(
  String.raw`^(?:(?:how about|what about|can do|could do|i can do|i could do|i'll do|ill do|let's do|lets do|maybe|do|counter|counter with|offer|how bout)\s+)*${NUMBER}\s*(?:instead|then|though|tho|pls|please)?\s*[?!.]*$`,
  "i",
);
// A price inside a sentence must read as money: "$10", "10 bucks", or a number right after offer/for/take/pay/do
// that ends the sentence (or is followed by filler). "at 4", "2 bottles", "32 oz", "5 mins" never count.
const FILLER = String.raw`(?=\s*(?:$|[?!.,]|(?:instead|then|though|tho|pls|please|for it|if|or|and)\b))`;
const DOLLAR_PRICE = /(?:^|[^\w.])\$(\d{1,4}(?:\.\d{1,2})?)(?![\d%])/;
const BUCKS_PRICE = /(?:^|[^\w.$])(\d{1,4}(?:\.\d{1,2})?)\s*(?:bucks|dollars?|usd)\b/i;
const VERB_PRICE = new RegExp(String.raw`\b(?:offer|for|take|pay|do)\s+(\d{1,4}(?:\.\d{1,2})?)(?!\d)` + FILLER, "i");

const HAGGLE = /\b(offer|ask|take|taking|accept|would|will|lower|less|cheaper|instead|how about|what about)\b/i;

const toCents = (n: string | undefined) => {
  const cents = Math.round(Number(n) * 100);
  return Number.isFinite(cents) && cents > 0 ? cents : null;
};

/** A reply that is only a price ("$15", "how about 15", "15 bucks") -> cents, else null. */
export function parsePriceCents(text: string): number | null {
  return toCents(BARE_PRICE.exec(text.trim())?.[1]);
}

/** A buyer asking to pay a different price ("offer 10", "can you ask the seller for $10 instead?") -> cents, else null. */
export function parseOfferCents(text: string): number | null {
  const t = text.trim();
  const bare = parsePriceCents(t);
  if (bare !== null && !/^\d+(?:\.\d+)?$/.test(t)) return bare; // a lone number could be a result index
  if (t.split(/\s+/).length > 14) return null;
  const verb = VERB_PRICE.exec(t)?.[1];
  if (verb) return toCents(verb);
  return HAGGLE.test(t) ? toCents((DOLLAR_PRICE.exec(t) ?? BUCKS_PRICE.exec(t))?.[1]) : null;
}

// A short sentence around a price, as an answer to a price question: "sure 60", "60 works", "55 is fine", "65 is my lowest".
const REPLY_PRICE = /^(?:[a-z']+[,\s]+){0,1}\$?(\d{1,4}(?:\.\d{1,2})?)(?![\d:%.]|\s*(?:pm|am|min|mins|minutes|hours?|oz|th|st|nd|rd)\b)(?:\s+[a-z' ]+)?[.!?\s]*$/i;
const TIME_WORD = /\b(?:at|by|around|after|before|until|till|on)\s+\$?\d/i;

/** A short reply with a price in it ("sure 60", "60 works") -> cents, else null. Only for answering a price question. */
export function parseReplyPriceCents(text: string): number | null {
  const t = text.trim();
  if (t.split(/\s+/).length > 6 || TIME_WORD.test(t)) return null;
  return toCents(REPLY_PRICE.exec(t)?.[1]);
}
