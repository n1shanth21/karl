// Match lifecycle: propose → seller accepts (hold) → meetup → did it happen → sold. Owner: Nishanth.

import { MEETUP_SPOTS } from "../config";
import { db } from "../db";
import { offeredWant, reopenOfferedWant } from "../agent/notifications";
import { isSeedUser, sendTo } from "../spectrum/send";
import type { Listing, Match, User } from "../types";
import { logDealEnded, openDispute } from "./dispute";
import { dollars, itemName } from "./format";
import { holdAtPrice, keepAgreedPrice, releaseHold } from "./holds";
import { meetupTimeProblem } from "./meetup";
import { displayName } from "./names";
import { askAvailability, SCHEDULING_HOLD_MS, suggestSlot } from "./scheduling";

const NO_MATCH = "i can't find that one. text 'my stuff' to see what's active";
const DEMO_LISTING = "that one's a demo listing, so the seller isn't reachable. i'll keep looking and text you if a real one shows up";
const HANDOFF = ["accepted", "meetup_set"];
const OPEN = ["proposed", ...HANDOFF];

const holdText = `${SCHEDULING_HOLD_MS / 3_600_000} hrs`; // the real hold (it must outlast an overnight "when are you free?")

export type Ctx = { match: Match; listing: Listing; buyer: User; seller: User };

/** Load a match plus both people, only if `userId` is on it. */
export async function loadMatch(matchId: string, userId: string): Promise<Ctx | null> {
  const match = await db.getMatch(matchId);
  if (!match || (match.buyerId !== userId && match.sellerId !== userId)) return null;
  const [listing, buyer, seller] = await Promise.all([
    db.getListing(match.listingId),
    db.getUser(match.buyerId),
    db.getUser(match.sellerId),
  ]);
  return listing && buyer && seller ? { match, listing, buyer, seller } : null;
}
const load = loadMatch;

/**
 * Shared start of a buyer's request or offer: guards, then create the match (proposed) and mark the pinged want done.
 * Returns the new match + seller, or Karl's reply for the buyer when nothing was created.
 */
export async function openMatch(buyer: User, listing: Listing): Promise<{ match: Match; seller: User } | string> {
  if (listing.sellerId === buyer.id) return "that's your own listing, nice try";
  if (listing.status !== "active") return `the ${itemName(listing)} just got taken. want me to keep an eye out for another?`;
  const mine = await db.activeMatchesForUser(buyer.id);
  if (mine.some((m) => m.listingId === listing.id)) return `you already asked about the ${itemName(listing)}, still waiting on the seller`;
  const seller = await db.getUser(listing.sellerId);
  if (!seller) throw new Error(`seller ${listing.sellerId} not found`);

  if (isSeedUser(seller) || seller.optedOut) return DEMO_LISTING; // no match, no hold; the buyer's want stays open

  const match = await db.createMatch({ listingId: listing.id, buyerId: buyer.id, sellerId: seller.id });
  const wantId = offeredWant(buyer.id, listing.id); // buyer took a ping: that want is done
  if (wantId) await db.updateWantStatus(wantId, "matched");
  if (buyer.state.kind === "choosing_result") await db.updateUser(buyer.id, { state: { kind: "idle" } });
  return { match, seller };
}

/** Buyer wants listing: create match (proposed) and ask the seller. Returns Karl's reply for the buyer. */
export async function proposeMatch(buyer: User, listing: Listing): Promise<string> {
  const opened = await openMatch(buyer, listing);
  if (typeof opened === "string") return opened;
  await sendTo(
    opened.seller,
    `someone wants your ${itemName(listing)} at ${dollars(listing.priceCents)}. ok to hold it for them for ${holdText}? (❤️ or yes)`,
    { ref: { kind: "match_request", matchId: opened.match.id } },
  );
  return "asked the seller, i'll text you when they answer";
}

/** Seller answers. accept → hold + meetup options for both. decline → cancelled, buyer told. */
export async function respondToMatch(seller: User, matchId: string, accept: boolean): Promise<string> {
  const ctx = await load(matchId, seller.id);
  if (!ctx || ctx.seller.id !== seller.id || ctx.match.status !== "proposed") return NO_MATCH;
  if (accept) return acceptMatch(ctx, "seller");

  const { match, listing, buyer } = ctx;
  await db.updateMatch(match.id, { status: "cancelled" });
  await reopenOfferedWant(buyer.id, listing.id);
  await sendTo(buyer, `the ${itemName(listing)} isn't available after all, sorry! text me if you want me to look for another one`);
  return "no worries, it stays listed";
}

/**
 * Hold the listing and send meetup options. `by` is who said yes; `agreedCents` (when it differs from the
 * listing) becomes the listing's price, and both sides are told it.
 */
export async function acceptMatch(ctx: Ctx, by: "seller" | "buyer", agreedCents?: number): Promise<string> {
  const { match, listing, buyer, seller } = ctx;
  const item = itemName(listing);
  if (listing.status !== "active") {
    await db.updateMatch(match.id, { status: "cancelled" });
    await reopenOfferedWant(buyer.id, listing.id);
    if (by === "seller") await sendTo(buyer, `the ${item} isn't available after all, sorry! text me if you want me to look for another one`);
    return `sorry, the ${item} isn't available anymore`;
  }

  const holdExpiresAt = new Date(Date.now() + SCHEDULING_HOLD_MS); // long enough to outlast an overnight "when are you free?"
  await db.updateMatch(match.id, { status: "accepted", holdExpiresAt });
  await holdAtPrice(listing, agreedCents);

  const price = agreedCents === undefined ? "" : dollars(agreedCents);
  const buyerName = displayName(buyer, "the buyer");
  const said = price ? `said yes to ${price}` : "said yes";
  const forWhom = price ? `${buyerName} at ${price}` : buyerName;
  const reply = await askAvailability(
    ctx,
    by,
    by === "buyer"
      ? { actor: `deal at ${price}, the ${item} is held for you, numbers stay private, i'll pass messages along.`, other: `${buyerName} took ${price}! the ${item} is held for them.` }
      : { actor: `held the ${item} for ${forWhom}, numbers stay private, i'll pass messages along.`, other: `${displayName(seller, "the seller")} ${said}, the ${item} is held for you.` },
  );
  return askNameIfMissing(ctx, by, reply);
}

/**
 * The relay label uses first names, so a nameless side is asked once, with "first name" in the text so the inbound
 * name capture takes the answer. The accepting side's question rides on their reply; the other side gets its own text.
 */
async function askNameIfMissing(ctx: Ctx, by: "seller" | "buyer", reply: string): Promise<string> {
  let out = reply;
  for (const [side, user] of [["buyer", ctx.buyer], ["seller", ctx.seller]] as const) {
    if (user.firstName) continue;
    const q = `quick q, what first name should i show the ${side === "buyer" ? "seller" : "buyer"}?`;
    if (side === by) out = `${reply} ${q}`;
    else await sendTo(user, q);
  }
  return out;
}

/** Either side proposes a spot + time (the set_meetup tool). It only locks once the OTHER side agrees (👍 on the same slot). */
export async function setMeetup(user: User, matchId: string, spot: string, at: Date): Promise<string> {
  const ctx = await load(matchId, user.id);
  if (!ctx || !HANDOFF.includes(ctx.match.status)) return NO_MATCH;
  const place = MEETUP_SPOTS.find((s) => s.toLowerCase() === spot.trim().toLowerCase());
  if (!place) return `i only do meetups at public campus spots: ${MEETUP_SPOTS.join(", ")}. which works?`;

  const problem = meetupTimeProblem(at);
  if (problem) return problem;
  return suggestSlot(user, matchId, place, at);
}

/** Cancel the match, free the listing, tell the other side. */
async function endMatch(ctx: Ctx, user: User, what: string): Promise<string> {
  const { match, listing, buyer, seller } = ctx;
  await db.updateMatch(match.id, { status: "cancelled" });
  await releaseHold(listing);
  await reopenOfferedWant(buyer.id, listing.id);
  await logDealEnded(ctx, `cancelled after ${displayName(user, "the other person")} ${what.includes("didn't happen") ? "said it didn't happen" : "backed out"}`);

  const isBuyer = user.id === buyer.id;
  const followUp = isBuyer ? "it's back up for sale." : "text me if you want me to look for another one.";
  await sendTo(isBuyer ? seller : buyer, `${displayName(user, "the other person")} ${what} on the ${itemName(listing)}. ${followUp}`);
  return "ok, called it off. no hard feelings";
}

/** Both sides confirmed (or a dispute was settled): sold. Thanks go to both; returns the thanks for `by`. */
export async function completeDeal(ctx: Ctx, by: User): Promise<string> {
  const { match, listing, buyer, seller } = ctx;
  await db.updateMatch(match.id, { buyerConfirmed: true, sellerConfirmed: true, status: "completed" });
  await db.updateListing(listing.id, { status: "sold" });
  keepAgreedPrice(listing.id);
  await logDealEnded(ctx, "completed, both sides confirmed");

  const buyerThanks = `enjoy the ${itemName(listing)}! thanks for using karl`;
  const sellerThanks = `sold! thanks for selling your ${itemName(listing)} through me`;
  const isBuyer = by.id === buyer.id;
  await sendTo(isBuyer ? seller : buyer, isBuyer ? sellerThanks : buyerThanks);
  return isBuyer ? buyerThanks : sellerThanks;
}

/**
 * Answer to "did it happen?". Both yes → sold. No → cancelled, unless the other side already said it DID happen:
 * then it's a dispute (see dispute.ts) and nothing is cancelled.
 */
export async function confirmHappened(user: User, matchId: string, happened: boolean): Promise<string> {
  const ctx = await load(matchId, user.id);
  if (!ctx || !HANDOFF.includes(ctx.match.status)) return NO_MATCH;
  const isBuyer = user.id === ctx.buyer.id;
  if (!happened) {
    const otherClaimed = isBuyer ? ctx.match.sellerConfirmed : ctx.match.buyerConfirmed;
    const cancel = () => endMatch(ctx, user, "said the handoff didn't happen");
    return otherClaimed ? openDispute(ctx, user, cancel) : cancel();
  }

  const match = await db.updateMatch(matchId, isBuyer ? { buyerConfirmed: true } : { sellerConfirmed: true });
  if (!(match.buyerConfirmed && match.sellerConfirmed)) return "thanks! waiting to hear from the other side too";
  return completeDeal(ctx, user);
}

/** Either side backs out. */
export async function cancelMatch(user: User, matchId: string): Promise<string> {
  const ctx = await load(matchId, user.id);
  if (!ctx || !OPEN.includes(ctx.match.status)) return NO_MATCH;
  return endMatch(ctx, user, "had to cancel");
}

export async function getActiveMatches(user: User): Promise<Match[]> {
  return db.activeMatchesForUser(user.id);
}

const FELL_THROUGH = "heads up, this one fell through. want me to keep looking?";

/**
 * A user was banned (explicit photo): end every deal they're in, take their listings down and close
 * their wants. The other person gets one neutral text and never hears why.
 */
export async function endDealsForBannedUser(userId: string): Promise<void> {
  const told = new Set<string>();
  for (const match of await db.activeMatchesForUser(userId)) {
    await db.updateMatch(match.id, { status: "cancelled" });
    const listing = await db.getListing(match.listingId);
    await releaseHold(listing);
    if (listing && match.sellerId === userId) await reopenOfferedWant(match.buyerId, listing.id);

    const otherId = match.buyerId === userId ? match.sellerId : match.buyerId;
    if (told.has(otherId)) continue;
    told.add(otherId);
    const other = await db.getUser(otherId);
    if (other) await sendTo(other, FELL_THROUGH).catch((err) => console.error("[karl] couldn't tell other side", err));
  }
  for (const listing of await db.listingsBySeller(userId, ["active", "held"])) {
    await db.updateListing(listing.id, { status: "removed" });
  }
  for (const want of await db.openWantsByBuyer(userId)) await db.updateWantStatus(want.id, "closed");
}
