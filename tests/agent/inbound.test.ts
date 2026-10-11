import { registerNotifications } from "../../src/agent/notifications";
import { bus } from "../../src/bus";
import { afterAll, beforeEach, expect, mock, spyOn, test } from "bun:test";
import type { Message, Space } from "spectrum-ts";
import * as loop from "../../src/agent/loop";
import { LIMITS } from "../../src/config";
import { db } from "../../src/db";
import * as buy from "../../src/flows/buy";
import * as match from "../../src/flows/match";
import * as relay from "../../src/flows/relay";
import * as sell from "../../src/flows/sell";
import * as safety from "../../src/safety";
import { handleInbound } from "../../src/spectrum/inbound";
import { createBatcher } from "../../src/spectrum/debounce";
import { lookupRef, rememberRef } from "../../src/spectrum/refs";
import { lastRefTo, sendTo } from "../../src/spectrum/send";
import type { Listing } from "../../src/types";
import { fakeSpace, fakeUser, lastTextTo, resetAll, sentTo } from "./helpers";

// Flows and the agent loop are written by other people: replace them with spies.
const runAgentTurn = spyOn(loop, "runAgentTurn");
const routeMessage = spyOn(relay, "routeMessage");
const draftFromPhoto = spyOn(sell, "draftFromPhoto");
const confirmDraft = spyOn(sell, "confirmDraft");
const checkImage = spyOn(safety, "checkImage");
const respondToMatch = spyOn(match, "respondToMatch");
const confirmHappened = spyOn(match, "confirmHappened");
afterAll(() => mock.restore());

const PHONE = "+15551234567";
let space: Space;
let n = 0;

beforeEach(async () => {
  LIMITS.debounceMs = 0;
  await resetAll();
  mock.clearAllMocks();
  space = fakeSpace("space-inbound");
  runAgentTurn.mockResolvedValue("agent reply");
  routeMessage.mockResolvedValue("not_relay");
  checkImage.mockResolvedValue({ action: "allow", banned: false });
});

const read = mock(async () => {});
const msg = (content: unknown, id = `m${++n}`) => ({ id, direction: "inbound", sender: { id: PHONE }, content, read }) as unknown as Message;
const text = (t: string, id?: string) => msg({ type: "text", text: t }, id);
const send = (m: Message) => handleInbound(space, m);

/** Create the user up front so tests skip the first-contact intro. */
async function returningUser() {
  const user = await db.createUser({ phone: PHONE, spaceId: space.id });
  return db.updateUser(user.id, { firstName: "Maya", state: { kind: "idle" } });
}

test("duplicate message id is ignored", async () => {
  await returningUser();
  await send(text("need a fridge", "dup"));
  await send(text("need a fridge", "dup"));
  expect(runAgentTurn).toHaveBeenCalledTimes(1);
});

test("stop opts out, everything else is ignored, start comes back", async () => {
  const user = await returningUser();
  await send(text("STOP"));
  expect(lastTextTo(user)).toContain("you won't hear from me again");
  expect((await db.getUser(user.id))!.optedOut).toBe(true);

  const before = sentTo(user).length;
  await send(text("need a fridge"));
  expect(sentTo(user).length).toBe(before);
  expect(runAgentTurn).not.toHaveBeenCalled();

  await send(text(" Start "));
  expect((await db.getUser(user.id))!.optedOut).toBe(false);
  expect(lastTextTo(user)).toContain("welcome back");
});

test("help replies without calling the agent", async () => {
  const user = await returningUser();
  await send(text("help"));
  expect(lastTextTo(user)).toContain("send me a photo");
  expect(runAgentTurn).not.toHaveBeenCalled();
});

test("a brand new user who only says hi gets the intro and nothing else", async () => {
  await send(text("hey karl"));
  const user = (await db.getUserByPhone(PHONE))!;
  expect(sentTo(user)).toHaveLength(1);
  expect(lastTextTo(user)).toContain("i'm karl");
  expect(user.state.kind).toBe("idle");
  expect(routeMessage).not.toHaveBeenCalled();
  expect(runAgentTurn).not.toHaveBeenCalled();
});

test("text that isn't a relay goes to the agent and its reply is sent", async () => {
  const user = await returningUser();
  await send(text("need a mini fridge under $60"));
  expect(routeMessage).toHaveBeenCalledWith(expect.objectContaining({ id: user.id }), "need a mini fridge under $60", undefined);
  expect(runAgentTurn).toHaveBeenCalledTimes(1);
  expect(lastTextTo(user)).toBe("agent reply");
});

test("relayed text never reaches the agent", async () => {
  const user = await returningUser();
  routeMessage.mockResolvedValue("relayed");
  await send(text("omw, 5 min"));
  expect(runAgentTurn).not.toHaveBeenCalled();
  expect(sentTo(user)).toHaveLength(0);
});

test("a threaded reply passes the match it answers to the relay", async () => {
  await returningUser();
  rememberRef("relay-msg", { kind: "relay", matchId: "match-7" });
  await send(msg({ type: "reply", content: { type: "text", text: "the pit works" }, target: { id: "relay-msg" } }));
  expect(routeMessage).toHaveBeenCalledWith(expect.anything(), "the pit works", "match-7");
});

test("a photo becomes a draft and the draft message is remembered", async () => {
  const user = await returningUser();
  draftFromPhoto.mockResolvedValue({ ok: true, listing: { id: "listing-1" } as Listing, reply: "mini fridge, good, $45. post it?" });
  const bytes = Buffer.from([1, 2, 3]);
  await send(msg({ type: "attachment", id: "a1", name: "x.heic", mimeType: "image/heic", read: async () => bytes }));

  expect(draftFromPhoto).toHaveBeenCalledWith(expect.anything(), { bytes, mimeType: "image/heic" }, undefined);
  expect(lastTextTo(user)).toBe("mini fridge, good, $45. post it?");
  expect(lookupRef(sentTo(user).at(-1)!.id)).toEqual({ kind: "draft", listingId: "listing-1" });
  expect(runAgentTurn).not.toHaveBeenCalled();
});

test("non-image attachments get a friendly refusal", async () => {
  const user = await returningUser();
  await send(msg({ type: "attachment", id: "a2", name: "memo.m4a", mimeType: "audio/m4a", read: async () => Buffer.from([]) }));
  expect(lastTextTo(user)).toContain("only read texts and photos");
});

test("❤️ on a draft confirms it", async () => {
  const user = await returningUser();
  rememberRef("draft-msg", { kind: "draft", listingId: "listing-1" });
  confirmDraft.mockResolvedValue({ ok: true, listing: { id: "listing-1" } as Listing });
  await send(msg({ type: "reaction", emoji: "❤️", target: { id: "draft-msg" } }));
  expect(confirmDraft).toHaveBeenCalledWith(expect.objectContaining({ id: user.id }), "listing-1");
  expect(lastTextTo(user)).toContain("it's live");
});

test("❤️ on an offer asks the seller and marks that want matched", async () => {
  const user = await returningUser();
  const seller = await fakeUser("Sam");
  const draft = { title: "Mini fridge", description: "works", category: "fridge", condition: "good" as const, priceCents: 4500, confidence: 0.9 };
  const listing = await db.updateListing((await db.createListing({ sellerId: seller.id, draft, photoId: null })).id, { status: "active" });
  const want = await db.createWant({ buyerId: user.id, queryText: "fridge", maxPriceCents: null });
  // Real path: the match_found notification sends the ping (and remembers which want it was for).
  registerNotifications();
  bus.emit("match_found", { wantId: want.id, listingId: listing.id, buyerId: user.id, score: 0.9 });
  for (let i = 0; i < 100 && !lastTextTo(user).includes("want it?"); i++) await new Promise((r) => setTimeout(r, 5));
  const ping = sentTo(user).at(-1)!;
  await send(msg({ type: "reaction", emoji: "❤️", target: { id: ping.id } }));
  expect(lastTextTo(user)).toContain("asked the seller");
  expect((await db.getWant(want.id))?.status).toBe("matched");
});

test("👎 on a match request declines it and sends the reply", async () => {
  const user = await returningUser();
  rememberRef("req-msg", { kind: "match_request", matchId: "match-1" });
  respondToMatch.mockResolvedValue("no worries, i'll let them know");
  await send(msg({ type: "reaction", emoji: "👎", target: { id: "req-msg" } }));
  expect(respondToMatch).toHaveBeenCalledWith(expect.objectContaining({ id: user.id }), "match-1", false);
  expect(lastTextTo(user)).toBe("no worries, i'll let them know");
});

test("reactions on unknown messages are ignored", async () => {
  const user = await returningUser();
  await send(msg({ type: "reaction", emoji: "❤️", target: { id: "who-knows" } }));
  expect(sentTo(user)).toHaveLength(0);
});

test("a burst of two texts is handled as one batch", async () => {
  const user = await returningUser();
  LIMITS.debounceMs = 20;
  await Promise.all([send(text("need a fridge")), send(text("under $60"))]);
  expect(runAgentTurn).toHaveBeenCalledTimes(1);
  expect(runAgentTurn).toHaveBeenCalledWith(expect.objectContaining({ id: user.id }), "need a fridge\nunder $60");
});

test("read receipts and other non-message events are ignored", async () => {
  const user = await returningUser();
  for (const type of ["read", "typing", "edit", "unsend", "poll_option", "rename"]) await send(msg({ type }));
  expect(sentTo(user)).toHaveLength(0);
  expect(runAgentTurn).not.toHaveBeenCalled();
  expect(await db.recentMessages(user.id, 10)).toHaveLength(0);
});

test("a real message is marked read", async () => {
  await returningUser();
  await send(text("need a fridge"));
  expect(read).toHaveBeenCalledTimes(1);
});

test("two batches for one user never overlap", async () => {
  let active = 0;
  let maxActive = 0;
  const order: string[] = [];
  const add = createBatcher<string>(() => 5, async (_key, items) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 30));
    order.push(items.join(","));
    active--;
  });
  const first = add("u1", "a");
  await new Promise((r) => setTimeout(r, 15)); // batch 1 is now being handled
  const second = add("u1", "b");
  await Promise.all([first, second]);
  expect(maxActive).toBe(1);
  expect(order).toEqual(["a", "b"]);
});

test("a throwing batch handler still resolves its waiters and later batches run", async () => {
  const spy = spyOn(console, "error").mockImplementation(() => {});
  let calls = 0;
  const add = createBatcher<string>(() => 0, async () => {
    if (++calls === 1) throw new Error("boom");
  });
  await add("u1", "a");
  await add("u1", "b");
  expect(calls).toBe(2);
  spy.mockRestore();
});

test("two simultaneous first messages from a new phone make one user and one intro", async () => {
  await Promise.all([send(text("hey karl")), send(text("need a fridge"))]);
  const user = (await db.getUserByPhone(PHONE))!;
  expect(sentTo(user).filter((s) => s.text.includes("i'm karl"))).toHaveLength(1);
  expect((await db.getStats()).usersTotal).toBe(1);
});

test("\"yes\" after a draft confirms it without calling the agent loop", async () => {
  const user = await returningUser();
  confirmDraft.mockResolvedValue({ ok: true, listing: { id: "listing-1" } as Listing });
  await sendTo(user, "mini fridge, good, $45. post it?", { ref: { kind: "draft", listingId: "listing-1" } });
  await send(text("yes"));
  expect(confirmDraft).toHaveBeenCalledWith(expect.objectContaining({ id: user.id }), "listing-1");
  expect(lastTextTo(user)).toContain("it's live");
  expect(routeMessage).not.toHaveBeenCalled();
  expect(runAgentTurn).not.toHaveBeenCalled();
  expect(lastRefTo(user.id)).toBeUndefined();
});

test("\"yes it did\" after a check-in counts as happened", async () => {
  const user = await returningUser();
  confirmHappened.mockResolvedValue("nice, glad it worked out");
  await sendTo(user, "did it happen?", { ref: { kind: "checkin", matchId: "match-3" } });
  await send(text("yes it did"));
  expect(confirmHappened).toHaveBeenCalledWith(expect.objectContaining({ id: user.id }), "match-3", true);
  expect(runAgentTurn).not.toHaveBeenCalled();
});

test("\"no\" after a match request declines it", async () => {
  const user = await returningUser();
  respondToMatch.mockResolvedValue("no worries, i'll let them know");
  await sendTo(user, "ok to hold it?", { ref: { kind: "match_request", matchId: "match-1" } });
  await send(text("no"));
  expect(respondToMatch).toHaveBeenCalledWith(expect.objectContaining({ id: user.id }), "match-1", false);
  expect(lastTextTo(user)).toBe("no worries, i'll let them know");
  expect(runAgentTurn).not.toHaveBeenCalled();
});

test("a long answer or a yes with no pending question goes to the agent", async () => {
  const user = await returningUser();
  await send(text("yes"));
  expect(runAgentTurn).toHaveBeenCalledTimes(1);
  await sendTo(user, "ok to hold it?", { ref: { kind: "match_request", matchId: "match-1" } });
  await send(text("yes but can you do 3pm instead of noon"));
  expect(respondToMatch).not.toHaveBeenCalled();
  expect(runAgentTurn).toHaveBeenCalledTimes(2);
});

test("\"yes\" with several results on screen is left to the agent", async () => {
  const user = await returningUser();
  await db.updateUser(user.id, { state: { kind: "choosing_result", listingIds: ["l1", "l2"] } });
  await sendTo(user, "**fridge** · $45", { ref: { kind: "result", listingId: "l2" } });
  await send(text("yes"));
  expect(runAgentTurn).toHaveBeenCalledTimes(1);
});
