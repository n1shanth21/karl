// Masked relay between buyer and seller DMs. PLAIN CODE routing, never Gemini. Owner: Nishanth.

import { markdown } from "spectrum-ts";
import { gemini } from "../agent/gemini";
import { db } from "../db";
import { scanRelayMessage } from "../safety";
import { lastRefTo, sendTo } from "../spectrum/send";
import type { Match, User } from "../types";
import { dealIntent } from "./dealintent";
import { disputeState } from "./dispute";
import { itemName, parseOfferCents } from "./format";
import { displayName } from "./names";
import { cancelMatch, completeDeal, confirmHappened, loadMatch } from "./match";
import { counterOffer, repriceAsker } from "./offers";

/** "handled" = the text ended the deal (done / off); it was dealt with here and is not forwarded. */
export type RelayOutcome = "relayed" | "blocked" | "asked_which" | "not_relay" | "handled";

export const COMMAND = /^(karl\b|cancel\b|help\b|stop\b|my stuff\b|sell\b|looking for\b|search\b)/i;
const YES_NO_START = /^(yes|yeah|yep|yup|ya|sure|ok|no|nah|nope|did|didn't|it did)\b/i;
const QUESTION_REFS = ["checkin", "match_request", "offer", "draft", "counter", "availability", "meetup_slot", "dispute"];
const SHORT_ANSWER = /^(y|yes|yep|yeah|yup|n|no|nope|ok|okay|sure|👍|👎|❤️|👌)[.!\s]*$/i;

/** Backslash-escape CommonMark specials so the renderer shows the text exactly as typed. */
export const escapeMarkdown = (text: string) => text.replace(/[\\`*_{}[\]()#+\-.!|~>]/g, "\\$&");

/** Karl's last message to this user was his own question (relayed messages start with "**"). */
async function karlAskedQuestion(user: User): Promise<boolean> {
  const sent = (await db.recentMessages(user.id, 10)).filter((m) => m.direction === "out");
  const last = sent.at(-1)?.text ?? "";
  return last.includes("?") && !last.startsWith("**");
}

/** Forward the sender's exact words to the other side, labeled in bold. */
async function relay(sender: User, match: Match, text: string): Promise<"relayed" | "blocked"> {
  const verdict = await scanRelayMessage(text);
  if (verdict.action === "block") {
    await sendTo(sender, verdict.reason ?? "i didn't pass that along, it looked unsafe");
    return "blocked";
  }
  const isBuyer = sender.id === match.buyerId;
  const [listing, recipient] = await Promise.all([
    db.getListing(match.listingId),
    db.getUser(isBuyer ? match.sellerId : match.buyerId),
  ]);
  if (!listing || !recipient) throw new Error(`match ${match.id} is missing its listing or other user`);

  const who = `${displayName(sender, isBuyer ? "buyer" : "seller")} · ${itemName(listing)}`;
  const rendered = `**${escapeMarkdown(who)}**\n${escapeMarkdown(text)}`;
  await sendTo(recipient, markdown(rendered), { ref: { kind: "relay", matchId: match.id }, logText: `**${who}**\n${text}` });
  if (verdict.action === "warn") await sendTo(recipient, verdict.reason ?? "heads up: be careful with that last message");
  await hintOnce(sender, match, isBuyer ? "seller" : "buyer");
  return "relayed";
}

/** The first time Karl forwards someone's words in a match, tell them how to reach Karl instead (once, even across restarts). */
async function hintOnce(sender: User, match: Match, to: "buyer" | "seller"): Promise<void> {
  const seen = await db.findEvents("relay_hint", { userId: sender.id, payload: { matchId: match.id }, limit: 1 });
  if (seen.length) return;
  await db.logEvent("relay_hint", { userId: sender.id, payload: { matchId: match.id } });
  await sendTo(sender, `(i forward messages to the ${to} and 👍 them. say 'karl' or 'ask him…' to talk to me)`);
}

/** "sale is done": count it for the sender and ask the other side to confirm (their 👍 completes the sale). */
async function markDone(sender: User, match: Match, item: string): Promise<"handled"> {
  const dispute = await disputeState(match.id);
  const ctx = dispute && dispute.phase !== "resolved" ? await loadMatch(match.id, sender.id) : null;
  if (ctx && dispute?.phase === "disagreed") {
    await sendTo(sender, await completeDeal(ctx, sender)); // "sold" settles a disagreement either way
    return "handled";
  }
  if (ctx && dispute?.userId !== sender.id) { // the claimer again, while the other side is still being asked
    await sendTo(sender, "still waiting on them, i asked them to double check");
    return "handled";
  }
  const reply = await confirmHappened(sender, match.id, true);
  if ((await db.getMatch(match.id))?.status === "completed") {
    await sendTo(sender, reply);
    return "handled";
  }
  const isBuyer = sender.id === match.buyerId;
  const other = await db.getUser(isBuyer ? match.sellerId : match.buyerId);
  if (other) {
    const name = displayName(sender, isBuyer ? "the buyer" : "the seller");
    const ask = isBuyer ? "did it sell?" : "did you get it?";
    await sendTo(other, `${name} says the ${item} deal is done. ${ask} (👍 or 👎)`, { ref: { kind: "checkin", matchId: match.id } });
  }
  await sendTo(sender, `nice, marking it done once ${displayName(other ?? { firstName: null }, `the ${isBuyer ? "seller" : "buyer"}`)} confirms`);
  return "handled";
}

/** "deal's off": cancel the match (listing back up, other side told kindly). */
async function callOff(sender: User, match: Match, item: string): Promise<"handled"> {
  await cancelMatch(sender, match.id);
  await sendTo(sender, sender.id === match.buyerId ? `got it, called off the ${item} deal. i'll keep looking` : `got it, called off the ${item} deal. it's back up`);
  return "handled";
}

// Mid-deal text that is obviously for the other person never needs the classifier: short, a greeting/ack, or not about the
// counterpart at all (text only belongs to Karl when it talks about "him/her/them", the name, or Karl).
const CHAT_START = /^(hi|hey|hello|omw|otw|ok|okay|k|lol|lmao|yeah|yea|yep|haha|thanks|thank|thx|cool|sure|perfect|sounds)\b/i;
const obviousChat = (text: string, counterpartName: string) =>
  text.trim().split(/\s+/).length <= 4 ||
  CHAT_START.test(text.trim()) ||
  !new RegExp(String.raw`\b(?:he|she|they|him|her|them|his|their|karl|the (?:seller|buyer)|${counterpartName.toLowerCase().replace(/[^a-z]/g, "") || "$^"})\b`, "i").test(text);

/** Longer text that isn't obviously chat: ask Gemini once who it's for. Any failure means "the other person" (the old behavior). */
async function forKarl(text: string, ctx: { item: string; counterpartName: string; role: "buyer" | "seller" }): Promise<boolean> {
  if (obviousChat(text, ctx.counterpartName)) return false;
  try {
    const { to } = await gemini.classifyDealMessage(text, ctx);
    console.log(`[route] classifier says "${to}" for a ${ctx.role}'s mid-deal text`);
    return to === "karl";
  } catch (err) {
    console.warn(`[route] classifier failed, relaying: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** "ask him for 55": a price ask in a third-person instruction is a price change (counter or renegotiation). "tell him i'm outside" is passed on as-is; the rest ("ask him if...") is for the agent. */
const MONEY = /\b(?:tell|text|message|offer)\s+\S+\s+(?:i(?:'ll| will| can)?\s+(?:do|offer)\s+)?\$?(\d{1,4}(?:\.\d{1,2})?)(?=\s*(?:$|[?!.,]|(?:instead|then|though|tho|pls|please|bucks|dollars)\b))/i;
const PURE_FORWARD = /^(?:(?:hey|ok|pls|please|karl)[,\s]+)*(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:tell\s+\S+|let\s+\S+\s+know)[,\s]+(?:that\s+)?(\S.*)$/i;
async function instruct(user: User, match: Match, text: string): Promise<RelayOutcome> {
  const money = MONEY.exec(text)?.[1];
  const cents = parseOfferCents(text) ?? (money ? Math.round(Number(money) * 100) : null);
  const listing = cents ? await db.getListing(match.listingId) : null;
  if (cents && listing && (cents !== listing.priceCents || repriceAsker(match.id))) {
    const reply = await counterOffer(user, match.id, cents, true);
    if (reply) await sendTo(user, reply);
    return "handled";
  }
  const forward = PURE_FORWARD.exec(text.trim())?.[1];
  return forward ? relay(user, match, forward) : "not_relay";
}

/** Tool for the agent: pass a message to the other side of a deal, in Karl's own words (same safety scan and label as a relay). */
export async function messageCounterpart(user: User, matchId: string, text: string): Promise<{ sent: boolean; reason?: string }> {
  const match = await db.getMatch(matchId);
  if (!match || (match.buyerId !== user.id && match.sellerId !== user.id)) return { sent: false, reason: "no such deal" };
  if (match.status !== "accepted" && match.status !== "meetup_set") return { sent: false, reason: "the seller hasn't accepted yet, so there's nobody to pass messages to" };
  const outcome = await relay(user, match, text);
  return outcome === "relayed" ? { sent: true } : { sent: false, reason: "blocked by the safety scan; the user was already told" };
}

/** Read the text for deal intent first: new requests and "karl" go to the agent, done/off close the deal, the rest is chat to forward. */
async function routeToMatch(user: User, match: Match, text: string): Promise<RelayOutcome> {
  const isBuyer = user.id === match.buyerId;
  const [listing, other] = await Promise.all([db.getListing(match.listingId), db.getUser(isBuyer ? match.sellerId : match.buyerId)]);
  const sold = /^sold[.!\s]*$/i.test(text.trim()) && (await disputeState(match.id))?.phase === "disagreed"; // the word Karl asked them to text
  const intent = sold ? "done" : dealIntent(text, listing?.title, other?.firstName ?? undefined);
  if (intent === "new_request" || intent === "to_karl") return "not_relay";
  if (intent === "done" && listing) return markDone(user, match, itemName(listing));
  if (intent === "off" && listing) return callOff(user, match, itemName(listing));
  if (intent === "instruct") return instruct(user, match, text);
  if (intent === null && listing && other && (await forKarl(text, { item: itemName(listing), counterpartName: displayName(other, isBuyer ? "the seller" : "the buyer"), role: isBuyer ? "buyer" : "seller" }))) return "not_relay";
  return relay(user, match, text);
}

/**
 * Decide if a user's text is meant for their counterpart, and if so forward it.
 * Not relayed: no handoff match, text addressed to Karl, or an answer to Karl's own question
 * (a short yes/no answer to Karl's pending question).
 * Relayed to: the replied-to match (not_relay if that isn't an active handoff), else the only handoff match; with 2+ and no reply target, ask which.
 */
export async function routeMessage(user: User, text: string, replyToMatchId?: string): Promise<RelayOutcome> {
  const all = await db.activeMatchesForUser(user.id);
  const matches = all.filter((m) => m.status === "accepted" || m.status === "meetup_set");
  const trimmed = text.trim();
  if (matches.length === 0 || COMMAND.test(trimmed)) return "not_relay";

  // Answering a question Karl just asked ("did it happen?", "ok to hold?") is for Karl, not the counterpart.
  const lastRef = lastRefTo(user.id);
  if (lastRef && QUESTION_REFS.includes(lastRef.kind) && (YES_NO_START.test(trimmed) || SHORT_ANSWER.test(trimmed))) return "not_relay";
  if (await karlAskedQuestion(user)) {
    // Meetup times are claimed earlier by the scheduler (inbound answerScheduling), so anything left here is chat.
    if (SHORT_ANSWER.test(trimmed)) return "not_relay";
  }

  // A threaded reply must go to ITS match; never guess a different one.
  if (replyToMatchId) {
    const replied = matches.find((m) => m.id === replyToMatchId);
    return replied ? routeToMatch(user, replied, text) : "not_relay";
  }
  if (matches.length === 1) return routeToMatch(user, matches[0]!, text);
  const loose = dealIntent(text);
  if (loose === "new_request" || loose === "to_karl" || loose === "done" || loose === "off" || loose === "instruct") return "not_relay"; // the agent asks which deal

  const titles = await Promise.all(matches.map(async (m) => {
    const listing = await db.getListing(m.listingId);
    return listing ? itemName(listing) : "item";
  }));
  await sendTo(user, `which one, the ${titles.join(" or the ")}? (or reply directly to one of my messages about it)`);
  return "asked_which";
}
