// Order book: wide-spread notices (ask 1.5x-3x the bid) to both sides, want-created near misses, seller-initiated offers.
import { afterEach, beforeEach, expect, mock, test as baseTest } from "bun:test";
import type { Message } from "spectrum-ts";
import { registerNotifications } from "../../src/agent/notifications";
import { bus } from "../../src/bus";
import { config, LIMITS } from "../../src/config";
import { db } from "../../src/db";
import { answerBid, respondToOffer } from "../../src/flows/offers";
import { onListingActivated, onWantCreated } from "../../src/matching";
import { MAX_SPREAD_NOTICES_PER_SELLER_PER_DAY } from "../../src/matching/spread";
import { handleInbound } from "../../src/spectrum/inbound";
import { lastRefTo, spaceFor } from "../../src/spectrum/send";
import type { Listing, User } from "../../src/types";
import { fakeUser, lastTextTo, resetAll, sentTo } from "./helpers";

const test = config.dbMode === "postgres" ? baseTest.skip : baseTest;
registerNotifications();

const spreads: string[] = [];
const matches: string[] = [];
bus.on("spread_found", (e) => void spreads.push(e.listingId));
bus.on("match_found", (e) => void matches.push(e.listingId));

let buyer: User;
let seller: User;
const wait = () => new Promise((r) => setTimeout(r, 20)); // let bus handlers send their texts

let n = 0;
const say = async (u: User, content: object) =>
  handleInbound(await spaceFor(u), { id: `ob${++n}`, direction: "inbound", sender: { id: u.phone }, content, read: async () => {} } as unknown as Message);

beforeEach(async () => {
  LIMITS.debounceMs = 0;
  spreads.length = 0;
  matches.length = 0;
  await resetAll();
  buyer = await fakeUser("Nishanth", "+15550005001");
  seller = await fakeUser("Aarush", "+15550005002");
});
afterEach(() => mock.restore());

const want = async (maxPriceCents: number | null, query = "desk lamp") => {
  const w = await db.createWant({ buyerId: buyer.id, queryText: query, maxPriceCents });
  await onWantCreated(w);
  await wait();
  return w;
};
const list = async (priceCents: number, activate = true): Promise<Listing> => {
  const draft = { title: "Desk lamp", description: "led desk lamp", category: "desk lamp", condition: "good" as const, priceCents, confidence: 0.9 };
  const l = await db.updateListing((await db.createListing({ sellerId: seller.id, draft, photoId: null })).id, { status: "active" });
  if (activate) await onListingActivated(l);
  await wait();
  return l;
};

test("$30 ask vs $15 bid: both sides are told once, with the right refs", async () => {
  const w = await want(1500);
  const l = await list(3000);
  expect(spreads).toEqual([l.id]);
  expect(sentTo(buyer).length).toBe(1);
  expect(lastTextTo(buyer)).toBe("someone's selling a desk lamp for $30 (you said $15). want me to make them an offer? reply with a price, or 👎");
  expect(lastRefTo(buyer.id)).toEqual({ kind: "offer", listingId: l.id, wantId: w.id, spread: true });
  expect(sentTo(seller).length).toBe(1);
  expect(lastTextTo(seller)).toBe("someone's looking for a desk lamp around $15 (you're at $30). want to offer it to them? reply with a price (like $23), or 👎");
  expect(lastRefTo(seller.id)).toEqual({ kind: "bid", listingId: l.id, wantId: w.id });
});

test("$50 ask vs $15 bid (over 3x): nothing", async () => {
  await want(1500);
  await list(5000);
  expect(spreads).toEqual([]);
  expect(sentTo(buyer)).toEqual([]);
  expect(sentTo(seller)).toEqual([]);
});

test("want created AFTER a $14 listing for a $10 want: near-miss ping", async () => {
  const l = await list(1400);
  await want(1000);
  expect(matches).toEqual([l.id]);
  expect(lastTextTo(buyer)).toContain("a bit over your $10");
  expect(spreads).toEqual([]);
});

test("want created AFTER a $30 listing for a $15 want: spread notice", async () => {
  const l = await list(3000);
  const w = await want(1500);
  expect(spreads).toEqual([l.id]);
  expect(matches).toEqual([]);
  expect(lastRefTo(buyer.id)).toEqual({ kind: "offer", listingId: l.id, wantId: w.id, spread: true });
  expect(sentTo(seller).length).toBe(1);
});

test("a listing under the bid is not re-pinged when the want is created (search already showed it)", async () => {
  await list(800);
  await want(1000);
  expect(matches).toEqual([]);
});

test("never matches a user with their own listing", async () => {
  const mine = await db.createWant({ buyerId: seller.id, queryText: "desk lamp", maxPriceCents: 1500 });
  await onWantCreated(mine);
  await list(3000);
  expect(spreads).toEqual([]);
});

test("dedupe: re-activating the listing or recreating the want does not re-notify", async () => {
  const w = await want(1500);
  const l = await list(3000);
  await onListingActivated(await db.getListing(l.id) as Listing);
  await onWantCreated(w);
  await wait();
  expect(spreads).toEqual([l.id]);
  expect(sentTo(buyer).length).toBe(1);
  expect(sentTo(seller).length).toBe(1);
});

test("a seller gets at most 3 bid notices a day", async () => {
  for (let i = 0; i < MAX_SPREAD_NOTICES_PER_SELLER_PER_DAY + 1; i++) {
    const other = await fakeUser("Buyer", `+1555000510${i}`);
    await onWantCreated(await db.createWant({ buyerId: other.id, queryText: "desk lamp", maxPriceCents: 1500 }));
  }
  await list(3000);
  expect(spreads.length).toBe(MAX_SPREAD_NOTICES_PER_SELLER_PER_DAY);
});

test("answerBid yes: offers the midpoint, buyer gets a counter ref, buyer yes -> accepted at that price", async () => {
  const w = await want(1500);
  const l = await list(3000);
  const reply = await answerBid(seller, { listingId: l.id, wantId: w.id }, { yes: true });
  expect(reply).toContain("$23");
  expect(lastTextTo(buyer)).toBe("the seller of desk lamp would do $23 (you said $15). deal? (❤️/yes, no, or reply with a price)");
  const ref = lastRefTo(buyer.id);
  expect(ref?.kind).toBe("counter");
  const matchId = (ref as { matchId: string }).matchId;
  expect((await db.getMatch(matchId))?.status).toBe("proposed");

  await respondToOffer(buyer, matchId, true);
  expect((await db.getMatch(matchId))?.status).toBe("accepted");
  expect((await db.getListing(l.id))?.priceCents).toBe(2300);
  expect(lastTextTo(seller)).toContain("$23");
});

test("answerBid with an explicit price offers that price", async () => {
  const w = await want(1500);
  const l = await list(3000);
  await answerBid(seller, { listingId: l.id, wantId: w.id }, { priceCents: 2200 });
  expect(lastTextTo(buyer)).toContain("would do $22");
  expect(lastRefTo(buyer.id)?.kind).toBe("counter");
});

test("answerBid at or above the ask is just a normal listing; no stays listed", async () => {
  const w = await want(1500);
  const l = await list(3000);
  expect(await answerBid(seller, { listingId: l.id, wantId: w.id }, { priceCents: 3000 })).toContain("stays listed at $30");
  expect(await answerBid(seller, { listingId: l.id, wantId: w.id }, { yes: false })).toBe("no worries, it stays listed at $30");
  expect(await db.activeMatchesForUser(buyer.id)).toEqual([]);
});

test("buyer declining the seller's price reopens the want", async () => {
  const w = await want(1500);
  const l = await list(3000);
  await answerBid(seller, { listingId: l.id, wantId: w.id }, { yes: true });
  await respondToOffer(buyer, (lastRefTo(buyer.id) as { matchId: string }).matchId, false);
  expect((await db.getWant(w.id))?.status).toBe("open");
  expect((await db.getListing(l.id))?.status).toBe("active");
});

test("spread notice: yes (typed or tapback) asks for a price instead of requesting the full ask; a number makes the offer", async () => {
  const w = await want(1500);
  const l = await list(3000);
  const sellerTexts = sentTo(seller).length;
  await say(buyer, { type: "text", text: "yes" });
  expect(lastTextTo(buyer)).toContain("what price");
  expect(lastRefTo(buyer.id)).toEqual({ kind: "offer", listingId: l.id, wantId: w.id, spread: true }); // question stays open
  await say(buyer, { type: "reaction", emoji: "👍", target: { id: sentTo(buyer).at(-1)!.id } });
  expect(lastTextTo(buyer)).toContain("what price");
  expect(await db.activeMatchesForUser(buyer.id)).toEqual([]);
  expect(sentTo(seller).length).toBe(sellerTexts); // the seller was never asked to hold it at $30

  await say(buyer, { type: "text", text: "20" }); // a bare number is the offer
  expect(lastTextTo(seller)).toContain("offers $20");
  expect((await db.activeMatchesForUser(buyer.id))[0]?.status).toBe("proposed");
});

test("a buyer gets at most the daily cap of spread notices across sellers", async () => {
  await want(1500);
  for (let i = 0; i < LIMITS.maxProactivePingsPerUserPerDay + 2; i++) {
    const other = await fakeUser("Seller", `+1555000520${i}`);
    const draft = { title: "Desk lamp", description: "led desk lamp", category: "desk lamp", condition: "good" as const, priceCents: 3000, confidence: 0.9 };
    const l = await db.updateListing((await db.createListing({ sellerId: other.id, draft, photoId: null })).id, { status: "active" });
    await onListingActivated(l);
  }
  await wait();
  expect(spreads.length).toBe(LIMITS.maxProactivePingsPerUserPerDay);
});

test("a new want gets one spread notice (the best listing), not one per listing", async () => {
  await list(3000);
  await list(3200);
  await list(3400);
  const before = sentTo(buyer).length;
  await want(1500);
  expect(spreads.length).toBe(1);
  expect(sentTo(buyer).length - before).toBe(1);
});

test("same buyer, two wants, one listing: near-miss ping and no spread notice for it", async () => {
  await want(2000);
  await want(1000);
  const l = await list(3000);
  expect(matches).toEqual([l.id]);
  expect(spreads).toEqual([]);
});

test("same buyer: a spread notice already sent means no near-miss ping for that listing", async () => {
  await want(1000);
  const l = await list(3000);
  expect(spreads).toEqual([l.id]);
  await want(2000);
  expect(matches).toEqual([]);
});
