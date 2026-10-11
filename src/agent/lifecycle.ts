// Texts for lifecycle bus events (order-book spreads are in notifications.ts). Owner: Nishanth.
// checkin_reminder_due: re-ask "did it happen?"; stale_check_due: "still selling / looking?"; stale_auto_closed: "took it down".
// deal_auto_closed: stuck meetup closed (both sides told); proposal_expired: unanswered request, only the waiting side told.
// Replies to these questions are routed in src/spectrum/inbound.ts (refs "checkin" and "still_active").

import { bus, type BusEvents } from "../bus";
import { db } from "../db";
import { dollars, itemName } from "../flows/format";
import { offeredWant } from "./notifications";
import { sendTo } from "../spectrum/send";
import type { User } from "../types";

/** The user, unless they can't be texted (missing or opted out; seed users are skipped inside sendTo). */
async function textable(userId: string): Promise<User | null> {
  const user = await db.getUser(userId);
  return user && !user.optedOut ? user : null;
}

async function checkinReminder({ matchId }: BusEvents["checkin_reminder_due"]) {
  const match = await db.getMatch(matchId);
  if (match?.status !== "meetup_set") return; // already done, cancelled or expired
  const listing = await db.getListing(match.listingId);
  if (!listing) return;
  const sides = [
    { id: match.buyerId, confirmed: match.buyerConfirmed },
    { id: match.sellerId, confirmed: match.sellerConfirmed },
  ];
  for (const side of sides) {
    const user = side.confirmed ? null : await textable(side.id);
    if (user) await sendTo(user, `quick check, did the ${itemName(listing)} handoff happen? (👍 or 👎)`, { ref: { kind: "checkin", matchId } });
  }
}

async function staleCheck({ userId, listingId, wantId }: BusEvents["stale_check_due"]) {
  const user = await textable(userId);
  if (!user) return;
  if (listingId) {
    const listing = await db.getListing(listingId);
    if (listing?.sellerId !== userId || (listing.status !== "active" && listing.status !== "held")) return;
    await sendTo(user, `still selling your ${itemName(listing)} for ${dollars(listing.priceCents)}? (👍 still selling / 👎 sold or gone)`, { ref: { kind: "still_active", listingId } });
  } else if (wantId) {
    const want = await db.getWant(wantId);
    if (want?.buyerId !== userId || want.status !== "open") return;
    await sendTo(user, `still looking for ${want.queryText}? (👍 yes / 👎 nope)`, { ref: { kind: "still_active", wantId } });
  }
}

async function staleClosed({ userId, listingId, wantId }: BusEvents["stale_auto_closed"]) {
  const user = await textable(userId);
  if (!user) return;
  if (listingId) {
    const listing = await db.getListing(listingId);
    if (listing) await sendTo(user, `took down your ${itemName(listing)} listing since i didn't hear back. text me a photo anytime to relist`);
  } else if (wantId) {
    const want = await db.getWant(wantId);
    if (want) await sendTo(user, `stopped looking for ${want.queryText} since i didn't hear back. just text me if you still need one`);
  }
}

/** Meetup nobody confirmed even after two reminders: closed automatically. Both sides hear it once. */
async function dealClosed({ matchId }: BusEvents["deal_auto_closed"]) {
  const match = await db.getMatch(matchId);
  const listing = match && (await db.getListing(match.listingId));
  if (match?.status !== "expired" || !listing) return;
  const [buyer, seller] = [await textable(match.buyerId), await textable(match.sellerId)];
  const item = itemName(listing);
  if (seller) await sendTo(seller, `closed out the ${item} deal since i didn't hear back. it's listed again, text me if it actually sold`);
  if (buyer) {
    // The reopened want (if Karl pinged them about this listing) lets a plain 👍/👎 answer reach the still_active flow.
    const wantId = offeredWant(match.buyerId, match.listingId);
    await sendTo(buyer, `closed out the ${item} deal since i didn't hear back. want me to keep looking? (👍/👎)`, wantId ? { ref: { kind: "still_active", wantId } } : {});
  }
}

/** A request/offer nobody answered for a day: tell only the side that was waiting. */
async function proposalExpired({ matchId }: BusEvents["proposal_expired"]) {
  const match = await db.getMatch(matchId);
  const listing = match && (await db.getListing(match.listingId));
  if (match?.status !== "expired" || !listing) return;
  const [event] = await db.findEvents("proposal_expired", { payload: { matchId }, limit: 1 });
  const item = itemName(listing);
  if (event?.payload.waiting === "seller") {
    const seller = await textable(match.sellerId);
    if (seller && listing.status === "active") await sendTo(seller, `they didn't answer about the ${item}, so it's still listed at ${dollars(listing.priceCents)}`);
  } else {
    const buyer = await textable(match.buyerId);
    if (buyer) await sendTo(buyer, `no answer on the ${item} after a day, so i let it go. i'll keep looking for you`);
  }
}

let registered = false;

/** Safe to call more than once (tests do); handlers are only attached the first time. */
export function registerLifecycle(): void {
  if (registered) return;
  registered = true;
  bus.on("checkin_reminder_due", checkinReminder);
  bus.on("stale_check_due", staleCheck);
  bus.on("stale_auto_closed", staleClosed);
  bus.on("deal_auto_closed", dealClosed);
  bus.on("proposal_expired", proposalExpired);
}
