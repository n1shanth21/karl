// Sell + buy flows. photo.ts, match.ts and safety are stubbed with spyOn (restored after each test);
// Gemini is always faked and reset afterAll so the fake doesn't leak into other files.
import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { resetGeminiForTests, setGeminiForTests } from "../../src/agent/gemini";
import { bus } from "../../src/bus";
import { db } from "../../src/db";
import { setResultPauseForTests } from "../../src/flows/buy";
import * as match from "../../src/flows/match";
import * as photoModule from "../../src/flows/photo";
import * as safety from "../../src/safety";
import { lookupRef } from "../../src/spectrum/refs";
import type { Listing, ListingDraft, Match } from "../../src/types";
import { fakeUser, resetAll, sentTo } from "./helpers";

import { pickResult, cancelWant, myStuff, saveWant, searchAndShow } from "../../src/flows/buy";
import { cancelDraft, confirmDraft, draftFromPhoto, removeListing, updateDraft } from "../../src/flows/sell";

const proposed: string[] = []; // listing ids passed to proposeMatch
let activeMatches: Match[] = [];
const found: { wantId: string; listingId: string }[] = []; // match_found events
bus.on("match_found", (e) => void found.push(e));

function stubModules() {
  spyOn(photoModule, "toJpeg").mockImplementation(async (bytes) => ({ bytes, mimeType: "image/jpeg" }));
  spyOn(photoModule, "photoAttachment").mockImplementation(async (id) => (id ? ({ type: "attachment", name: `photo-${id}` } as never) : null));
  spyOn(match, "proposeMatch").mockImplementation(async (_buyer, listing: Listing) => {
    proposed.push(listing.id);
    return "asked the seller!";
  });
  spyOn(match, "getActiveMatches").mockImplementation(async () => activeMatches);
  spyOn(safety, "checkProhibited").mockImplementation((draft) =>
    draft.title.includes("vape") ? { action: "block", reason: "can't list vapes, sorry" } : { action: "allow" },
  );
}

afterEach(() => mock.restore());
afterAll(() => {
  mock.restore();
  resetGeminiForTests();
});

const fridge: ListingDraft = { title: "Mini Fridge", description: "works great", category: "mini fridge", condition: "like_new", priceCents: 4500, confidence: 0.9 };
const photo = { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/heic" };
let describeCalls: (string | undefined)[] = [];

function fakeVision(draft: ListingDraft | null) {
  setGeminiForTests({
    describeItem: async (_jpeg, caption) => {
      describeCalls.push(caption);
      return draft;
    },
  });
}

/** Seller drafts + confirms a listing; returns it. */
async function activeListing(seller: Awaited<ReturnType<typeof fakeUser>>, draft = fridge) {
  fakeVision(draft);
  const result = await draftFromPhoto(seller, photo);
  if (!result.ok) throw new Error(result.reply);
  const confirmed = await confirmDraft(seller);
  if (!confirmed.ok) throw new Error(confirmed.reason);
  return confirmed.listing;
}

beforeEach(async () => {
  stubModules();
  setResultPauseForTests(0);
  await resetAll();
  proposed.length = 0;
  describeCalls = [];
  activeMatches = [];
  found.length = 0;
});

test("photo -> draft -> confirm goes live and fires match_found for a saved want", async () => {
  const seller = await fakeUser("Sam");
  const buyer = await fakeUser("Maya");
  const want = await saveWant(buyer, "need a mini fridge", 6000);
  fakeVision(fridge);
  const draft = await draftFromPhoto(seller, photo);
  expect(draft.ok).toBe(true);
  if (!draft.ok) return;
  expect(draft.reply).toStartWith("mini fridge, like new, $45. post it?");
  expect(draft.listing.status).toBe("draft");
  expect(draft.listing.photoId).not.toBeNull();
  expect((await db.getUser(seller.id))?.state).toEqual({ kind: "drafting_listing", listingId: draft.listing.id });

  const confirmed = await confirmDraft(seller);
  expect(confirmed.ok && confirmed.listing.status).toBe("active");
  expect((await db.getUser(seller.id))?.state).toEqual({ kind: "idle" });
  expect(found).toHaveLength(1);
  expect(found[0]).toMatchObject({ wantId: want.id, listingId: draft.listing.id });
});

test("a price in the caption beats Gemini's suggestion", async () => {
  const seller = await fakeUser();
  fakeVision(fridge);
  const withDollar = await draftFromPhoto(seller, photo, "selling this for $40");
  expect(withDollar.ok && withDollar.listing.priceCents).toBe(4000);
  const withBucks = await draftFromPhoto(seller, photo, "35.50 bucks obo");
  expect(withBucks.ok && withBucks.listing.priceCents).toBe(3550);
  expect(withBucks.ok && withBucks.reply).toContain("$35.50");
  const noPrice = await draftFromPhoto(seller, photo, "from my dorm");
  expect(noPrice.ok && noPrice.listing.priceCents).toBe(4500);
});

test("unclear photo asks for another angle and creates nothing", async () => {
  const seller = await fakeUser();
  fakeVision(null);
  const result = await draftFromPhoto(seller, photo);
  expect(result).toEqual({ ok: false, reply: "hmm can't tell what that is, can you send another angle?" });
  expect(await db.listingsBySeller(seller.id)).toHaveLength(0);
});

test("prohibited items are refused with the safety reason", async () => {
  const seller = await fakeUser();
  fakeVision({ ...fridge, title: "Juul vape" });
  const result = await draftFromPhoto(seller, photo);
  expect(result).toEqual({ ok: false, reply: "can't list vapes, sorry" });
  expect(await db.listingsBySeller(seller.id)).toHaveLength(0);
});

test("updateDraft edits the draft; cancelDraft removes it; neither works without one", async () => {
  const seller = await fakeUser();
  expect(await updateDraft(seller, { priceCents: 100 })).toBeNull();
  expect(await cancelDraft(seller)).toBe(false);

  fakeVision(fridge);
  await draftFromPhoto(seller, photo);
  const edited = await updateDraft(seller, { priceCents: 3000, condition: "good" });
  expect(edited).toMatchObject({ priceCents: 3000, condition: "good", title: "Mini Fridge" });

  expect(await cancelDraft(seller)).toBe(true);
  expect((await db.getUser(seller.id))?.state).toEqual({ kind: "idle" });
  expect(await db.listingsBySeller(seller.id, ["draft"])).toHaveLength(0);
  expect((await confirmDraft(seller)).ok).toBe(false);
});

test("confirmDraft refuses someone else's draft and a full listing quota", async () => {
  const seller = await fakeUser("Sam");
  const other = await fakeUser("Maya");
  fakeVision(fridge);
  const draft = await draftFromPhoto(seller, photo);
  if (!draft.ok) throw new Error("draft failed");
  expect((await confirmDraft(other, draft.listing.id)).ok).toBe(false);

  for (let i = 0; i < 10; i++) {
    await db.updateListing((await db.createListing({ sellerId: seller.id, draft: fridge, photoId: null })).id, { status: "active" });
  }
  const full = await confirmDraft(seller);
  expect(full.ok).toBe(false);
  expect((await db.getListing(draft.listing.id))?.status).toBe("draft");
});

test("removeListing only removes the user's own active listings", async () => {
  const seller = await fakeUser("Sam");
  const other = await fakeUser("Maya");
  const listing = await activeListing(seller);
  expect(await removeListing(other, listing.id)).toBe(false);
  expect(await removeListing(seller, listing.id)).toBe(true);
  expect((await db.getListing(listing.id))?.status).toBe("removed");
  expect(await removeListing(seller, listing.id)).toBe(false);
});

test("search sends each result with a ref, a closing line, and sets choosing_result", async () => {
  const seller = await fakeUser("Sam");
  const buyer = await fakeUser("Maya");
  const listing = await activeListing(seller);

  const shown = await searchAndShow(buyer, "mini fridge", 6000);
  expect(shown.map((l) => l.id)).toEqual([listing.id]);

  const sent = sentTo(buyer);
  expect(sent.map((s) => s.text)).toEqual(["photo-" + listing.photoId, "[content]", "reply with the number (or ❤️ one) and i'll check with the seller"]);
  expect(await (sent[1]!.raw as { build(): Promise<unknown> }).build()).toEqual({ type: "markdown", markdown: "**1. Mini Fridge** · $45 · like new" });
  expect(lookupRef(sent[0]!.id)).toEqual({ kind: "result", listingId: listing.id }); // ❤️ on the photo works too
  expect(lookupRef(sent[1]!.id)).toEqual({ kind: "result", listingId: listing.id });
  expect((await db.getUser(buyer.id))?.state).toEqual({ kind: "choosing_result", listingIds: [listing.id] });
});

test("search respects the price cap, skips your own listings, and returns [] silently", async () => {
  const seller = await fakeUser("Sam");
  const buyer = await fakeUser("Maya");
  await activeListing(seller);

  expect(await searchAndShow(buyer, "mini fridge", 2000)).toEqual([]);
  expect(await searchAndShow(seller, "mini fridge", null)).toEqual([]);
  expect(sentTo(buyer)).toHaveLength(0);
  expect((await db.getUser(buyer.id))?.state).toEqual({ kind: "idle" });
});

test("pickResult resolves a 1-based index to proposeMatch, and handles bad or taken picks", async () => {
  const seller = await fakeUser("Sam");
  const buyer = await fakeUser("Maya");
  const listing = await activeListing(seller);
  await searchAndShow(buyer, "mini fridge", null);

  expect(await pickResult(buyer, { index: 5 })).toContain("which one");
  expect(await pickResult(buyer, { index: 1 })).toBe("asked the seller!");
  expect(proposed).toEqual([listing.id]);

  await db.updateListing(listing.id, { status: "held" });
  expect(await pickResult(buyer, { listingId: listing.id })).toContain("just got taken");
  expect(proposed).toHaveLength(1);
});

test("wants: saveWant logs it, cancelWant only closes your own open want", async () => {
  const buyer = await fakeUser("Maya");
  const other = await fakeUser("Sam");
  const want = await saveWant(buyer, "desk lamp", 2000);
  expect(want.status).toBe("open");

  expect(await cancelWant(other, want.id)).toBe(false);
  expect(await cancelWant(buyer, want.id)).toBe(true);
  expect((await db.getWant(want.id))?.status).toBe("closed");
  expect(await cancelWant(buyer, want.id)).toBe(false);
});

test("myStuff lists listings, wants and matches with ids, or 'nothing yet'", async () => {
  const user = await fakeUser("Maya");
  expect(await myStuff(user)).toBe("nothing yet");

  const listing = await activeListing(user);
  const want = await saveWant(user, "desk lamp", 2000);
  const other = await fakeUser("Sam");
  const match = await db.createMatch({ listingId: listing.id, buyerId: user.id, sellerId: other.id });
  activeMatches = [match];

  const text = await myStuff(user);
  expect(text).toContain(`[${listing.id}] mini fridge $45 active`);
  expect(text).toContain(`[${want.id}] desk lamp ≤$20`);
  expect(text).toContain(`[${match.id}] buying mini fridge from Sam (proposed)`);
});
