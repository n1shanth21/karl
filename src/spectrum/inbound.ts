// Inbound pipeline. Owner: Nishanth (agent branch).
// identify user → dedupe → opt-out / stop / help → rate limit → tapbacks (instant) →
// debounce text + photos → relay routing, photo → draft, or the agent loop.

import { Emoji, type Content, type Message, type Space } from "spectrum-ts";
import { runAgentTurn } from "../agent/loop";
import { LIMITS } from "../config";
import { db } from "../db";
import { confirmDraft, draftFromPhoto } from "../flows/sell";
import { pickResult } from "../flows/buy";
import { confirmHappened, proposeMatch, respondToMatch } from "../flows/match";
import { routeMessage } from "../flows/relay";
import { allowMessage } from "../safety";
import type { User } from "../types";
import { createBatcher } from "./debounce";
import { lookupRef, type Ref } from "./refs";
import { clearLastRef, last4, lastRefTo, rememberSpace, sendTo } from "./send";

type Image = Extract<Content, { type: "attachment" }>;
// One inbound message, reduced to what the batch needs.
type Part = { space: Space; isNew: boolean; text?: string; image?: Image; matchId?: string };

const INTRO =
  "hey, i'm karl 👋 i help unc students buy and sell stuff over text. send a photo to sell something, or tell me what you're looking for. (what's your first name btw?)";
const HELP = "sell = send me a photo. buy = tell me what you need.\ntext \"my stuff\" to see your listings, or \"stop\" to opt out.";
const GREETING = /^(hi|hey|hello|yo|sup)( karl)?[.!]*$/i;
const YES: string[] = [Emoji.love, Emoji.like];
// A short typed answer to Karl's last question counts like a tapback (no Gemini needed).
const YES_TEXT = /^(y|ya|yes|yea|yeah|yep|yup|sure|ok|okay|sounds good|deal|do it|post it|👍|❤️)(?!\w)/i;
const NO_TEXT = /^(n|no|nah|nope|not really|pass)(?!\w)/i;
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
    return { ...readContent(c.content), matchId: ref && "matchId" in ref ? ref.matchId : undefined };
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
  if (!reply) return;
  await sendTo(user, reply);
  clearLastRef(user.id);
}

/** A short "yes" / "no" typed right after one of Karl's questions is answered like the matching tapback. */
async function answerShortcut(user: User, text: string): Promise<boolean> {
  const words = text.trim().split(/\s+/);
  const yes = YES_TEXT.test(text.trim());
  if (words.length > 4 || (!yes && !NO_TEXT.test(text.trim()))) return false;

  const ref = lastRefTo(user.id);
  if (!ref || ref.kind === "relay") return false;
  // With several results on screen, "yes" is ambiguous: let the agent work out which one.
  if (ref.kind === "result" && user.state.kind === "choosing_result" && user.state.listingIds.length > 1) return false;

  const reply = await answerRef(user, ref, yes);
  if (!reply) return false; // e.g. "no" to a draft: the agent decides what that means
  await sendTo(user, reply);
  clearLastRef(user.id);
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
      return listing ? proposeMatch(user, listing) : null;
    }
    case "match_request":
      return respondToMatch(user, ref.matchId, yes);
    case "checkin":
      return confirmHappened(user, ref.matchId, yes);
    case "relay":
      return null;
  }
}

const enqueue = createBatcher<Part>(() => LIMITS.debounceMs, processBatch);

async function processBatch(userId: string, parts: Part[]): Promise<void> {
  const user = await db.getUser(userId); // reload: state may have changed while we waited
  if (!user || user.optedOut) return;
  const space = parts[parts.length - 1]!.space;
  await orApologize(user, () => space.responding(() => answerBatch(user, parts)));
}

async function answerBatch(user: User, parts: Part[]): Promise<void> {
  const text = parts.map((p) => p.text).filter(Boolean).join("\n");
  const images = parts.flatMap((p) => p.image ?? []);

  if (parts.some((p) => p.isNew)) {
    await sendTo(user, INTRO);
    user = await db.updateUser(user.id, { state: { kind: "idle" } });
    if (!images.length && GREETING.test(text.trim())) return;
  }
  if (images.length) return draftPhoto(user, images, text);
  if (text && (await answerShortcut(user, text))) return;
  if (text) return answerText(user, text, parts.findLast((p) => p.matchId)?.matchId);
  await sendTo(user, "i can only read texts and photos right now");
}

async function draftPhoto(user: User, images: Image[], caption: string): Promise<void> {
  const [photo] = images;
  if (images.length > 1) await sendTo(user, "one item at a time — starting with the first");
  const result = await draftFromPhoto(user, { bytes: await photo!.read(), mimeType: photo!.mimeType }, caption || undefined);
  await sendTo(user, result.reply, result.ok ? { ref: { kind: "draft", listingId: result.listing.id } } : {});
}

async function answerText(user: User, text: string, replyToMatchId?: string): Promise<void> {
  const outcome = await routeMessage(user, text, replyToMatchId);
  if (outcome !== "not_relay") return;
  const reply = await runAgentTurn(user, text);
  if (reply) await sendTo(user, reply);
}
