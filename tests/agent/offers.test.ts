import { afterEach, beforeEach, expect, mock, setSystemTime, spyOn, test } from "bun:test";
import type { Message, Space } from "spectrum-ts";
import * as loop from "../../src/agent/loop";
import { registerNotifications } from "../../src/agent/notifications";
import { bus } from "../../src/bus";
import { LIMITS } from "../../src/config";
import { db } from "../../src/db";
import { parseOfferCents, parsePriceCents } from "../../src/flows/format";
import { cancelMatch, proposeMatch } from "../../src/flows/match";
import { counterOffer, makeOffer, MAX_COUNTERS } from "../../src/flows/offers";
import { expireHolds } from "../../src/jobs/timers";
import { handleInbound } from "../../src/spectrum/inbound";
import { lookupRef } from "../../src/spectrum/refs";
import { rememberSpace, sendTo } from "../../src/spectrum/send";
import type { Listing, Match, User } from "../../src/types";
import { fakeSpace, fakeUser, lastTextTo, resetAll, sentTo } from "./helpers";

registerNotifications();
let runAgentTurn: ReturnType<typeof spyOn>;

let buyer: User;
let seller: User;
let listing: Listing;
let n = 0;

const spaces = new Map<string, Space>(); // one fake space per user (fakeSpace resets its outbox)
const spaceOf = (user: User) => spaces.get(user.spaceId) ?? spaces.set(user.spaceId, fakeSpace(user.spaceId)).get(user.spaceId)!;

/** A text from `user`, through the real inbound pipeline. */
const say = (user: User, text: string) =>
  handleInbound(spaceOf(user), { id: `o${++n}`, direction: "inbound", sender: { id: user.phone }, content: { type: "text", text }, read: async () => {} } as unknown as Message);
const tapback = (user: User, targetId: string, emoji: string) =>
  handleInbound(spaceOf(user), { id: `o${++n}`, direction: "inbound", sender: { id: user.phone }, content: { type: "reaction", emoji, target: { id: targetId } }, read: async () => {} } as unknown as Message);

async function activeListing(sellerId: string, priceCents = 2000): Promise<Listing> {
  const draft = { title: "Water bottle", description: "works", category: "water bottle", condition: "good" as const, priceCents, confidence: 0.9 };
  const l = await db.createListing({ sellerId, draft, photoId: null });
  return db.updateListing(l.id, { status: "active" });
}
const theMatch = async (): Promise<Match> => (await db.activeMatchesForUser(buyer.id))[0]!;

beforeEach(async () => {
  setSystemTime(new Date("2026-10-12T16:00:00Z"));
  LIMITS.debounceMs = 0;
  await resetAll();
  spaces.clear();
  runAgentTurn = spyOn(loop, "runAgentTurn");
  runAgentTurn.mockResolvedValue("agent reply");
  buyer = await fakeUser("Nishanth", "+15550003333");
  seller = await fakeUser("Aarush", "+15550004444");
  listing = await activeListing(seller.id);
  for (const user of [buyer, seller]) rememberSpace(spaceOf(user)); // before anything is sent: fakeSpace resets the outbox
});

afterEach(() => {
  mock.restore();
  setSystemTime();
});

test("price parsing: bare prices and haggling phrases", () => {
  for (const t of ["15", "$15", "how about 15", "can do 15", "15 bucks", "$12.50?"]) expect(parsePriceCents(t)).not.toBeNull();
  expect(parsePriceCents("$12.50")).toBe(1250);
  for (const t of ["yes", "the pit at 2", "i have 15 minutes", "no thanks"]) expect(parsePriceCents(t)).toBeNull();
  expect(parseOfferCents("can you ask the seller for $10 instead?")).toBe(1000);
  expect(parseOfferCents("ask if they'd take 10")).toBe(1000);
  expect(parseOfferCents("offer 10")).toBe(1000);
  expect(parseOfferCents("2")).toBeNull(); // a lone number is a result index
  expect(parseOfferCents("is it still available at 2pm")).toBeNull();
});

test("buyer offer reaches the seller with a match_request ref, and the buyer is told", async () => {
  const want = await db.createWant({ buyerId: buyer.id, queryText: "water bottle", maxPriceCents: 1000 });
  bus.emit("match_found", { wantId: want.id, listingId: listing.id, buyerId: buyer.id, score: 0.9 });
  await Bun.sleep(30);

  expect(await makeOffer(buyer, listing, 1000)).toBe("sent your $10 offer to the seller, i'll let you know");
  expect(lastTextTo(seller)).toBe("someone wants your water bottle (listed $20) and offers $10. take it? (❤️/yes, no, or reply with a price to counter)");
  const m = await theMatch();
  expect(m.status).toBe("proposed");
  expect(lookupRef(sentTo(seller).at(-1)!.id)).toEqual({ kind: "match_request", matchId: m.id });
  expect((await db.getWant(want.id))?.status).toBe("matched");
});

test("seller yes: listing price becomes the offer, held, both told the price", async () => {
  await makeOffer(buyer, listing, 1000);
  await say(seller, "yes");
  const m = await theMatch();
  expect(m.status).toBe("accepted");
  const l = (await db.getListing(listing.id))!;
  expect(l.priceCents).toBe(1000);
  expect(l.status).toBe("held");
  expect(lastTextTo(buyer)).toContain("Aarush said yes to $10, the water bottle is held for you");
  expect(lastTextTo(seller)).toContain("held the water bottle for Nishanth at $10");
});

test("seller ❤️ tapback on the offer accepts at the offer price", async () => {
  await makeOffer(buyer, listing, 1000);
  await tapback(seller, sentTo(seller).at(-1)!.id, "❤️");
  expect((await theMatch()).status).toBe("accepted");
  expect((await db.getListing(listing.id))?.priceCents).toBe(1000);
});

test("seller counters with a bare price; buyer yes accepts at the counter immediately", async () => {
  await makeOffer(buyer, listing, 1000);
  await say(seller, "how about 15");
  expect(lastTextTo(seller)).toBe("sent your $15 to Nishanth, i'll let you know");
  expect(lastTextTo(buyer)).toBe("Aarush says $15 instead of $10. deal? (❤️/yes, no, or reply with a price)");
  const m = await theMatch();
  expect(lookupRef(sentTo(buyer).at(-1)!.id)).toEqual({ kind: "counter", matchId: m.id });
  expect(m.status).toBe("proposed");

  await say(buyer, "yes");
  expect((await theMatch()).status).toBe("accepted");
  expect((await db.getListing(listing.id))?.priceCents).toBe(1500);
  expect(lastTextTo(buyer)).toContain("deal at $15");
  expect(lastTextTo(seller)).toContain("Nishanth took $15!");
  expect(runAgentTurn).not.toHaveBeenCalled();
});

test("buyer counters back, seller gets it with a counter ref and can accept", async () => {
  await makeOffer(buyer, listing, 1000);
  await say(seller, "$16");
  await say(buyer, "can do 13");
  expect(lastTextTo(seller)).toBe("Nishanth says $13 instead of $16. deal? (❤️/yes, no, or reply with a price)");
  expect(lookupRef(sentTo(seller).at(-1)!.id)).toEqual({ kind: "counter", matchId: (await theMatch()).id });
  await say(seller, "yes");
  expect((await theMatch()).status).toBe("accepted");
  expect((await db.getListing(listing.id))?.priceCents).toBe(1300);
});

test("naming the other side's number is a yes", async () => {
  await makeOffer(buyer, listing, 1000);
  await say(seller, "15");
  await say(buyer, "15");
  expect((await theMatch()).status).toBe("accepted");
  expect((await db.getListing(listing.id))?.priceCents).toBe(1500);
});

test("seller declines an offer: match cancelled, listing stays active, buyer told kindly, want reopened", async () => {
  const want = await db.createWant({ buyerId: buyer.id, queryText: "water bottle", maxPriceCents: 1000 });
  bus.emit("match_found", { wantId: want.id, listingId: listing.id, buyerId: buyer.id, score: 0.9 });
  await Bun.sleep(30);
  await makeOffer(buyer, listing, 1000);
  await say(seller, "no");
  expect(await db.activeMatchesForUser(buyer.id)).toHaveLength(0);
  expect((await db.getListing(listing.id))?.status).toBe("active");
  expect((await db.getListing(listing.id))?.priceCents).toBe(2000);
  expect(lastTextTo(buyer)).toBe("Aarush passed on $10 for the water bottle, sorry! want me to keep looking?");
  expect((await db.getWant(want.id))?.status).toBe("open");
});

test("buyer declines a seller counter: cancelled, seller told, listing stays active", async () => {
  await makeOffer(buyer, listing, 1000);
  await say(seller, "15");
  await say(buyer, "no");
  expect(await db.activeMatchesForUser(buyer.id)).toHaveLength(0);
  expect((await db.getListing(listing.id))?.status).toBe("active");
  expect(lastTextTo(seller)).toBe("Nishanth passed on $15 for the water bottle. it's still listed");
  expect((await db.getListing(listing.id))?.priceCents).toBe(2000);
});

test("a plain (no-offer) request can still be countered by the seller", async () => {
  await proposeMatch(buyer, listing);
  await say(seller, "$17");
  expect(lastTextTo(buyer)).toBe("Aarush says $17 instead of $20. deal? (❤️/yes, no, or reply with a price)");
});

test("counters are capped: the 5th price gets 'call it there' instead of being relayed", async () => {
  await makeOffer(buyer, listing, 1000);
  const m = await theMatch();
  const prices = [1900, 1100, 1800, 1200]; // seller, buyer, seller, buyer = MAX_COUNTERS counters
  expect(prices).toHaveLength(MAX_COUNTERS);
  for (const [i, cents] of prices.entries()) await counterOffer(i % 2 === 0 ? seller : buyer, m.id, cents);
  const sellerInbox = sentTo(seller).length;
  await say(seller, "17");
  expect(sentTo(seller).length).toBe(sellerInbox + 1);
  expect(lastTextTo(seller)).toBe("let's call it there. sell it at $12 or pass?");
  expect(lastTextTo(buyer)).toContain("instead of"); // nothing new relayed
  expect(lookupRef(sentTo(seller).at(-1)!.id)).toEqual({ kind: "counter", matchId: m.id });

  await say(seller, "yes"); // yes still routes to this match
  expect((await theMatch()).status).toBe("accepted");
  expect((await db.getListing(listing.id))?.priceCents).toBe(1200);
});

test("you can't answer your own price", async () => {
  await makeOffer(buyer, listing, 1000);
  const m = await theMatch();
  expect(await counterOffer(buyer, m.id, 900)).toContain("still waiting on Aarush");
});

test("offering the asking price or more is just a request", async () => {
  expect(await makeOffer(buyer, listing, 2500)).toContain("asked the seller");
  expect(lastTextTo(seller)).toContain("someone wants your water bottle at $20");
});

test("guards: own listing, taken listing, duplicate, seed seller", async () => {
  expect(await makeOffer(seller, listing, 1000)).toContain("your own listing");
  await makeOffer(buyer, listing, 1000);
  expect(await makeOffer(buyer, listing, 900)).toContain("already asked");

  const demo = await db.createUser({ phone: "seed:maya", spaceId: "seed" });
  const demoListing = await activeListing(demo.id);
  expect(await makeOffer(buyer, demoListing, 1000)).toContain("demo listing");
  expect(await db.activeMatchesForUser(demo.id)).toHaveLength(0);

  const taken = await db.updateListing((await activeListing(seller.id)).id, { status: "held" });
  expect(await makeOffer(buyer, taken, 1000)).toContain("just got taken");
});

test("cancelling during negotiation ends it", async () => {
  await makeOffer(buyer, listing, 1000);
  const id = (await theMatch()).id;
  await cancelMatch(buyer, id);
  expect(await counterOffer(seller, id, 1500)).toContain("can't find");
});

test("real-world phrase after an offer ref goes straight to the seller (no Gemini)", async () => {
  await db.updateUser(buyer.id, { state: { kind: "choosing_result", listingIds: [listing.id] } });
  // the proactive ping, sent the way notifications.ts sends it (tagged, so it becomes the buyer's last question)
  await sendTo(buyer, "someone just listed a water bottle, $20. want it? (❤️ or yes)", { ref: { kind: "offer", listingId: listing.id, wantId: "w1" } });

  await say(buyer, "can you ask the seller for $10 instead?");
  expect(runAgentTurn).not.toHaveBeenCalled();
  expect(lastTextTo(buyer)).toBe("sent your $10 offer to the seller, i'll let you know");
  expect(lastTextTo(seller)).toContain("offers $10");
});

test("same phrase after a single search result also becomes an offer", async () => {
  await db.updateUser(buyer.id, { state: { kind: "choosing_result", listingIds: [listing.id] } });
  await sendTo(buyer, "1. Water bottle · $20", { ref: { kind: "result", listingId: listing.id } });
  await say(buyer, "would they take $10?");
  expect(lastTextTo(seller)).toContain("offers $10");
});

test("a bare number after several results is not an offer", async () => {
  const other = await activeListing(seller.id);
  await db.updateUser(buyer.id, { state: { kind: "choosing_result", listingIds: [listing.id, other.id] } });
  await sendTo(buyer, "2. Water bottle · $20", { ref: { kind: "result", listingId: other.id } });
  await say(buyer, "offer 10");
  expect(runAgentTurn).toHaveBeenCalled();
  expect(sentTo(seller)).toHaveLength(0);
});

test("questions with numbers are not offers (units, times, counts)", () => {
  for (const t of [
    "can i take it today at 4", "would it fit 2 bottles?", "i will be at the pit at 2", "does it come with 2 lids? would love it",
    "will it hold 32 oz?", "does it take 12 oz?", "will it fit 20 oz?", "would it fit in a 2 liter backpack pocket",
    "is it less than 20 oz", "ask them if it's 16 oz", "how about tomorrow at 5", "can i see it before i take it, 5 mins",
  ]) expect(parseOfferCents(t)).toBeNull();
  for (const t of ["would they take 10?", "would they take $10 for it", "ask if they'd do 9 bucks", "can you ask for 8 instead"]) expect(parseOfferCents(t)).not.toBeNull();
  expect(parsePriceCents("make it 40")).toBeNull(); // a draft edit, not a counter
});

test("a question with a number after a ping goes to Gemini, not the seller", async () => {
  await sendTo(buyer, "someone just listed a water bottle, $20. want it? (❤️ or yes)", { ref: { kind: "offer", listingId: listing.id, wantId: "w1" } });
  await say(buyer, "will it hold 32 oz?");
  expect(runAgentTurn).toHaveBeenCalled();
  expect(sentTo(seller)).toHaveLength(0);
  expect(await db.activeMatchesForUser(buyer.id)).toHaveLength(0);
});

test("a free-text price at or above the asking price is not turned into a request", async () => {
  await sendTo(buyer, "someone just listed a water bottle, $20. want it? (❤️ or yes)", { ref: { kind: "offer", listingId: listing.id, wantId: "w1" } });
  await say(buyer, "can you ask the seller for $25 instead?");
  expect(runAgentTurn).toHaveBeenCalled();
  expect(sentTo(seller)).toHaveLength(0);
});

test("seller can't counter above the ask; buyer countering at or above the seller's price is a yes", async () => {
  await makeOffer(buyer, listing, 1000);
  const m = await theMatch();
  expect(await counterOffer(seller, m.id, 2500)).toContain("above your $20 ask");
  await counterOffer(seller, m.id, 1500);
  await counterOffer(buyer, m.id, 1600);
  expect((await theMatch()).status).toBe("accepted");
  expect((await db.getListing(listing.id))?.priceCents).toBe(1500);
});

test("a negotiated price goes back to the ask when the hold expires or is cancelled", async () => {
  await makeOffer(buyer, listing, 1200);
  await say(seller, "yes");
  expect((await db.getListing(listing.id))?.priceCents).toBe(1200);
  await cancelMatch(buyer, (await theMatch()).id);
  const l = (await db.getListing(listing.id))!;
  expect([l.status, l.priceCents]).toEqual(["active", 2000]);

  await makeOffer(buyer, listing, 1100);
  await say(seller, "yes");
  const m = (await db.activeMatchesForUser(buyer.id))[0]!;
  await db.updateMatch(m.id, { holdExpiresAt: new Date(Date.now() - 1000) });
  await expireHolds(new Date());
  const after = (await db.getListing(listing.id))!;
  expect([after.status, after.priceCents]).toEqual(["active", 2000]);
});
