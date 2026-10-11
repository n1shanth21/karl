// Price negotiation before a deal: buyer offer → seller yes/no/counter → ping-pong → accept at the agreed price.
// Karl relays each side's price through their own DM (no group chats). Owner: Nishanth.

import { midpointCents, reopenOfferedWant } from "../agent/notifications";
import { db } from "../db";
import { sendTo } from "../spectrum/send";
import type { Listing, User } from "../types";
import { dollars, itemName } from "./format";
import { displayName } from "./names";
import { holdAtPrice } from "./holds";
import { acceptMatch, loadMatch, openMatch, proposeMatch, respondToMatch, type Ctx } from "./match";

export const MAX_COUNTERS = 4;
const NO_MATCH = "i can't find that one. text 'my stuff' to see what's active";

/** The price on the table for a still-undecided match: who named it and how many counters so far. */
type Pending = { cents: number; from: "buyer" | "seller"; counters: number };
// In-memory like refs: a restart forgets it, and a plain request then falls back to the listing price.
const pending = new Map<string, Pending>();

// A price change asked for AFTER the deal was agreed (accepted / meetup_set). Same shape, kept apart from the pre-deal offers.
const repricing = new Map<string, Pending & { at: number }>();
const AGREED = ["accepted", "meetup_set"];
const REPRICE_TTL_MS = 30 * 60_000; // an ask nobody answered goes stale

/** The open price-change ask for a match, forgotten once it is older than the TTL. */
function openReprice(matchId: string) {
  const ask = repricing.get(matchId);
  if (ask && Date.now() - ask.at > REPRICE_TTL_MS) repricing.delete(matchId);
  return repricing.get(matchId);
}

/** Who asked for a price change on an agreed deal that is still waiting for an answer. */
export const repriceAsker = (matchId: string) => openReprice(matchId)?.from;

/** Is there a price on the table for this match (an offer or counter)? */
export const hasPendingOffer = (matchId: string) => pending.has(matchId);

/** Who named the price still on the table (the side now waiting for an answer); a plain request is the buyer waiting. */
export const offerWaiter = (matchId: string): "buyer" | "seller" => pending.get(matchId)?.from ?? "buyer";

/** Forget the price on the table for a match that is over. */
export const clearOffer = (matchId: string) => {
  pending.delete(matchId);
  repricing.delete(matchId);
};

const name = displayName;

/** Buyer offers `offerCents` instead of the asking price. Creates the match and asks the seller. */
export async function makeOffer(buyer: User, listing: Listing, offerCents: number): Promise<string> {
  if (!Number.isInteger(offerCents) || offerCents <= 0) return "what price are you thinking?";
  if (offerCents >= listing.priceCents) return proposeMatch(buyer, listing); // offering full price is just asking for it
  const opened = await openMatch(buyer, listing);
  if (typeof opened === "string") return opened;

  const { match, seller } = opened;
  pending.set(match.id, { cents: offerCents, from: "buyer", counters: 0 });
  await sendTo(
    seller,
    `someone wants your ${itemName(listing)} (listed ${dollars(listing.priceCents)}) and offers ${dollars(offerCents)}. take it? (❤️/yes, no, or reply with a price to counter)`,
    { ref: { kind: "match_request", matchId: match.id } },
  );
  return `sent your ${dollars(offerCents)} offer to the seller, i'll let you know`;
}

/** Yes/no to the price on the table, from whoever it was addressed to. Plain requests (no offer) use respondToMatch. */
export async function respondToOffer(user: User, matchId: string, yes: boolean): Promise<string> {
  if (openReprice(matchId)) return answerReprice(user, matchId, yes);
  const offer = pending.get(matchId);
  if (!offer) return respondToMatch(user, matchId, yes);
  const ctx = await loadMatch(matchId, user.id);
  if (!ctx || ctx.match.status !== "proposed") return NO_MATCH;
  const { listing, buyer, seller } = ctx;
  const isBuyer = user.id === buyer.id;
  if ((offer.from === "buyer") === isBuyer) return `still waiting on ${name(isBuyer ? seller : buyer, "them")} to answer your ${dollars(offer.cents)}`;

  pending.delete(matchId);
  if (yes) return acceptMatch(ctx, isBuyer ? "buyer" : "seller", offer.cents);
  return passOnOffer(ctx, user, offer);
}

/** The recipient said no: end the negotiation (listing stays up) and tell the other side kindly. */
async function passOnOffer(ctx: Ctx, user: User, offer: Pending): Promise<string> {
  const { match, listing, buyer, seller } = ctx;
  const isBuyer = user.id === buyer.id;
  await db.updateMatch(match.id, { status: "cancelled" });
  await reopenOfferedWant(buyer.id, listing.id);
  const price = dollars(offer.cents);
  if (isBuyer) {
    await sendTo(seller, `${name(buyer, "the buyer")} passed on ${price} for the ${itemName(listing)}. it's still listed`);
    return "no worries, i told them. text me if you want me to look for something else";
  }
  await sendTo(buyer, `${name(seller, "the seller")} passed on ${price} for the ${itemName(listing)}, sorry! want me to keep looking?`);
  return "no worries, it stays listed";
}

/** Reply to the price on the table with a different price. Returns Karl's reply ("" if the reply was already sent). */
export async function counterOffer(user: User, matchId: string, cents: number, explicit = false): Promise<string> {
  const ctx = await loadMatch(matchId, user.id);
  if (!Number.isInteger(cents) || cents <= 0) return "what price are you thinking?";
  // After the deal is agreed a price can still be reopened, but only when someone asks for it (explicit) or is answering such an ask.
  if (ctx && AGREED.includes(ctx.match.status) && (explicit || openReprice(matchId))) return repriceDeal(ctx, user, cents);
  if (!ctx || ctx.match.status !== "proposed") return NO_MATCH;
  const { listing, buyer, seller } = ctx;
  const isBuyer = user.id === buyer.id;
  const offer = pending.get(matchId) ?? { cents: listing.priceCents, from: "buyer" as const, counters: 0 }; // plain request = asking price
  const other = isBuyer ? seller : buyer;
  if ((offer.from === "buyer") === isBuyer) return `still waiting on ${name(other, "them")} to answer your ${dollars(offer.cents)}`;
  if (cents === offer.cents) return respondToOffer(user, matchId, true); // naming their number is a yes
  if (!isBuyer && cents > listing.priceCents) return `that's above your ${dollars(listing.priceCents)} ask. what price works?`;
  if (isBuyer && cents >= offer.cents) return respondToOffer(user, matchId, true); // paying their price or more is a yes

  if (offer.counters >= MAX_COUNTERS) {
    const text = `let's call it there. ${isBuyer ? "want it" : "sell it"} at ${dollars(offer.cents)} or pass?`;
    await sendTo(user, text, { ref: { kind: "counter", matchId } }); // keeps yes/no routed to this match
    return "";
  }
  pending.set(matchId, { cents, from: isBuyer ? "buyer" : "seller", counters: offer.counters + 1 });
  await sendTo(
    other,
    `${name(user, isBuyer ? "the buyer" : "the seller")} says ${dollars(cents)} instead of ${dollars(offer.cents)}. deal? (❤️/yes, no, or reply with a price)`,
    { ref: { kind: "counter", matchId } },
  );
  return `sent your ${dollars(cents)} to ${name(other, "them")}, i'll let you know`;
}

/** Renegotiating an agreed deal: ask the other side for `cents` instead of the current price. Returns Karl's reply to the asker. */
async function repriceDeal(ctx: Ctx, user: User, cents: number): Promise<string> {
  const { match, listing, buyer, seller } = ctx;
  const isBuyer = user.id === buyer.id;
  const other = isBuyer ? seller : buyer;
  const open = openReprice(match.id);
  const current = listing.priceCents;
  if (open && (open.from === "buyer") !== isBuyer) { // answering their ask with a price
    if (cents === open.cents) return answerReprice(user, match.id, true);
    if (cents === current) return answerReprice(user, match.id, false);
    if (open.counters >= MAX_COUNTERS) return `let's call it there. ${dollars(open.cents)} or stay at ${dollars(current)}? (yes or no)`;
  } else if (open) {
    return `still waiting on ${name(other, "them")} to answer your ${dollars(open.cents)}`;
  }
  if (cents === current) return `the ${itemName(listing)} is already ${dollars(current)}`;

  repricing.set(match.id, { cents, from: isBuyer ? "buyer" : "seller", counters: open ? open.counters + 1 : 0, at: Date.now() });
  await sendTo(
    other,
    `${name(user, isBuyer ? "the buyer" : "the seller")} asks if you'd do ${dollars(cents)} instead of ${dollars(current)} for the ${itemName(listing)}. (❤️/yes, no, or reply with a price)`,
    { ref: { kind: "counter", matchId: match.id } },
  );
  return `asked them if they'd do ${dollars(cents)}, i'll let you know`;
}

/** Yes/no to a price change on an agreed deal. Yes: the deal's price becomes the asked one (undone if the deal falls through). No: it stays. */
async function answerReprice(user: User, matchId: string, yes: boolean): Promise<string> {
  const ask = openReprice(matchId);
  const ctx = await loadMatch(matchId, user.id);
  if (!ask || !ctx || !AGREED.includes(ctx.match.status)) {
    repricing.delete(matchId);
    return NO_MATCH;
  }
  const { listing, buyer, seller } = ctx;
  const isBuyer = user.id === buyer.id;
  const asker = isBuyer ? seller : buyer;
  if ((ask.from === "buyer") === isBuyer) return `still waiting on ${name(asker, "them")} to answer your ${dollars(ask.cents)}`;

  repricing.delete(matchId);
  const item = itemName(listing);
  const who = name(user, isBuyer ? "the buyer" : "the seller");
  if (yes) {
    await holdAtPrice(listing, ask.cents);
    await sendTo(asker, `${who} said yes, the ${item} is ${dollars(ask.cents)} now`);
    return `done, the ${item} is ${dollars(ask.cents)} now`;
  }
  await sendTo(asker, `${who} passed on ${dollars(ask.cents)}, so the ${item} stays at ${dollars(listing.priceCents)}`);
  return `ok, it stays at ${dollars(listing.priceCents)}`;
}

/**
 * Seller answers a "bid" notice (someone wants the item around $15, seller asks $30).
 * yes with no price -> offer the buyer the midpoint; a price -> offer that; no -> politely drop it.
 * Seller-initiated offer: the BUYER gets "the seller of <item> would do $X (you said $15). deal? (❤️/yes, no, or a price)"
 * with a {kind:"counter", matchId} ref, so the existing counter flow takes over. Returns Karl's reply to the seller.
 */
export async function answerBid(seller: User, bid: { listingId: string; wantId: string }, answer: { yes: boolean } | { priceCents: number }): Promise<string> {
  const [listing, want] = await Promise.all([db.getListing(bid.listingId), db.getWant(bid.wantId)]);
  if (!listing || listing.sellerId !== seller.id || listing.status !== "active") return "that one's not listed anymore, so nothing to offer";
  const ask = dollars(listing.priceCents);
  if ("yes" in answer && !answer.yes) return `no worries, it stays listed at ${ask}`;
  const buyer = want?.status === "open" ? await db.getUser(want.buyerId) : null;
  if (!want || want.maxPriceCents == null || !buyer || buyer.optedOut) return `looks like they're not looking anymore. it stays listed at ${ask}`;

  const cents = "priceCents" in answer ? answer.priceCents : midpointCents(want.maxPriceCents, listing.priceCents);
  if (!Number.isInteger(cents) || cents <= 0) return "what price are you thinking?";
  if (cents >= listing.priceCents) return `that's not under your ${ask} ask, so it just stays listed at ${ask}. name a lower price if you want me to offer it`;
  if ((await db.activeMatchesForUser(buyer.id)).some((m) => m.listingId === listing.id)) return "they're already talking to you about this one, hang tight";

  const opened = await openMatch(buyer, listing);
  if (typeof opened === "string") return opened;
  pending.set(opened.match.id, { cents, from: "seller", counters: 0 });
  await sendTo(
    buyer,
    `the seller of ${itemName(listing)} would do ${dollars(cents)} (you said ${dollars(want.maxPriceCents)}). deal? (❤️/yes, no, or reply with a price)`,
    { ref: { kind: "counter", matchId: opened.match.id } },
  );
  return `sent ${dollars(cents)} to ${name(buyer, "them")}, i'll let you know`;
}
