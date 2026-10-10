// Masked relay between buyer and seller DMs. PLAIN CODE routing, never Gemini. Owner: Nishanth.

import { markdown } from "spectrum-ts";
import { db } from "../db";
import { scanRelayMessage } from "../safety";
import { lastRefTo, sendTo } from "../spectrum/send";
import type { Match, User } from "../types";
import { itemName } from "./format";

export type RelayOutcome = "relayed" | "blocked" | "asked_which" | "not_relay";

const COMMAND = /^(karl\b|cancel\b|help\b|stop\b|my stuff\b|sell\b|looking for\b|search\b)/i;
const YES_NO_START = /^(yes|yeah|yep|yup|ya|sure|ok|no|nah|nope|did|didn't|it did)\b/i;
const QUESTION_REFS = ["checkin", "match_request", "offer", "draft"];
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

  const who = `${sender.firstName ?? (isBuyer ? "buyer" : "seller")} · ${itemName(listing)}`;
  const rendered = `**${escapeMarkdown(who)}**\n${escapeMarkdown(text)}`;
  await sendTo(recipient, markdown(rendered), { ref: { kind: "relay", matchId: match.id }, logText: `**${who}**\n${text}` });
  if (verdict.action === "warn") await sendTo(recipient, verdict.reason ?? "heads up: be careful with that last message");
  return "relayed";
}

/**
 * Decide if a user's text is meant for their counterpart, and if so forward it.
 * Not relayed: no handoff match, text addressed to Karl, or an answer to Karl's own question
 * (a short yes/no, or anything while the meetup is still being picked).
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
    const meetupUnset = matches.some((m) => m.status === "accepted");
    if (SHORT_ANSWER.test(trimmed) || meetupUnset) return "not_relay";
  }

  // A threaded reply must go to ITS match; never guess a different one.
  if (replyToMatchId) {
    const replied = matches.find((m) => m.id === replyToMatchId);
    return replied ? relay(user, replied, text) : "not_relay";
  }
  if (matches.length === 1) return relay(user, matches[0]!, text);

  const titles = await Promise.all(matches.map(async (m) => {
    const listing = await db.getListing(m.listingId);
    return listing ? itemName(listing) : "item";
  }));
  await sendTo(user, `which one, the ${titles.join(" or the ")}? (or reply directly to one of my messages about it)`);
  return "asked_which";
}
