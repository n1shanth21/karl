// Keyword rules for items Karl refuses to list.
// We check the draft's title + category + description (written by Gemini vision
// from the photo, then maybe edited by the seller). Reasons are in Karl's voice.

import type { ListingDraft, SafetyVerdict } from "../types";

type Category = { name: string; pattern: RegExp; reason: string };

// Normal items that contain a scary word. Removed from the text before matching.
const ALLOWED_PHRASES: RegExp[] = [
  /\b(?:wine|shot|pint|beer) glass(?:es)?\b/g,
  /\bwine (?:rack|opener)\b/g,
  /\bbeer pong(?: table)?\b/g,
  /\bbottle opener\b/g,
  /\b(?:root|ginger) beer\b/g,
  /\brubbing alcohol\b|\balcohol[- ]free\b/g,
  /\b(?:diet coke|coke zero)\b/g,
  /\bweed (?:eater|whacker)\b/g,
  /\bpill (?:organizer|box|case)\b/g,
  /\bprescription (?:glasses|sunglasses)\b/g,
  /\b(?:hot glue|glue|nerf|heat|massage|water|staple) guns?\b/g,
  /\bticket to ride\b/g,
];

const CATEGORIES: Category[] = [
  {
    name: "alcohol",
    pattern:
      /\b(?:beers?|wines?|vodka|liquor|tequila|whiske?y|rum|gin|booze|alcohol|white claw|hard seltzers?|champagne|everclear|kegs?)\b/,
    reason: "i can't list alcohol, sorry! got anything else you want to sell?",
  },
  {
    name: "drugs",
    pattern:
      /\b(?:weed|marijuana|cannabis|thc|delta[- ]?8|edibles?|shrooms|psilocybin|lsd|cocaine|coke|molly|mdma|ketamine|dab pens?|bongs?|thc carts?)\b/,
    reason: "that's not something i can list, sorry. no drugs or paraphernalia on here",
  },
  {
    name: "vapes",
    pattern: /\b(?:vapes?|vaping|juul|elf ?bars?|puff bars?|geek bars?|nicotine|zyn|cigarettes?|cigs|cigars?|hookahs?)\b/,
    reason: "i can't list vapes or nicotine stuff, sorry! anything else you want to sell?",
  },
  {
    name: "meds",
    pattern:
      /\b(?:adderall|xanax|vyvanse|ritalin|oxy|oxycodone|percocet|codeine|prescription|rx|pills?|painkillers?|opioids?|steroids?|ozempic|insulin)\b/,
    reason: "i can't list medications, prescription or not. keeping everyone safe 🙏",
  },
  {
    name: "weapons",
    pattern:
      /\b(?:guns?|firearms?|handguns?|pistols?|rifles?|shotguns?|ammo|ammunition|bullets|glock|ar-?15|tasers?|stun guns?|brass knuckles|switchblades?|butterfly knife|machetes?|nunchucks|bb guns?|airsoft|pellet guns?)\b/,
    reason: "i can't list weapons, sorry. they're not allowed on campus",
  },
  {
    name: "tickets",
    pattern: /\btickets?\b/,
    reason: "unc doesn't allow reselling student tickets, so i can't list those. sorry!",
  },
  {
    name: "digital",
    pattern:
      /\b(?:netflix|spotify|hulu|disney\+?|hbo|max|steam|fortnite|roblox|valorant|chegg|quizlet|course hero)\s+(?:accounts?|acct|logins?|subscriptions?)\b|\b(?:login info|product keys?|license keys?|activation keys?|software licen[cs]es?|passwords?)\b/,
    reason: "i can only list physical stuff, so no accounts, logins, or license keys. sorry!",
  },
  {
    name: "counterfeit",
    pattern: /\b(?:fake ids?|replicas?|counterfeit|knock-?offs?|bootleg|unauthentic|not authentic)\b/,
    reason: "i can't list fakes or replicas, sorry. only the real deal on here",
  },
  {
    name: "adult",
    pattern:
      /\b(?:sex toys?|dildos?|vibrators?|fleshlight|porn|porno|xxx|nudes|nude (?:photos?|pics?|pictures?)|sexually explicit|onlyfans|adult (?:toys?|magazines?|videos?|content)|playboy|used (?:underwear|panties))\b/,
    reason: "i can't list adult stuff, sorry. this is a campus marketplace",
  },
];

/** Returns a block verdict if the draft looks like a prohibited item. */
export function checkItem(draft: ListingDraft): SafetyVerdict {
  let text = `${draft.title} ${draft.category} ${draft.description}`.toLowerCase();
  for (const phrase of ALLOWED_PHRASES) {
    text = text.replace(phrase, " ");
  }
  for (const category of CATEGORIES) {
    if (category.pattern.test(text)) return { action: "block", reason: category.reason };
  }
  return { action: "allow" };
}
