// Price negotiation before a deal: buyer offer → seller yes/no/counter → ping-pong → accept at the agreed price.
// Karl relays each side's price through their own DM (no group chats). Owner: Nishanth.

import { reopenOfferedWant } from "../agent/notifications";
import { db } from "../db";
import { sendTo } from "../spectrum/send";
import type { Listing, User } from "../types";
import { dollars, itemName } from "./format";
import { acceptMatch, loadMatch, openMatch, proposeMatch, respondToMatch, type Ctx } from "./match";

export const MAX_COUNTERS = 4;
const NO_MATCH = "i can't find that one. text 'my stuff' to see what's active";

/** The price on the table for a still-undecided match: who named it and how many counters so far. */
type Pending = { cents: number; from: "buyer" | "seller"; counters: number };
// In-memory like refs: a restart forgets it, and a plain request then falls back to the listing price.
const pending = new Map<string, Pending>();

/** Is there a price on the table for this match (an offer or counter)? */
export const hasPendingOffer = (matchId: string) => pending.has(matchId);

const name = (user: User, fallback: string) => user.firstName ?? fallback;

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
export async function counterOffer(user: User, matchId: string, cents: number): Promise<string> {
  const ctx = await loadMatch(matchId, user.id);
  if (!ctx || ctx.match.status !== "proposed") return NO_MATCH;
  if (!Number.isInteger(cents) || cents <= 0) return "what price are you thinking?";
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

/**
 * Seller answers a "bid" notice (someone wants the item around $15, seller asks $30).
 * yes with no price -> offer the buyer the midpoint; a price -> offer that; no -> politely drop it.
 * Seller-initiated offer: the BUYER gets "the seller of <item> would do $X (you said $15). deal? (❤️/yes, no, or a price)"
 * with a {kind:"counter", matchId} ref, so the existing counter flow takes over. Returns Karl's reply to the seller.
 * TODO(wave: orderbook)
 */
export async function answerBid(_seller: User, _bid: { listingId: string; wantId: string }, _answer: { yes: boolean } | { priceCents: number }): Promise<string> {
  throw new Error("TODO(orderbook): answerBid");
}
