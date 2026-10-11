// First-name rules: format (a real-looking first name) plus content (no slurs, profanity or fake-official names).

import { scanText } from "../safety/scan";

export const NAME_RETRY = "let's go with a different name 🙂 what should i call you?";

const NAME_PATTERN = /^[a-z][a-z'-]{0,19}$/i;
const LEET: Record<string, string> = { "1": "i", "!": "i", "3": "e", "0": "o", "4": "a", "@": "a", $: "s", "5": "s", "7": "t", q: "g" };

// Substrings (written without doubled letters: they are checked against the repeat-collapsed forms too).
const DENY_SUBSTRINGS = [
  "nigg", "fagg", "fagot", "fuck", "fvck", "phuck", "cunt", "bitch", "whore", "slut", "retard", "rtard", "pusy", "penis", "vagina",
  "blowjob", "handjob", "cumshot", "porno", "pornstar", "twat", "ashole", "bastard", "hitler", "rapist", "shithead", "raghead", "towelhead",
  "jackass", "dumbass", "jizz", "kkk",
];
// Whole names only (short enough to sit inside real names, e.g. "Spicer"); plurals and "-y/-ie" forms count too.
const DENY_EXACT = [
  "spic", "spick", "chink", "kike", "kyke", "coon", "gook", "tranny", "paki", "dyke", "negro", "nigro", "cum", "tit", "ass", "hoe", "jap", "shit",
  "nazi", "pedo", "molester", "wanker", "prick", "fuk", "fck", "biatch", "cuck", "kunt", "pussi", "anus", "nig", "nigr", "nyga",
];
const DENY_EXACT_RE = new RegExp(`^(${DENY_EXACT.join("|")})(s|z|y|ie|ies)?$|^(dick|cock)(s|head|face|wad|sucker)?$`); // "Dickson", "Peacock" are fine
// Impersonation guard, on purpose: "Karl" would confuse the other side (the relay label is the only place it shows).
const FAKE_OFFICIAL = ["karl", "admin", "photon", "buyer", "seller"];
// Collapsed "nigga" family; end-anchored so "Nigam" stays fine.
const NIGGA_END = /(?:niga|nigas|niger|niguh)$/;

/** Format only: first word, letters/'/-, max 20, capitalized. */
export function formatName(raw: string): string | null {
  const word = raw.trim().split(/\s+/)[0];
  if (!word || !NAME_PATTERN.test(word)) return null;
  return word[0]!.toUpperCase() + word.slice(1);
}

/** The name with leetspeak undone, plus stretched forms: all repeats squashed ("niiigga" -> "niga"), and only vowels squashed ("niiiggganth" -> "niggganth"). */
function fold(name: string): string[] {
  const plain = [...name.toLowerCase()].map((c) => LEET[c] ?? c).join("").replace(/[^a-z]/g, "");
  return [plain, plain.replace(/(.)\1+/g, "$1"), plain.replace(/([aeiou])\1+/g, "$1")];
}

/** Content check on an already-formatted name. */
function isClean(name: string): boolean {
  const forms = fold(name);
  if (forms.some((f) => FAKE_OFFICIAL.includes(f) || DENY_EXACT_RE.test(f) || DENY_SUBSTRINGS.some((bad) => f.includes(bad)))) return false;
  if (NIGGA_END.test(forms[1]!)) return false;
  return scanText(name).action !== "block"; // same rules as relayed messages (sync twin of scanRelayMessage)
}

/** "maya chen" -> "Maya"; null when it isn't a first name or isn't an acceptable one. */
export function acceptableName(raw: string): string | null {
  const name = formatName(raw);
  return name && isClean(name) ? name : null;
}

/** Name to show the other person: the stored name if it's acceptable, else the caller's fallback. */
export function displayName(user: { firstName: string | null }, fallback: string): string {
  return (user.firstName && acceptableName(user.firstName)) || fallback;
}
