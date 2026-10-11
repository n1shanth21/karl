// Inbound pipeline. Owner: Nishanth (agent branch).
// identify user → dedupe → opt-out / stop / help → rate limit → tapbacks (instant) →
// debounce text + photos → relay routing, photo → draft, or the agent loop.

import { Emoji, type Content, type Message, type Space } from "spectrum-ts";
import { runAgentTurn } from "../agent/loop";
import { cleanFirstName } from "../agent/tools";
import { LIMITS } from "../config";
import { db } from "../db";
import { confirmDraft, draftFromPhoto, removeListing } from "../flows/sell";
import { cancelWant, pickResult } from "../flows/buy";
import { parseOfferCents, parsePriceCents } from "../flows/format";
import { confirmHappened, endDealsForBannedUser, proposeMatch } from "../flows/match";
import { answerBid, counterOffer, makeOffer, respondToOffer } from "../flows/offers";
import { COMMAND, routeMessage } from "../flows/relay";
import { awaitingRef, onAvailability, onSlotVote, schedulingOpen, takeFollowUp } from "../flows/scheduling";
import { markStillActive } from "../flows/staleness";
import { allowMessage, checkImage, isBanned } from "../safety";
import type { User } from "../types";
import { createBatcher } from "./debounce";
import { lookupRef, type Ref } from "./refs";
import { clearLastRef, last4, lastRefTo, rememberSpace, sendTo } from "./send";

type Image = Extract<Content, { type: "attachment" }>;
// One inbound message, reduced to what the batch needs.
type Part = { space: Space; isNew: boolean; text?: string; image?: Image; matchId?: string; ref?: Ref };

const INTRO =
  "hey, i'm karl 👋 i help unc students buy and sell stuff over text. send a photo to sell something, or tell me what you're looking for. (what's your first name btw?)";
const HELP = "sell = send me a photo. buy = tell me what you need.\ntext \"my stuff\" to see your listings, or \"stop\" to opt out.";
const GREETING = /^(hi|hey|hello|yo|sup)( karl)?[.!]*$/i;
const YES: string[] = [Emoji.love, Emoji.like];
// A short typed answer to Karl's last question counts like a tapback (no Gemini needed).
const YES_TEXT = /^(y|ya|yes|yea|yeah|yep|yup|sure|ok|okay|sounds good|deal|do it|post it|👍|❤️)(?!\w)/i;
const NO_TEXT = /^(n|no|nah|nope|not really|pass)(?!\w)/i;
// Right after "still selling / still looking?", these also mean no.
const GONE_TEXT = /\b(sold|gone|found one|got one|bought one|don'?t need|no longer|not anymore|never ?mind|nvm)\b/i;
// "not sold yet", "haven't sold it", "nobody bought one yet" mention a gone-word but mean the opposite (still active).
const GONE_PHRASES = /don'?t need|no longer|not anymore|never ?mind/gi;
const NEGATED = /\b(not|never|nobody|no ?one|still|yet|hav?en['’]?t|hasn['’]?t|didn['’]?t|wasn['’]?t)\b/i;
// Words that are never a first name (greetings, yes/no, commands, filler, request words, common items).
const NOT_NAMES = new Set(
  (
    "hi hey hello yo sup hiya howdy karl yes no yeah yep yup nah nope sure ok okay k y n pass " +
    "help stop start cancel sell buy list thanks thank thx ty lol lmao haha cool nothing idk none nvm maybe please sorry " +
    "good fine great here new back not just there what why how who where when need want looking selling buying have got " +
    "interested a an the i me my you it its is am are do can any anyone someone something lamp fridge desk chair couch " +
    "bike book books textbook textbooks tv monitor laptop microwave furniture stuff"
  ).split(" "),
);
const NAME_INTRO = /^(?:i['’]?m|i am|it['’]?s|my name is|my name['’]s|call me|this is)\s+(.+)$/i;

/** Is `text` a reply to "what's your first name?" Returns the name plus any request that came with it ("i'm maya, need a lamp"). */
/** Only treat a reply as a name right after Karl asked for one (so "omw" mid-deal never becomes a name). */
async function karlAskedForName(userId: string): Promise<boolean> {
  const lastOut = (await db.recentMessages(userId, 6)).findLast((m) => m.direction === "out");
  return !!lastOut && /first name/i.test(lastOut.text);
}

export function parseNameReply(text: string): { name: string; rest: string } | null {
  const trimmed = text.trim();
  const intro = NAME_INTRO.exec(trimmed);
  const [head = "", ...tail] = (intro ? intro[1]! : trimmed).split(/[,;.!?\n]+/);
  const rest = intro ? tail.join(" ").trim() : "";
  if (!intro && tail.some((t) => t.trim())) return null; // bare "name, more text" is a request, not a name
  const words = head.trim().split(/\s+/);
  if (words.length > 2 || words.some((w) => NOT_NAMES.has(w.toLowerCase().replace(/[’]/g, "'")))) return null;
  // Two words with no "i'm" in front must look like a full name: "Maya Chen".
  if (words.length === 2 && !intro && !words.every((w) => /^[A-Z]/.test(w))) return null;
  const name = cleanFirstName(words[0]!.replace(/[’]/g, "'"));
  return name ? { name, rest } : null;
}

// Only these inbound events are real messages; read receipts, typing, edits, polls etc. are ignored.
const MESSAGE_TYPES = ["text", "attachment", "reply", "reaction", "voice"];

function describe(c: Content): string {
  if (c.type === "text") return c.text;
  if (c.type === "attachment") return `[attachment: ${c.mimeType}]`;
  if (c.type === "reply") return describe(c.content);
  return `[${c.type}]`;
}

/** The text or photo in a message (anything else reads as empty); a threaded reply also carries the match it answers. */
function readContent(c: Content): Omit<Part, "space" | "isNew"> {
  if (c.type === "text") return { text: c.text };
  if (c.type === "attachment") return c.mimeType.startsWith("image/") ? { image: c } : {};
  if (c.type === "reply") {
    const ref = lookupRef(c.target.id);
    return { ...readContent(c.content), ref, matchId: ref && "matchId" in ref ? ref.matchId : undefined };
  }
  return {};
}

// Concurrent first messages from one new phone (photo + caption) must share one createUser.
const signingUp = new Map<string, Promise<User>>();

/** The user for this phone, creating them on first contact. `isNew` is true for exactly one caller. */
async function getOrCreateUser(phone: string, spaceId: string): Promise<{ user: User; isNew: boolean }> {
  const inFlight = signingUp.get(phone);
  if (inFlight) return { user: await inFlight, isNew: false };

  let isNew = false;
  const lookup = (async () => {
    const existing = await db.getUserByPhone(phone);
    if (existing) return existing;
    isNew = true;
    return db.createUser({ phone, spaceId });
  })();
  signingUp.set(phone, lookup);
  try {
    return { user: await lookup, isNew };
  } finally {
    signingUp.delete(phone);
  }
}

/** Run work; if it throws, log it and tell the user (never crash the message loop). */
async function orApologize(user: User, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (err) {
    console.error(`[karl] inbound failed for ${last4(user.phone)}`, err);
    await sendTo(user, "ugh, something broke on my end. try again in a sec?").catch(() => {});
  }
}

export async function handleInbound(space: Space, message: Message): Promise<void> {
  if (message.direction === "outbound") return;
  const phone = message.sender?.id;
  if (!phone) return;
  const content = message.content;
  if (!MESSAGE_TYPES.includes(content.type)) return; // read receipt, typing, edit, poll vote, ...

  rememberSpace(space);
  const found = await getOrCreateUser(phone, space.id);
  let user = found.user;
  if (user.spaceId !== space.id) user = await db.updateUser(user.id, { spaceId: space.id });
  if (isBanned(user.id)) {
    console.log(`[karl] banned ${last4(phone)}`); // no reply, nothing saved, "start" can't undo it
    return;
  }

  const isNew = await db.saveInbound({ userId: user.id, text: describe(content), platformMessageId: message.id });
  if (!isNew) return; // duplicate delivery
  console.log(`[in ${last4(phone)}] ${describe(content)}`);
  Promise.resolve().then(() => message.read()).catch(() => {}); // read receipt, fire-and-forget

  const command = content.type === "text" ? content.text.trim().toLowerCase() : "";
  if (user.optedOut) {
    if (command !== "start") return;
    user = await db.updateUser(user.id, { optedOut: false });
    await sendTo(user, "welcome back! send a photo to sell or tell me what you need.");
    return;
  }
  if (command === "stop") {
    await sendTo(user, "got it, you won't hear from me again. text start anytime");
    await db.updateUser(user.id, { optedOut: true });
    return;
  }
  if (command === "help") {
    await sendTo(user, HELP);
    return;
  }
  if (!allowMessage(user.id)) {
    console.log(`[karl] rate limited ${last4(phone)}`);
    return;
  }

  if (content.type === "reaction") {
    const { emoji, target } = content;
    await orApologize(user, () => handleTapback(user, lookupRef(target.id), emoji));
    return;
  }
  await enqueue(user.id, { space, isNew: found.isNew, ...readContent(content) });
}

/** ❤️/👍 = yes, 👎 = no, on a message Karl sent. Anything else is ignored. */
async function handleTapback(user: User, ref: Ref | undefined, emoji: string): Promise<void> {
  if (!ref || (!YES.includes(emoji) && emoji !== Emoji.dislike)) return;
  const yes = YES.includes(emoji);
  const reply = await answerRef(user, ref, yes);
  if (reply) await deliver(user, ref, yes, reply);
}

/** Send Karl's reply. `keep` (or a scheduling follow-up question) re-tags it so the next answer finds the same question. */
async function sendReply(user: User, reply: string, keep?: Ref): Promise<void> {
  const ref = keep ?? takeFollowUp(user.id);
  await sendTo(user, reply, ref ? { ref } : {});
  if (!ref) clearLastRef(user.id);
}

/** Send the reply to an answered question. A "yes" to a spread offer only asks for a price, so that question stays open. */
async function deliver(user: User, ref: Ref, yes: boolean, reply: string): Promise<void> {
  await sendReply(user, reply, ref.kind === "offer" && ref.spread && yes ? ref : undefined);
}

/**
 * Plain-code haggling (no Gemini): a bare price after a request/counter is a counter-offer; "offer 10" or
 * "can you ask the seller for $10 instead?" after a single result/offer is a buyer offer.
 */
async function answerPrice(user: User, text: string): Promise<boolean> {
  const ref = lastRefTo(user.id);
  if (!ref) return false;
  let reply: string | null = null;
  if (ref.kind === "bid") {
    const cents = parsePriceCents(text); // seller names a price for the buyer who bid lower
    reply = cents === null ? null : await answerBid(user, ref, { priceCents: cents });
  } else if (ref.kind === "match_request" || ref.kind === "counter") {
    const cents = parsePriceCents(text);
    reply = cents === null ? null : await counterOffer(user, ref.matchId, cents);
  } else if (ref.kind === "offer" || (ref.kind === "result" && user.state.kind === "choosing_result" && user.state.listingIds.length <= 1)) {
    const cents = (ref.kind === "offer" && ref.spread ? parsePriceCents(text) : null) ?? parseOfferCents(text); // spread: a bare "20" is the price
    const listing = cents === null ? null : await db.getListing(ref.listingId);
    reply = listing && cents! < listing.priceCents ? await makeOffer(user, listing, cents!) : null; // free text never becomes a full-price request
  }
  if (reply === null) return false;
  if (reply) await sendReply(user, reply); // "" = a capped counter already re-asked the question (with its own ref)
  return true;
}

/** A short "yes" / "no" typed right after one of Karl's questions is answered like the matching tapback. */
async function answerShortcut(user: User, text: string): Promise<boolean> {
  const words = text.trim().split(/\s+/);
  const ref = lastRefTo(user.id);
  if (ref?.kind === "still_active" && words.length <= 8 && GONE_TEXT.test(text) && !(await db.activeMatchesForUser(user.id)).length) {
    return answerNow(user, ref, NEGATED.test(text.replace(GONE_PHRASES, ""))); // negated = they still have it / still want it
  }
  const yes = YES_TEXT.test(text.trim());
  if (words.length > 4 || (!yes && !NO_TEXT.test(text.trim()))) return false;

  if (!ref || ref.kind === "relay") return false;
  if ((ref.kind === "meetup_slot" || ref.kind === "availability") && !(await schedulingOpen(ref.matchId, ref))) return false; // a stale scheduling question
  // With several results on screen, "yes" is ambiguous: let the agent work out which one.
  if (ref.kind === "result" && user.state.kind === "choosing_result" && user.state.listingIds.length > 1) return false;

  return answerNow(user, ref, yes);
}

const BURIED_BY = ["relay", "match_request", "counter"]; // answered or chatty refs that shouldn't hide an owed availability
/**
 * "When are you free?" and "the Pit tmr 2pm? 👍/👎" are answered here in plain code (never relayed, never Gemini).
 * After "when are you free?" ANY text is their availability; after a proposal, yes/no votes and a NEW time/spot replaces
 * their availability. With no such question in front of them (a relay buried it) a chatty text still falls through.
 */
async function answerScheduling(user: User, text: string, threaded?: Ref): Promise<boolean> {
  const t = text.trim();
  const asked = (r?: Ref) => (r?.kind === "availability" || r?.kind === "meetup_slot" ? r : undefined);
  const last = lastRefTo(user.id);
  const direct = asked(threaded) ?? asked(last);
  const ref = direct ?? asked(!last || BURIED_BY.includes(last.kind) ? await awaitingRef(user.id) : undefined);
  if (!ref || COMMAND.test(t) || !(await schedulingOpen(ref.matchId, ref))) return false; // locked/expired: it's chat, relay it

  if (ref.kind === "meetup_slot" && t.split(/\s+/).length <= 2 && (YES_TEXT.test(t) || NO_TEXT.test(t))) {
    return answerNow(user, ref, YES_TEXT.test(t));
  }
  const reply = await onAvailability(user, ref.matchId, t, !(direct?.kind === "availability")); // soft unless they were just asked
  if (reply === null) return false;
  await sendReply(user, reply);
  return true;
}

/** Answer a pending question and send the reply. False when the agent should decide (e.g. "no" to a draft). */
async function answerNow(user: User, ref: Ref, yes: boolean): Promise<boolean> {
  const reply = await answerRef(user, ref, yes);
  if (!reply) return false;
  await deliver(user, ref, yes, reply);
  return true;
}

async function answerRef(user: User, ref: Ref, yes: boolean): Promise<string | null> {
  switch (ref.kind) {
    case "draft": {
      if (!yes) return null;
      const result = await confirmDraft(user, ref.listingId);
      return result.ok ? "it's live! i'll text you when someone bites" : result.reason;
    }
    case "result":
      return yes ? pickResult(user, { listingId: ref.listingId }) : null;
    case "offer": {
      const listing = yes ? await db.getListing(ref.listingId) : null;
      if (listing && ref.spread) return "what price should i offer them? just reply with a number"; // never a full-price request
      return listing ? proposeMatch(user, listing) : null; // proposeMatch marks the pinged want matched
    }
    case "match_request":
    case "counter":
      return respondToOffer(user, ref.matchId, yes);
    case "checkin":
      return confirmHappened(user, ref.matchId, yes);
    case "relay":
      return null;
    case "availability": // a tapback on "when are you free?" means nothing; the typed answer is handled in answerScheduling
      return null;
    case "meetup_slot":
      return onSlotVote(user, ref.matchId, yes, ref);
    case "bid": // a seller's yes/no to "someone wants one around $15" (a price is handled in answerPrice)
      return answerBid(user, ref, { yes });
    case "still_active": {
      const { listingId, wantId } = ref;
      if (yes) {
        await markStillActive(user.id, { listingId, wantId });
        return listingId ? "cool, it's still up" : "cool, still looking for you";
      }
      if (listingId) await removeListing(user, listingId);
      else if (wantId) await cancelWant(user, wantId);
      return listingId ? "got it, took it down" : "got it, stopped looking";
    }
  }
}

const enqueue = createBatcher<Part>(() => LIMITS.debounceMs, processBatch);

async function processBatch(userId: string, parts: Part[]): Promise<void> {
  const user = await db.getUser(userId); // reload: state may have changed while we waited
  if (!user || user.optedOut || isBanned(user.id)) return; // a ban can land while the batch waits
  const space = parts[parts.length - 1]!.space;
  await orApologize(user, () => space.responding(() => answerBatch(user, parts)));
}

async function answerBatch(user: User, parts: Part[]): Promise<void> {
  takeFollowUp(user.id); // drop any leftover from an earlier turn
  const text = parts.map((p) => p.text).filter(Boolean).join("\n");
  const images = parts.flatMap((p) => p.image ?? []);

  if (parts.some((p) => p.isNew)) {
    await sendTo(user, INTRO);
    user = await db.updateUser(user.id, { state: { kind: "idle" } });
    if (!images.length && GREETING.test(text.trim())) return;
  }
  if (images.length) return draftPhoto(user, images, text);
  if (text && !user.firstName && !parts.some((p) => p.isNew) && (await karlAskedForName(user.id))) {
    const named = parseNameReply(text); // plain code: no Gemini needed for the common "Aayush" reply
    if (named) {
      user = await db.updateUser(user.id, { firstName: named.name });
      if (!named.rest) {
        await sendTo(user, `nice to meet you, ${named.name}! send me a photo to sell something, or tell me what you're looking for`);
        return;
      }
    }
  }
  if (text && (await answerPrice(user, text))) return;
  if (text && (await answerScheduling(user, text, parts.findLast((p) => p.ref)?.ref))) return;
  if (text && (await answerShortcut(user, text))) return;
  if (text) return answerText(user, text, parts.findLast((p) => p.matchId)?.matchId);
  await sendTo(user, "i can only read texts and photos right now");
}

/** "Selling this for 8 dollars" often comes BEFORE the photo. With no caption, reuse that text (last 15 min)
 *  so the seller's own price wins over Gemini's guess. */
async function recentSellText(userId: string): Promise<string | undefined> {
  const since = Date.now() - 15 * 60_000;
  const recent = (await db.recentMessages(userId, 10)).filter((m) => m.direction === "in" && m.createdAt.getTime() >= since);
  return recent
    .reverse()
    .find((m) => /\b(sell|selling|list|listing|post)\b/i.test(m.text) && /\$\s?\d|\d+\s*(bucks|dollars)\b|\bfor\s+\d+/i.test(m.text))?.text;
}

async function draftPhoto(user: User, images: Image[], caption: string): Promise<void> {
  const [photo] = images;
  if (images.length > 1) await sendTo(user, "one item at a time — starting with the first");
  const bytes = await photo!.read();
  // Safety first: before HEIC conversion, saving the photo or any vision call.
  const verdict = await checkImage(bytes, photo!.mimeType, user.id);
  if (verdict.action === "block") {
    await sendTo(user, verdict.reason ?? "can't use that photo, send one of just the item");
    if (verdict.banned) await endDealsForBannedUser(user.id);
    return;
  }
  const result = await draftFromPhoto(user, { bytes, mimeType: photo!.mimeType }, caption || (await recentSellText(user.id)));
  await sendTo(user, result.reply, result.ok ? { ref: { kind: "draft", listingId: result.listing.id } } : {});
}

async function answerText(user: User, text: string, replyToMatchId?: string): Promise<void> {
  const outcome = await routeMessage(user, text, replyToMatchId);
  if (outcome !== "not_relay") return;
  const reply = await runAgentTurn(user, text);
  const followUp = takeFollowUp(user.id); // the agent's tool may have asked a scheduling question
  if (reply) await sendTo(user, reply, followUp ? { ref: followUp } : {});
}
