// Turns bus events into texts. Owner: Nishanth (agent branch).

import { bus, type BusEvents } from "../bus";
import { db } from "../db";
import { dollars, itemName } from "../flows/format";
import { photoAttachment } from "../flows/photo";
import { isSeedUser, sendTo } from "../spectrum/send";

const offered = new Map<string, string>(); // "buyerId:listingId" -> wantId, already offered this process

/** The want a buyer was pinged about for this listing (if this process pinged them). */
export function offeredWant(buyerId: string, listingId: string): string | undefined {
  return offered.get(`${buyerId}:${listingId}`);
}

/** The deal for a pinged listing fell through (declined, cancelled, hold ran out): keep looking for the buyer. */
export async function reopenOfferedWant(buyerId: string, listingId: string): Promise<void> {
  const wantId = offeredWant(buyerId, listingId);
  if (wantId) await db.updateWantStatus(wantId, "open");
}

async function offerListing({ wantId, listingId, buyerId }: BusEvents["match_found"]) {
  const [buyer, listing] = await Promise.all([db.getUser(buyerId), db.getListing(listingId)]);
  const key = `${buyerId}:${listingId}`;
  if (!buyer || buyer.optedOut || isSeedUser(buyer) || listing?.status !== "active" || offered.has(key)) return;
  offered.set(key, wantId);

  const photo = await photoAttachment(listing.photoId);
  const ref = { kind: "offer", listingId, wantId } as const; // same ref on photo and text, so a ❤️ on either works
  if (photo) await sendTo(buyer, photo, { logText: `[photo of ${itemName(listing)}]`, ref });
  await sendTo(buyer, `someone just listed a ${itemName(listing)}, ${dollars(listing.priceCents)}. want it? (❤️ or yes)`, { ref });
  // Don't clobber a half-finished listing draft: the ❤️ still works through the offer ref.
  if ((await db.getUser(buyer.id))?.state.kind !== "drafting_listing") await db.updateUser(buyer.id, { state: { kind: "choosing_result", listingIds: [listingId] } });
}

async function holdExpired({ matchId }: BusEvents["hold_expired"]) {
  const match = await db.getMatch(matchId);
  const [listing, buyer, seller] = match
    ? await Promise.all([db.getListing(match.listingId), db.getUser(match.buyerId), db.getUser(match.sellerId)])
    : [];
  if (!listing || !buyer || !seller) return;
  await reopenOfferedWant(buyer.id, listing.id);
  await sendTo(buyer, `the hold on the ${itemName(listing)} ran out, so it's back up for sale. still want it? just say so`);
  await sendTo(seller, `the hold on your ${itemName(listing)} ran out, so it's listed again. text me if you two still plan to meet`);
}

async function meetupCheckin({ matchId }: BusEvents["meetup_checkin_due"]) {
  const match = await db.getMatch(matchId);
  const listing = match && (await db.getListing(match.listingId));
  if (!match || !listing) return;
  for (const id of [match.buyerId, match.sellerId]) {
    const user = await db.getUser(id);
    if (user) await sendTo(user, `did the ${itemName(listing)} handoff happen? (👍 or 👎)`, { ref: { kind: "checkin", matchId } });
  }
}

async function wantExpired({ wantId, buyerId }: BusEvents["want_expired"]) {
  const [want, buyer] = await Promise.all([db.getWant(wantId), db.getUser(buyerId)]);
  if (want && buyer) await sendTo(buyer, `your search for ${want.queryText} expired, text me if you still need one`);
}

let registered = false;

/** Safe to call more than once (tests do); handlers are only attached the first time. */
export function registerNotifications(): void {
  if (registered) return;
  registered = true;
  bus.on("match_found", offerListing);
  bus.on("hold_expired", holdExpired);
  bus.on("meetup_checkin_due", meetupCheckin);
  bus.on("want_expired", wantExpired);
}
