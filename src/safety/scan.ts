// Regex rules for scanning relayed messages (buyer <-> seller).
// Block rules run first, then warn rules. Anything else is allowed.
// Reasons are shown to the user, so they're written in Karl's voice.

import type { SafetyVerdict } from "../types";

type Rule = { name: string; pattern: RegExp; reason: string };

const CONTACT_REASON =
  "i didn't pass that along, it looks like contact info. i keep everyone's number and socials private, so let's keep chatting through me 🙂";

const BLOCK_RULES: Rule[] = [
  {
    name: "phone",
    // 10 digits like 919-555-1234, (919) 555 1234, +1 919.555.1234, 9195551234
    pattern: /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/,
    reason: CONTACT_REASON,
  },
  {
    name: "phone_short",
    // 7 digits with a separator, like 555-1234
    pattern: /\b\d{3}[\s.-]\d{4}\b/,
    reason: CONTACT_REASON,
  },
  {
    name: "email",
    pattern: /[\w.+-]+@[\w-]+\.[a-z]{2,}/i,
    reason: CONTACT_REASON,
  },
  {
    name: "handle",
    // "@maya.k" (but not "meet @ the pit")
    pattern: /(?:^|\s)@[a-z0-9_.]{2,}/i,
    reason: CONTACT_REASON,
  },
  {
    name: "social",
    pattern:
      /\b(?:my|add me on|follow me on|hmu on|find me on)\s+(?:insta|instagram|ig|snap|snapchat|sc|twitter|x|tiktok|discord|facebook|fb)\b/i,
    reason: CONTACT_REASON,
  },
  {
    name: "url",
    pattern: /https?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|me|ly|gg|app|xyz|link|info|biz)\b/i,
    reason: "i don't pass along links, sorry! scammers love them. describe it in words and i'll send that over",
  },
  {
    name: "gift_card",
    pattern: /\bgift\s?cards?\b|\b(?:itunes|apple|google play|steam|amazon|visa)\s+(?:gift\s+)?cards?\b/i,
    reason: "i blocked that one. anyone asking for gift cards is almost always a scam, so pay in person with cash or venmo once you have the item",
  },
  {
    name: "wire_crypto",
    pattern:
      /\bwire\s+(?:transfer|me|the money|it)\b|\bwestern union\b|\bmoneygram\b|\bbitcoin\b|\bbtc\b|\bcrypto\b|\bethereum\b|\busdt\b|\bdogecoin\b/i,
    reason: "i blocked that one. wire transfers and crypto are a classic scam move. just pay in person once you've got the item",
  },
];

const WARN_RULES: Rule[] = [
  {
    name: "pay_first",
    pattern:
      /\b(?:pay|payment|venmo|zelle|cash\s?app|paypal)\b[^.?!]{0,30}\b(?:first|upfront|up front|in advance|right now|asap|before (?:we|i|you) meet)\b|\b(?:pay|venmo|zelle|cash\s?app|paypal) me now\b/i,
    reason: "heads up: only pay once you actually have the item in your hands. i'd skip paying ahead of time",
  },
  {
    name: "deposit",
    pattern: /\bdeposit\b|\bsend half\b|\bhalf (?:upfront|up front|now|first)\b/i,
    reason: "heads up: deposits aren't a thing here. pay the full amount in person when you get the item",
  },
  {
    name: "pressure",
    pattern: /\bonly today\b|\btoday only\b|\blast chance\b|\bact fast\b|\bbefore someone else\b|\bnow or never\b/i,
    reason: "just a heads up, no need to rush. if it feels like pressure, it's totally ok to take your time",
  },
  {
    name: "off_platform",
    pattern: /\bwhatsapp\b|\btelegram\b|\bwechat\b|\bkik\b|\bsignal app\b|\btext me on\b|\bdm me\b/i,
    reason: "heads up: i'd keep the convo here with me. moving to other apps is how a lot of scams start",
  },
];

/** Check a relayed message against the rules. Block wins over warn. */
export function scanText(text: string): SafetyVerdict {
  for (const rule of BLOCK_RULES) {
    if (rule.pattern.test(text)) return { action: "block", reason: rule.reason };
  }
  for (const rule of WARN_RULES) {
    if (rule.pattern.test(text)) return { action: "warn", reason: rule.reason };
  }
  return { action: "allow" };
}
