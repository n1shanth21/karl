// Demo (seed) sellers, wants closing when the buyer takes a ping, and the sold-comps price hint.
import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { registerNotifications } from "../../src/agent/notifications";
import { resetGeminiForTests, setGeminiForTests } from "../../src/agent/gemini";
import { bus } from "../../src/bus";
import { db } from "../../src/db";
import { pickResult } from "../../src/flows/buy";
import { proposeMatch, respondToMatch } from "../../src/flows/match";
import * as photo from "../../src/flows/photo";
import { confirmDraft, draftFromPhoto } from "../../src/flows/sell";
import * as price from "../../src/matching/price";
import { sendTo } from "../../src/spectrum/send";
import type { Listing, ListingDraft, User } from "../../src/types";
import { fakeUser, lastTextTo, resetAll, sentTo } from "./helpers";

registerNotifications();
afterAll(resetGeminiForTests);
afterEach(() => mock.restore());

let buyer: User;

beforeEach(async () => {
  await resetAll();
  buyer = await fakeUser("Maya");
  spyOn(photo, "toJpeg").mockImplementation(async (bytes) => ({ bytes, mimeType: "image/jpeg" }));
  spyOn(photo, "photoAttachment").mockResolvedValue(null);
});

async function listingFrom(seller: User, title = "Mini fridge"): Promise<Listing> {
  const draft = { title, description: "works", category: "mini fridge", condition: "good" as const, priceCents: 4500, confidence: 0.9 };
  return db.updateListing((await db.createListing({ sellerId: seller.id, draft, photoId: null })).id, { status: "active" });
}

async function seedSeller(): Promise<User> {
  const user = await db.createUser({ phone: "seed:maya", spaceId: "seed" });
  return db.updateUser(user.id, { firstName: "Maya", optedOut: true });
}

test("a seed listing gets the demo reply: no match, want stays open", async () => {
  const listing = await listingFrom(await seedSeller());
  const want = await db.createWant({ buyerId: buyer.id, queryText: "fridge", maxPriceCents: null });
  expect(await proposeMatch(buyer, listing)).toContain("demo listing");
  expect(await db.activeMatchesForUser(buyer.id)).toHaveLength(0);
  expect((await db.getListing(listing.id))?.status).toBe("active");
  expect((await db.getWant(want.id))?.status).toBe("open");
});

test("sendTo never sends to a seed user, even one who isn't opted out", async () => {
  const bySpace = await db.updateUser((await db.createUser({ phone: "+15559990001", spaceId: "seed" })).id, { optedOut: false });
  const byPhone = await db.updateUser((await db.createUser({ phone: "seed:sam", spaceId: "space-sam" })).id, { optedOut: false });
  expect(await sendTo(bySpace, "hi")).toBeUndefined();
  expect(await sendTo(byPhone, "hi")).toBeUndefined();
  expect(await db.recentMessages(bySpace.id, 5)).toHaveLength(0);
});

test("a match_found ping to a seed buyer does nothing", async () => {
  const seller = await fakeUser("Sam");
  const listing = await listingFrom(seller);
  const seedBuyer = await db.updateUser((await db.createUser({ phone: "seed:ava", spaceId: "seed" })).id, { optedOut: false });
  const want = await db.createWant({ buyerId: seedBuyer.id, queryText: "fridge", maxPriceCents: null });
  bus.emit("match_found", { wantId: want.id, listingId: listing.id, buyerId: seedBuyer.id, score: 0.9 });
  await Bun.sleep(30);
  expect(await db.recentMessages(seedBuyer.id, 5)).toHaveLength(0);
});

test("buyer picking the item they were pinged about (Gemini path) marks that want matched", async () => {
  const listing = await listingFrom(await fakeUser("Sam"));
  const want = await db.createWant({ buyerId: buyer.id, queryText: "fridge", maxPriceCents: null });
  const other = await db.createWant({ buyerId: buyer.id, queryText: "desk lamp", maxPriceCents: null });
  bus.emit("match_found", { wantId: want.id, listingId: listing.id, buyerId: buyer.id, score: 0.9 });
  await Bun.sleep(30);
  expect(sentTo(buyer).at(-1)?.text).toContain("someone just listed");

  expect(await pickResult(buyer, { listingId: listing.id })).toContain("asked the seller");
  expect((await db.getWant(want.id))?.status).toBe("matched");
  expect((await db.getWant(other.id))?.status).toBe("open");
});

test("a listing that wasn't offered leaves wants alone", async () => {
  const listing = await listingFrom(await fakeUser("Sam"));
  const want = await db.createWant({ buyerId: buyer.id, queryText: "fridge", maxPriceCents: null });
  await proposeMatch(buyer, listing);
  expect((await db.getWant(want.id))?.status).toBe("open");
});

const vision = (priceCents: number) => {
  const draft: ListingDraft = { title: "Mini fridge", description: "works", category: "mini fridge", condition: "good", priceCents, confidence: 0.9 };
  setGeminiForTests({ describeItem: async () => draft });
};
const photoIn = { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" };

test("draft price: caption, else sold-comps hint, else Gemini's estimate", async () => {
  vision(3000);
  const seller = await fakeUser("Sam");
  const suggest = spyOn(price, "suggestPriceCents").mockResolvedValue(4400);

  const hinted = await draftFromPhoto(seller, photoIn);
  expect(hinted.ok && hinted.listing.priceCents).toBe(4400);
  expect(suggest).toHaveBeenCalledWith("mini fridge");

  const typed = await draftFromPhoto(seller, photoIn, "selling for $25");
  expect(typed.ok && typed.listing.priceCents).toBe(2500);

  suggest.mockResolvedValue(null);
  const fallback = await draftFromPhoto(seller, photoIn);
  expect(fallback.ok && fallback.listing.priceCents).toBe(3000);

  suggest.mockRejectedValue(new Error("db down"));
  const failed = await draftFromPhoto(seller, photoIn);
  expect(failed.ok && failed.listing.priceCents).toBe(3000);
});

test("confirming a draft still works without logging listing_activated itself", async () => {
  vision(3000);
  const seller = await fakeUser("Sam");
  const log = spyOn(db, "logEvent");
  await draftFromPhoto(seller, photoIn);
  expect((await confirmDraft(seller)).ok).toBe(true);
  expect(log).not.toHaveBeenCalledWith("listing_activated", expect.anything());
});

test("a pinged want is matched when the buyer takes it, and reopens if the seller declines", async () => {
  const buyer = await fakeUser("Maya");
  const seller = await fakeUser("Jordan");
  const draft = { title: "Desk lamp", description: "works", category: "desk lamp", condition: "good" as const, priceCents: 1500, confidence: 0.9 };
  const listing = await db.updateListing((await db.createListing({ sellerId: seller.id, draft, photoId: null })).id, { status: "active" });
  const want = await db.createWant({ buyerId: buyer.id, queryText: "desk lamp", maxPriceCents: 2000 });

  registerNotifications();
  bus.emit("match_found", { wantId: want.id, listingId: listing.id, buyerId: buyer.id, score: 0.9 });
  for (let i = 0; i < 100 && !lastTextTo(buyer).includes("want it?"); i++) await new Promise((r) => setTimeout(r, 5));

  await proposeMatch(buyer, listing);
  expect((await db.getWant(want.id))?.status).toBe("matched");

  const [m] = await db.activeMatchesForUser(buyer.id);
  await respondToMatch(seller, m!.id, false);
  expect((await db.getWant(want.id))?.status).toBe("open");
});
