// Buy flow. Owner: Nishanth.

import { markdown } from "spectrum-ts";
import { gemini } from "../agent/gemini";
import { LIMITS } from "../config";
import { db } from "../db";
import { onWantCreated, searchListings } from "../matching";
import { sendTo } from "../spectrum/send";
import type { Listing, User, Want } from "../types";
import { conditionText, dollars, itemName } from "./format";
import { getActiveMatches, proposeMatch } from "./match";
import { photoAttachment } from "./photo";

// Photon's deliverability guide says not to fire several messages within seconds, so results are spaced out.
let resultPauseMs = 700;
/** Tests shorten (or zero) the pause between results. */
export const setResultPauseForTests = (ms: number) => void (resultPauseMs = ms);

const STOPWORDS = new Set(["for", "the", "and", "need", "want", "under", "any", "some", "something", "looking", "with", "get", "buy", "has", "have"]);
const words = (text: string) => text.toLowerCase().match(/[a-z]{3,}/g)?.filter((w) => !STOPWORDS.has(w)) ?? [];

/** Search results are the closest things in meaning, not always the item asked for (desk fan for "desk lamp").
 *  Gemini keeps the ones that really are the item; if it fails, keep titles sharing meaningful words with the query
 *  (two when the query has two, so a desk fan doesn't pass for a "desk lamp"). */
async function onlyRelevant(query: string, listings: Listing[]): Promise<Listing[]> {
  try {
    const keep = new Set(await gemini.pickRelevant(query, listings.map((l) => l.title)));
    return listings.filter((_, i) => keep.has(i));
  } catch (err) {
    console.error("[buy] relevance check failed, using word overlap", err);
    const wanted = new Set(words(query));
    const needed = Math.min(2, wanted.size);
    return listings.filter((l) => words(l.title).filter((w) => wanted.has(w)).length >= needed);
  }
}

/** Search and SEND up to LIMITS.maxSearchResults results to the user, one at a time (photo, then
 *  "**1. Title** · $45 · good"), both tagged ref result so ❤️ on either works. Pauses between results.
 *  Sets state choosing_result. Returns what was shown ([] = nothing found; caller offers save_want). */
export async function searchAndShow(user: User, query: string, maxPriceCents: number | null): Promise<Listing[]> {
  const results = await searchListings(query, { maxPriceCents, excludeSellerId: user.id });
  const found = results.map((r) => r.listing).slice(0, LIMITS.maxSearchResults);
  const listings = found.length ? await onlyRelevant(query, found) : [];
  if (listings.length === 0) return [];

  for (const [i, listing] of listings.entries()) {
    if (i > 0 && resultPauseMs > 0) await Bun.sleep(resultPauseMs);
    const ref = { kind: "result", listingId: listing.id } as const;
    const photo = listing.photoId ? await photoAttachment(listing.photoId) : null;
    if (photo) await sendTo(user, photo, { logText: `[photo of ${itemName(listing)}]`, ref });
    const details = `${dollars(listing.priceCents)} · ${conditionText(listing.condition)}`;
    await sendTo(user, markdown(`**${i + 1}. ${listing.title}** · ${details}`), { logText: `${i + 1}. ${listing.title} · ${details}`, ref });
  }
  if (resultPauseMs > 0) await Bun.sleep(resultPauseMs);
  await sendTo(user, "reply with the number (or ❤️ one) and i'll check with the seller");
  await db.updateUser(user.id, { state: { kind: "choosing_result", listingIds: listings.map((l) => l.id) } });
  return listings;
}

/** Buyer picks a shown result by 1-based index or listingId → match.proposeMatch. Returns Karl's reply. */
export async function pickResult(user: User, pick: { index?: number; listingId?: string }): Promise<string> {
  const fresh = await db.getUser(user.id); // the caller's `user` may predate the search
  const shown = fresh?.state.kind === "choosing_result" ? fresh.state.listingIds : [];
  const listingId = pick.listingId ?? (pick.index ? shown[pick.index - 1] : undefined);
  if (!listingId) return "which one? reply with the number from the list";

  const listing = await db.getListing(listingId);
  if (!listing || listing.status !== "active") return "ah, that one just got taken. want me to look for something similar?";
  return proposeMatch(user, listing);
}

/** Save a want + onWantCreated. */
export async function saveWant(user: User, query: string, maxPriceCents: number | null): Promise<Want> {
  const want = await db.createWant({ buyerId: user.id, queryText: query, maxPriceCents });
  await onWantCreated(want);
  return want;
}

export async function cancelWant(user: User, wantId: string): Promise<boolean> {
  const want = await db.getWant(wantId);
  if (want?.buyerId !== user.id || want.status !== "open") return false;
  await db.updateWantStatus(want.id, "closed");
  return true;
}

/** Short text summary of the user's active listings, open wants and active matches (with ids for tools). */
export async function myStuff(user: User): Promise<string> {
  const listings = await db.listingsBySeller(user.id, ["draft", "active", "held"]);
  const wants = await db.openWantsByBuyer(user.id);
  const matches = await Promise.all(
    (await getActiveMatches(user)).map(async (m) => {
      const [listing, other] = await Promise.all([db.getListing(m.listingId), db.getUser(m.buyerId === user.id ? m.sellerId : m.buyerId)]);
      return { match: m, listing, other };
    }),
  );

  const when = (at: Date) => at.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" });
  const parts = [
    listings.length && `listings: ${listings.map((l) => `[${l.id}] ${itemName(l)} ${dollars(l.priceCents)} ${l.status}`).join("; ")}`,
    wants.length && `wants: ${wants.map((w) => `[${w.id}] ${w.queryText}${w.maxPriceCents == null ? "" : ` ≤${dollars(w.maxPriceCents)}`}`).join("; ")}`,
    matches.length &&
      `matches: ${matches
        .map(({ match, listing, other }) => {
          const meetup = match.meetupSpot && match.meetupAt ? `, meetup ${match.meetupSpot} ${when(match.meetupAt)}` : "";
          const role = match.buyerId === user.id ? "buying" : "selling";
          const who = match.buyerId === user.id ? "from" : "to";
          return `[${match.id}] ${role} ${listing ? itemName(listing) : "item"} ${who} ${other?.firstName ?? "someone"} (${match.status}${meetup})`;
        })
        .join("; ")}`,
  ].filter(Boolean);
  return parts.length ? parts.join("\n") : "nothing yet";
}
