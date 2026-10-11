// Who is a mid-deal text for? "ask him for 55" is for Karl, "can you do 55?" is for the other person,
// unclear text asks the classifier, relayed texts get a 👍, and "we did the deal" closes the deal.
import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import type { Message } from "spectrum-ts";
import * as loop from "../../src/agent/loop";
import { resetGeminiForTests, setGeminiForTests } from "../../src/agent/gemini";
import { tools } from "../../src/agent/tools";
import { LIMITS } from "../../src/config";
import { db } from "../../src/db";
import { dealIntent } from "../../src/flows/dealintent";
import { proposeMatch, respondToMatch } from "../../src/flows/match";
import { routeMessage } from "../../src/flows/relay";
import * as safety from "../../src/safety";
import { handleInbound } from "../../src/spectrum/inbound";
import { lookupRef } from "../../src/spectrum/refs";
import { clearLastRef, sendTo } from "../../src/spectrum/send";
import type { Listing, User } from "../../src/types";
import { fakeSpace, fakeUser, lastTextTo, resetAll, sentTo } from "./helpers";

let buyer: User;
let seller: User;
let matchId: string;
let listing: Listing;

async function openDeal() {
  buyer = await fakeUser("Maya");
  seller = await fakeUser("Sam");
  const draft = { title: "Portable Monitor (Innocn)", description: "15 inch", category: "monitor", condition: "good" as const, priceCents: 7000, confidence: 0.9 };
  listing = await db.updateListing((await db.createListing({ sellerId: seller.id, draft, photoId: null })).id, { status: "active" });
  await proposeMatch(buyer, listing);
  matchId = (await db.activeMatchesForUser(buyer.id))[0]!.id;
  await sendTo(seller, await respondToMatch(seller, matchId, true));
  clearLastRef(buyer.id);
  clearLastRef(seller.id);
}

let agent: ReturnType<typeof spyOn>;
beforeEach(async () => {
  LIMITS.debounceMs = 0;
  react.mockClear();
  await resetAll();
  spyOn(safety, "scanRelayMessage").mockResolvedValue({ action: "allow" });
  agent = spyOn(loop, "runAgentTurn").mockResolvedValue("agent reply");
});
afterEach(() => {
  mock.restore();
  resetGeminiForTests();
});

let n = 0;
const react = mock(async (_emoji: string) => {});
const msg = (user: User, text: string) =>
  ({ id: `r${++n}`, direction: "inbound", sender: { id: user.phone }, content: { type: "text", text }, read: async () => {}, react }) as unknown as Message;
const say = (user: User, text: string) => handleInbound(fakeSpace(user.spaceId), msg(user, text));
const seen = async (user: User) => (await db.recentMessages(user.id, 50)).filter((m) => m.direction === "out").map((m) => m.text);
const priceNow = async () => (await db.getListing(listing.id))!.priceCents;

test("dealIntent: third-person instructions are 'instruct', second person is chat", () => {
  for (const t of ["can you ask him for 55", "could you tell her i'm outside", "ask him if it comes with the cable", "tell them i'll be late", "see if he can do 55", "let him know i'm here", "is he ok with 4pm", "does she have a case", "karl, ask him for 50", "ask maya for 55", "offer him 55", "could you offer him 55", "ask if he'd take 55", "ask if she can do 50"]) {
    expect(dealIntent(t, "Portable Monitor", "Maya")).toBe("instruct");
  }
  for (const t of ["can you do 55?", "are you free at 4", "could you tell me where the pit is", "i'll tell him later", "do you have the cable", "see you at 4"]) expect(dealIntent(t, "Portable Monitor", "Maya")).toBeNull();
});

test("dealIntent: broader 'done' phrases, with the same false-positive guards", () => {
  for (const t of ["we did the deal", "we did it!", "we met up and he paid", "we met", "we met and he paid", "deal went through", "he paid me", "i paid him", "handed it over", "all good, it's done"]) expect(dealIntent(t)).toBe("done");
  for (const t of ["got it, thanks", "did we do the deal?", "when we met last time it was fun", "i paid for parking", "got cash, where are you", "i'm here, got the cash on me", "got cash, omw", "got the money ready, at the pit", "i just got paid today, heading over now", "we met yesterday at the career fair", "she paid me back for lunch earlier lol", "i'll pay you when we meet", "if he paid me first i would"]) expect(dealIntent(t)).not.toBe("done");
});

test("'can you ask him for 55' in an accepted $70 deal asks the seller for $55 (not relayed); yes updates the price", async () => {
  await openDeal();
  await say(buyer, "can you ask him for 55");
  expect(agent).not.toHaveBeenCalled();
  expect(lastTextTo(buyer)).toBe("asked them if they'd do $55, i'll let you know");
  const ask = sentTo(seller).at(-1)!;
  expect(ask.text).toBe("Maya asks if you'd do $55 instead of $70 for the portable monitor (innocn). (❤️/yes, no, or reply with a price)");
  expect(lookupRef(ask.id)).toEqual({ kind: "counter", matchId });
  expect((await seen(seller)).some((t) => t.includes("can you ask him"))).toBe(false);
  expect(react).not.toHaveBeenCalled();
  expect(await priceNow()).toBe(7000);

  await say(seller, "yes");
  expect(await priceNow()).toBe(5500);
  expect((await db.getMatch(matchId))!.status).toBe("accepted");
  expect(lastTextTo(seller)).toBe("done, the portable monitor (innocn) is $55 now");
  expect(lastTextTo(buyer)).toBe("Sam said yes, the portable monitor (innocn) is $55 now");
});

test("the seller's 'no' keeps the old price and tells both; a price reply counters", async () => {
  await openDeal();
  await say(buyer, "ask sam for $55 please");
  await say(seller, "no");
  expect(await priceNow()).toBe(7000);
  expect(lastTextTo(seller)).toBe("ok, it stays at $70");
  expect(lastTextTo(buyer)).toBe("Sam passed on $55, so the portable monitor (innocn) stays at $70");

  await say(buyer, "tell him $50");
  await say(seller, "60"); // a price back: the buyer is asked
  expect(lastTextTo(buyer)).toBe("Sam asks if you'd do $60 instead of $70 for the portable monitor (innocn). (❤️/yes, no, or reply with a price)");
  await say(buyer, "yes");
  expect(await priceNow()).toBe(6000);
});

test("a price that is ultimately not agreed is undone if the deal falls through", async () => {
  await openDeal();
  await say(buyer, "can you ask him for 55");
  await say(seller, "yes");
  await say(buyer, "deal's off");
  expect(await priceNow()).toBe(7000);
});

test("'ask maya if it comes with the cable' goes to the agent, and message_counterpart passes it on", async () => {
  await openDeal();
  await say(seller, "ask maya if it comes with the cable");
  expect(agent).toHaveBeenCalledTimes(1);
  expect((await seen(buyer)).some((t) => t.includes("cable"))).toBe(false);
  expect(react).not.toHaveBeenCalled();

  const tool = tools.find((t) => t.name === "message_counterpart")!;
  expect(await tool.run(seller, { match_id: matchId, text: "wants to know if it comes with the cable" })).toEqual({ sent: true });
  expect((await seen(buyer)).at(-1)).toBe("**Sam · portable monitor (innocn)**\nwants to know if it comes with the cable");
  expect(await tool.run(buyer, { match_id: "nope", text: "hi" })).toEqual({ sent: false, reason: "no such deal" });
  // the answer to that question is relayed back, not treated as an answer to Karl
  expect(await routeMessage(buyer, "yes")).toBe("relayed");
});

test("'can you do 55?' is for the other person and is relayed with a 👍", async () => {
  await openDeal();
  await say(buyer, "can you do 55?");
  expect(agent).not.toHaveBeenCalled();
  expect(await seen(seller)).toContain("**Maya · portable monitor (innocn)**\ncan you do 55?");
  expect(react).toHaveBeenCalledTimes(1);
  expect(react).toHaveBeenCalledWith("👍");
  expect(await priceNow()).toBe(7000);
});

test("unclear text asks the classifier; 'karl' goes to the agent, an error or 'counterpart' relays; short chat never asks", async () => {
  await openDeal();
  const classify = mock(async (_text: string, _ctx: unknown) => ({ to: "karl" as const }));
  setGeminiForTests({ classifyDealMessage: classify });
  const unclear = "can he sort the monitor stand situation before saturday";

  expect(await routeMessage(buyer, unclear)).toBe("not_relay");
  expect(classify).toHaveBeenCalledWith(unclear, { item: "portable monitor (innocn)", counterpartName: "Sam", role: "buyer" });

  classify.mockResolvedValueOnce({ to: "counterpart" } as never);
  expect(await routeMessage(buyer, unclear)).toBe("relayed");

  classify.mockRejectedValueOnce(new Error("boom") as never);
  expect(await routeMessage(buyer, unclear)).toBe("relayed");

  classify.mockClear();
  for (const t of ["omw", "ok see you soon at the pit", "do you have the cable", "yeah that works for me then", "thanks so much for waiting around"]) expect(await routeMessage(buyer, t)).toBe("relayed");
  expect(classify).not.toHaveBeenCalled();
});

test("a failed 👍 never breaks the relay", async () => {
  await openDeal();
  react.mockRejectedValueOnce(new Error("no tapbacks today") as never);
  await say(buyer, "can you do 55?");
  expect(await seen(seller)).toContain("**Maya · portable monitor (innocn)**\ncan you do 55?");
});

test("'we did the deal' from either side asks the other side to confirm; 'got it, thanks' is just chat", async () => {
  await openDeal();
  await say(buyer, "we did the deal");
  expect(agent).not.toHaveBeenCalled();
  expect(lastTextTo(buyer)).toBe("nice, marking it done once Sam confirms");
  const ask = sentTo(seller).at(-1)!;
  expect(ask.text).toBe("Maya says the portable monitor (innocn) deal is done. did it sell? (👍 or 👎)");
  expect(lookupRef(ask.id)).toEqual({ kind: "checkin", matchId });
  expect((await db.getMatch(matchId))!.status).toBe("accepted");

  await resetAll();
  await openDeal();
  expect(await routeMessage(seller, "we met and he paid")).toBe("handled");
  expect(sentTo(buyer).at(-1)!.text).toBe("Sam says the portable monitor (innocn) deal is done. did you get it? (👍 or 👎)");

  expect(await routeMessage(buyer, "got it, thanks")).toBe("relayed");
});

test("'offer him 55' and 'ask if he'd take 55' make a $55 ask; they are never relayed", async () => {
  for (const t of ["offer him 55", "could you offer him 55", "ask if he'd take 55"]) {
    await resetAll();
    await openDeal();
    await say(buyer, t);
    expect(lastTextTo(buyer)).toBe("asked them if they'd do $55, i'll let you know");
    expect((await seen(seller)).some((m) => m.includes(t))).toBe(false);
    expect(react).not.toHaveBeenCalled();
  }
});

test("a third-person message that only mentions money is passed on, not repriced", async () => {
  await openDeal();
  for (const t of ["let him know i'm bringing $70 cash", "tell him i only have $20 on me", "tell him i'll bring $50 and the rest in venmo"]) {
    expect(await routeMessage(buyer, t)).not.toBe("handled");
  }
  expect((await seen(seller)).filter((m) => m.includes("asks if you'd do"))).toEqual([]);
  expect(await routeMessage(buyer, "tell him i'm outside")).toBe("relayed");
  expect((await seen(seller)).at(-1)).toBe("**Maya · portable monitor (innocn)**\ni'm outside");
  expect(await routeMessage(buyer, "let him know i'm running late")).toBe("relayed");
  expect((await seen(seller)).at(-1)).toBe("**Maya · portable monitor (innocn)**\ni'm running late");
});

test("a sentence reply with a price counters; chat in between does not bury a bare price", async () => {
  await openDeal();
  await say(buyer, "can you ask him for 55");
  await say(seller, "sure 60");
  expect(await priceNow()).toBe(7000);
  expect(lastTextTo(buyer)).toBe("Sam asks if you'd do $60 instead of $70 for the portable monitor (innocn). (❤️/yes, no, or reply with a price)");
  await say(buyer, "yes");
  expect(await priceNow()).toBe(6000);

  await say(buyer, "ask him for 50");
  await say(buyer, "also i'm in a blue jacket"); // relayed, buries the question
  await say(seller, "55");
  expect(lastTextTo(buyer)).toBe("Sam asks if you'd do $55 instead of $60 for the portable monitor (innocn). (❤️/yes, no, or reply with a price)");
});

test("'60 works' and '55 is fine' answer a price ask", async () => {
  await openDeal();
  await say(buyer, "ask him for 55");
  await say(seller, "55 is fine");
  expect(await priceNow()).toBe(5500);
});

test("an unanswered price ask goes stale after 30 minutes", async () => {
  await openDeal();
  await say(buyer, "ask him for 55");
  const now = Date.now();
  spyOn(Date, "now").mockReturnValue(now + 31 * 60_000);
  await say(buyer, "ask him for 60");
  expect(lastTextTo(buyer)).toBe("asked them if they'd do $60, i'll let you know");
});
