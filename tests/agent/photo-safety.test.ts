// Photo safety wiring in the inbound pipeline: banned users are ignored, bad photos never reach
// savePhoto / vision, and an explicit photo ends the sender's deals quietly.
import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import type { Message, Space } from "spectrum-ts";
import { registerNotifications } from "../../src/agent/notifications";
import { resetGeminiForTests, setGeminiForTests } from "../../src/agent/gemini";
import * as loop from "../../src/agent/loop";
import { LIMITS } from "../../src/config";
import { db } from "../../src/db";
import { proposeMatch, respondToMatch } from "../../src/flows/match";
import * as photoModule from "../../src/flows/photo";
import * as sell from "../../src/flows/sell";
import * as safety from "../../src/safety";
import { handleInbound } from "../../src/spectrum/inbound";
import type { Listing, User } from "../../src/types";
import { fakeSpace, fakeUser, lastTextTo, resetAll, sentTo } from "./helpers";

registerNotifications();
afterAll(() => {
  mock.restore();
  resetGeminiForTests();
});
afterEach(() => mock.restore());

const NEUTRAL = "heads up, this one fell through. want me to keep looking?";
const BAN_REASON = "nope. that photo is way out of line, so you're done here.";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
let n = 0;
const read = mock(async () => {});

const msg = (user: User, content: unknown) => ({ id: `ps-${++n}`, direction: "inbound", sender: { id: user.phone }, content, read }) as unknown as Message;
const photo = () => ({ type: "attachment", id: "p1", name: "x.jpg", mimeType: "image/jpeg", read: async () => JPEG });
const text = (t: string) => ({ type: "text", text: t });
/** Send as `user` (a fresh fake space, so we can read what they received). */
async function sendAs(user: User, content: unknown): Promise<void> {
  const space: Space = fakeSpace(user.spaceId);
  await handleInbound(space, msg(user, content));
}

let spies: { saveInbound: ReturnType<typeof spyOn>; savePhoto: ReturnType<typeof spyOn>; draft: ReturnType<typeof spyOn>; agent: ReturnType<typeof spyOn> };

beforeEach(async () => {
  LIMITS.debounceMs = 0;
  await resetAll();
  setGeminiForTests({
    describeItem: async () => ({ title: "Desk Lamp", description: "works", category: "desk lamp", condition: "good", priceCents: 1500, confidence: 0.9 }),
  });
  spyOn(photoModule, "toJpeg").mockImplementation(async (bytes) => ({ bytes, mimeType: "image/jpeg" }));
  spies = {
    saveInbound: spyOn(db, "saveInbound"),
    savePhoto: spyOn(db, "savePhoto"),
    draft: spyOn(sell, "draftFromPhoto"),
    agent: spyOn(loop, "runAgentTurn").mockResolvedValue("agent reply"),
  };
});

async function activeListing(seller: User, title = "Mini fridge"): Promise<Listing> {
  const draft = { title, description: "works", category: title.toLowerCase(), condition: "good" as const, priceCents: 4500, confidence: 0.9 };
  const created = await db.createListing({ sellerId: seller.id, draft, photoId: null });
  return db.updateListing(created.id, { status: "active" });
}

test("a banned user is ignored: no reply, nothing saved, no agent, and start does not undo it", async () => {
  const user = await fakeUser("Maya");
  spyOn(safety, "isBanned").mockImplementation((id) => id === user.id);

  await sendAs(user, text("need a lamp"));
  await sendAs(user, photo());
  await db.updateUser(user.id, { optedOut: true });
  await sendAs(user, text("start"));

  expect(sentTo(user)).toHaveLength(0);
  expect(spies.saveInbound).not.toHaveBeenCalled();
  expect(spies.agent).not.toHaveBeenCalled();
  expect((await db.getUser(user.id))!.optedOut).toBe(true);
});

test("a blocked photo tells the sender why and never reaches savePhoto or the drafter", async () => {
  const user = await fakeUser("Maya");
  spyOn(safety, "checkImage").mockResolvedValue({ action: "block", reason: "can't use that photo. send one of just the item 📸", banned: false });

  await sendAs(user, photo());

  expect(lastTextTo(user)).toBe("can't use that photo. send one of just the item 📸");
  expect(sentTo(user)).toHaveLength(1);
  expect(spies.savePhoto).not.toHaveBeenCalled();
  expect(spies.draft).not.toHaveBeenCalled();
});

test("an allowed photo drafts as before, using the bytes that were checked", async () => {
  const user = await fakeUser("Maya");
  const check = spyOn(safety, "checkImage").mockResolvedValue({ action: "allow", banned: false });

  await sendAs(user, photo());

  expect(check).toHaveBeenCalledTimes(1);
  expect(check.mock.calls[0]![0]).toBe(spies.draft.mock.calls[0]![1].bytes);
  expect(spies.savePhoto).toHaveBeenCalledTimes(1);
  expect(lastTextTo(user)).toContain("$15");
  const [draft] = await db.listingsBySeller(user.id, ["draft"]);
  expect(draft?.title).toBe("Desk Lamp");
});

async function explicitPhotoFrom(user: User): Promise<void> {
  spyOn(safety, "checkImage").mockResolvedValue({ action: "block", reason: BAN_REASON, banned: true });
  await sendAs(user, photo());
}

test("explicit photo from a buyer with a held match: match cancelled, item back up, seller told once, buyer's wants closed", async () => {
  const seller = await fakeUser("Jordan");
  const buyer = await fakeUser("Maya");
  const listing = await activeListing(seller);
  const other = await activeListing(seller, "Desk lamp");
  await proposeMatch(buyer, listing);
  await proposeMatch(buyer, other);
  for (const m of await db.activeMatchesForUser(buyer.id)) await respondToMatch(seller, m.id, true);
  expect((await db.getListing(listing.id))!.status).toBe("held");
  const want = await db.createWant({ buyerId: buyer.id, queryText: "desk", maxPriceCents: null });
  const before = sentTo(seller).length;

  await explicitPhotoFrom(buyer);

  expect(lastTextTo(buyer)).toBe(BAN_REASON);
  expect(await db.activeMatchesForUser(buyer.id)).toHaveLength(0);
  expect((await db.getListing(listing.id))!.status).toBe("active");
  expect((await db.getListing(other.id))!.status).toBe("active");
  const told = sentTo(seller).slice(before);
  expect(told.map((t) => t.text)).toEqual([NEUTRAL]); // two matches, one text
  expect((await db.getWant(want.id))!.status).toBe("closed");
  expect(spies.draft).not.toHaveBeenCalled();
});

test("explicit photo from a seller with a held match: match cancelled, buyer told once, listings removed", async () => {
  const seller = await fakeUser("Jordan");
  const buyer = await fakeUser("Maya");
  const listing = await activeListing(seller);
  const spare = await activeListing(seller, "Desk lamp");
  await proposeMatch(buyer, listing);
  const [match] = await db.activeMatchesForUser(buyer.id);
  await respondToMatch(seller, match!.id, true);
  const before = sentTo(buyer).length;

  await explicitPhotoFrom(seller);

  expect(lastTextTo(seller)).toBe(BAN_REASON);
  expect((await db.getMatch(match!.id))!.status).toBe("cancelled");
  expect((await db.getListing(listing.id))!.status).toBe("removed");
  expect((await db.getListing(spare.id))!.status).toBe("removed");
  expect(sentTo(buyer).slice(before).map((t) => t.text)).toEqual([NEUTRAL]);
  expect(sentTo(buyer).map((t) => t.text).join(" ")).not.toContain("photo");
});
