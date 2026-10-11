// Match lifecycle: propose → seller accepts (hold) → meetup → did it happen → sold. Owner: Nishanth.

import { LIMITS, MEETUP_SPOTS } from "../config";
import { db } from "../db";
import { offeredWant, reopenOfferedWant } from "../agent/notifications";
import { isSeedUser, sendTo } from "../spectrum/send";
import type { Listing, Match, User } from "../types";
import { dollars, itemName } from "./format";
import { describeTime, meetupProposal, meetupTimeProblem } from "./meetup";

const NO_MATCH = "i can't find that one. text 'my stuff' to see what's active";
const DEMO_LISTING = "that one's a demo listing, so the seller isn't reachable. i'll keep looking and text you if a real one shows up";
const PAY_REMINDER = "only pay once you have it in hand.";
const HANDOFF = ["accepted", "meetup_set"];
const OPEN = ["proposed", ...HANDOFF];
const relayRef = (matchId: string) => ({ ref: { kind: "relay", matchId } }) as const;

const holdText = `${LIMITS.holdMinutes / 60} hrs`;

type Ctx = { match: Match; listing: Listing; buyer: User; seller: User };

/** Load a match plus both people, only if `userId` is on it. */
async function load(matchId: string, userId: string): Promise<Ctx | null> {
  const match = await db.getMatch(matchId);
  if (!match || (match.buyerId !== userId && match.sellerId !== userId)) return null;
  const [listing, buyer, seller] = await Promise.all([
    db.getListing(match.listingId),
    db.getUser(match.buyerId),
    db.getUser(match.sellerId),
  ]);
  return listing && buyer && seller ? { match, listing, buyer, seller } : null;
}

/** Buyer wants listing: create match (proposed) and ask the seller. Returns Karl's reply for the buyer. */
export async function proposeMatch(buyer: User, listing: Listing): Promise<string> {
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
  await sendTo(
    seller,
    `someone wants your ${itemName(listing)} at ${dollars(listing.priceCents)}. ok to hold it for them for ${holdText}? (❤️ or yes)`,
    { ref: { kind: "match_request", matchId: match.id } },
  );
  return "asked the seller, i'll text you when they answer";
}

/** Seller answers. accept → hold + meetup options for both. decline → cancelled, buyer told. */
export async function respondToMatch(seller: User, matchId: string, accept: boolean): Promise<string> {
  const ctx = await load(matchId, seller.id);
  if (!ctx || ctx.seller.id !== seller.id || ctx.match.status !== "proposed") return NO_MATCH;
  const { match, listing, buyer } = ctx;

  if (!accept || listing.status !== "active") {
    await db.updateMatch(match.id, { status: "cancelled" });
    await reopenOfferedWant(buyer.id, listing.id);
    await sendTo(buyer, `the ${itemName(listing)} isn't available after all, sorry! text me if you want me to look for another one`);
    return accept ? `sorry, the ${itemName(listing)} isn't available anymore` : "no worries, it stays listed";
  }

  const holdExpiresAt = new Date(Date.now() + LIMITS.holdMinutes * 60_000);
  await db.updateMatch(match.id, { status: "accepted", holdExpiresAt });
  await db.updateListing(listing.id, { status: "held" });

  const options = meetupProposal();
  const item = itemName(listing);
  await sendTo(buyer, `${seller.firstName ?? "the seller"} said yes, the ${item} is held for you for ${holdText}. ${options}`, relayRef(match.id));
  return `held the ${item} for ${buyer.firstName ?? "the buyer"} for ${holdText}, numbers stay private, i'll pass messages along. ${options}`;
}

/** Either side picks spot + time → meetup_set; tell the other side. */
export async function setMeetup(user: User, matchId: string, spot: string, at: Date): Promise<string> {
  const ctx = await load(matchId, user.id);
  if (!ctx || !HANDOFF.includes(ctx.match.status)) return NO_MATCH;
  const place = MEETUP_SPOTS.find((s) => s.toLowerCase() === spot.trim().toLowerCase());
  if (!place) return `i only do meetups at public campus spots: ${MEETUP_SPOTS.join(", ")}. which works?`;

  const problem = meetupTimeProblem(at);
  if (problem) return problem;

  await db.updateMatch(matchId, { status: "meetup_set", meetupSpot: place, meetupAt: at });
  const isBuyer = user.id === ctx.buyer.id;
  const note = `meetup set: ${place} ${describeTime(at)}, for the ${itemName(ctx.listing)}. text me if plans change.`;
  await sendTo(isBuyer ? ctx.seller : ctx.buyer, isBuyer ? note : `${note} ${PAY_REMINDER}`, relayRef(matchId));
  return isBuyer ? `${note} ${PAY_REMINDER}` : note;
}

/** Cancel the match, free the listing, tell the other side. */
async function endMatch(ctx: Ctx, user: User, what: string): Promise<string> {
  const { match, listing, buyer, seller } = ctx;
  await db.updateMatch(match.id, { status: "cancelled" });
  if (listing.status === "held") await db.updateListing(listing.id, { status: "active" });
  await reopenOfferedWant(buyer.id, listing.id);

  const isBuyer = user.id === buyer.id;
  const followUp = isBuyer ? "it's back up for sale." : "text me if you want me to look for another one.";
  await sendTo(isBuyer ? seller : buyer, `${user.firstName ?? "the other person"} ${what} on the ${itemName(listing)}. ${followUp}`);
  return "ok, called it off. no hard feelings";
}

/** Answer to "did it happen?". Both yes → sold. No from either side → cancelled. */
export async function confirmHappened(user: User, matchId: string, happened: boolean): Promise<string> {
  const ctx = await load(matchId, user.id);
  if (!ctx || !HANDOFF.includes(ctx.match.status)) return NO_MATCH;
  if (!happened) return endMatch(ctx, user, "said the handoff didn't happen");

  const { listing, buyer, seller } = ctx;
  const isBuyer = user.id === buyer.id;
  const match = await db.updateMatch(matchId, isBuyer ? { buyerConfirmed: true } : { sellerConfirmed: true });
  if (!(match.buyerConfirmed && match.sellerConfirmed)) return "thanks! waiting to hear from the other side too";

  await db.updateMatch(matchId, { status: "completed" });
  await db.updateListing(listing.id, { status: "sold" });

  const buyerThanks = `enjoy the ${itemName(listing)}! thanks for using karl`;
  const sellerThanks = `sold! thanks for selling your ${itemName(listing)} through me`;
  await sendTo(isBuyer ? seller : buyer, isBuyer ? sellerThanks : buyerThanks);
  return isBuyer ? buyerThanks : sellerThanks;
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
    if (listing?.status === "held") await db.updateListing(listing.id, { status: "active" });
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
