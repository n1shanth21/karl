// Mid-deal texts: Karl reads "deal's off", "sale is done", "i'm selling a mac mini" and "karl" instead of relaying everything.
import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import type { Message } from "spectrum-ts";
import * as loop from "../../src/agent/loop";
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

async function openDeal(sellerName: string | null = "Sam") {
  buyer = await fakeUser("Maya");
  seller = await fakeUser(sellerName);
  const draft = { title: "Portable Monitor (Innocn)", description: "15 inch", category: "monitor", condition: "good" as const, priceCents: 6000, confidence: 0.9 };
  listing = await db.updateListing((await db.createListing({ sellerId: seller.id, draft, photoId: null })).id, { status: "active" });
  await proposeMatch(buyer, listing);
  matchId = (await db.activeMatchesForUser(buyer.id))[0]!.id;
  await sendTo(seller, await respondToMatch(seller, matchId, true)); // the inbound pipeline sends the accepter's reply
  clearLastRef(buyer.id);
  clearLastRef(seller.id);
}

beforeEach(async () => {
  LIMITS.debounceMs = 0;
  await resetAll();
  spyOn(safety, "scanRelayMessage").mockResolvedValue({ action: "allow" });
});
afterEach(() => mock.restore());

let n = 0;
const read = mock(async () => {});
const msg = (user: User, content: unknown) => ({ id: `d${++n}`, direction: "inbound", sender: { id: user.phone }, content, read }) as unknown as Message;
const say = (user: User, t: string) => handleInbound(fakeSpace(user.spaceId), msg(user, { type: "text", text: t }));
const tapback = (user: User, emoji: string, targetId: string) => handleInbound(fakeSpace(user.spaceId), msg(user, { type: "reaction", emoji, target: { id: targetId } }));
const seen = async (user: User) => (await db.recentMessages(user.id, 50)).filter((m) => m.direction === "out").map((m) => m.text);

test("the real bug: new sell request goes to Karl, chat is relayed, 'we're done' calls the deal off", async () => {
  await openDeal();
  const agent = spyOn(loop, "runAgentTurn").mockResolvedValue("agent reply");

  await say(seller, "I'm selling my Mac mini");
  expect(agent).toHaveBeenCalledTimes(1);
  expect((await seen(buyer)).some((t) => t.includes("Mac mini"))).toBe(false);

  await say(seller, "Hello");
  expect(agent).toHaveBeenCalledTimes(1);
  expect(await seen(buyer)).toContain("**Sam · portable monitor (innocn)**\nHello");

  await say(seller, "Me and this buyer are done. Let's move on");
  expect(agent).toHaveBeenCalledTimes(1);
  expect((await db.getMatch(matchId))!.status).toBe("cancelled");
  expect((await db.getListing(listing.id))!.status).toBe("active");
  expect(lastTextTo(buyer)).toContain("had to cancel");
  expect(lastTextTo(seller)).toBe("got it, called off the portable monitor (innocn) deal. it's back up");
  expect((await seen(buyer)).some((t) => t.includes("Let's move on"))).toBe(false);
});

test("'sale is done, thank you karl' asks the other side to confirm; their 👍 completes the sale", async () => {
  await openDeal();
  const agent = spyOn(loop, "runAgentTurn").mockResolvedValue("agent reply");
  await say(seller, "Ok sale is done. Thank you Karl!");
  expect(agent).not.toHaveBeenCalled();
  expect(lastTextTo(seller)).toBe("nice, marking it done once Maya confirms");
  const ask = sentTo(buyer).at(-1)!;
  expect(ask.text).toBe("Sam says the portable monitor (innocn) deal is done. did you get it? (👍 or 👎)");
  expect(lookupRef(ask.id)).toEqual({ kind: "checkin", matchId });
  expect((await db.getMatch(matchId))!.status).toBe("accepted");

  await tapback(buyer, "👍", ask.id);
  expect((await db.getMatch(matchId))!.status).toBe("completed");
  expect((await db.getListing(listing.id))!.status).toBe("sold");
});

test("saying 'karl' mid-deal is for Karl, and the buyer's 'deal's off' cancels too", async () => {
  await openDeal();
  expect(await routeMessage(buyer, "thanks karl")).toBe("not_relay");
  expect(await routeMessage(buyer, "deal's off")).toBe("handled");
  expect((await db.getMatch(matchId))!.status).toBe("cancelled");
  expect(lastTextTo(buyer)).toBe("got it, called off the portable monitor (innocn) deal. i'll keep looking");
  expect(lastTextTo(seller)).toContain("had to cancel");
});

test("selling the current item is chat, not a new request", async () => {
  await openDeal();
  expect(await routeMessage(seller, "selling this monitor with the cable")).toBe("relayed");
});

test("the first relay tells the sender how to reach Karl, exactly once", async () => {
  await openDeal();
  await routeMessage(buyer, "does it have hdmi?");
  expect(lastTextTo(buyer)).toBe("(i forward messages to the seller and 👍 them. say 'karl' or 'ask him…' to talk to me)");
  await routeMessage(buyer, "and a case?");
  await routeMessage(seller, "yes to both");
  const hints = (await seen(buyer)).filter((t) => t.includes("say 'karl'"));
  expect(hints).toHaveLength(1);
  expect((await seen(seller)).filter((t) => t.includes("say 'karl'"))).toHaveLength(1); // one per sender
});

test("accepting with a nameless seller asks for a first name, and the answer is captured", async () => {
  await openDeal(null);
  const asks = (await seen(seller)).filter((t) => t.includes("first name"));
  expect(asks).toHaveLength(1);
  expect(asks[0]).toContain("what first name should i show the buyer?");
  await say(seller, "Aarush");
  expect((await db.getUser(seller.id))!.firstName).toBe("Aarush");
});

test("dealIntent: each family", () => {
  for (const t of ["Ok sale is done. Thank you Karl!", "the deal's done", "deal is complete", "sold it", "picked it up", "we handed it off", "we're all set"]) expect(dealIntent(t)).toBe("done");
  for (const t of ["Me and this buyer are done. Let's move on", "deal's off", "we're done with this buyer", "backing out", "i don't want it anymore", "no longer interested", "no longer selling"]) expect(dealIntent(t)).toBe("off");
  for (const t of ["I’m selling my Mac mini", "im selling a lamp", "want to sell my desk", "looking for a mini fridge", "I need a lamp", "anyone selling a bike", "want to buy a chair"]) expect(dealIntent(t)).toBe("new_request");
  for (const t of ["thanks karl", "hey Karl", "Karl help"]) expect(dealIntent(t)).toBe("to_karl");
});

test("dealIntent: done beats off, done/off beat karl, the current item keeps selling talk as chat", () => {
  expect(dealIntent("sale is done, let's move on")).toBe("done");
  expect(dealIntent("we're done with this buyer karl")).toBe("off");
  expect(dealIntent("I'm selling this monitor", "Portable Monitor (Innocn)")).toBeNull();
  expect(dealIntent("I'm selling my Mac mini", "Portable Monitor (Innocn)")).toBe("new_request");
});

test("dealIntent: ordinary chat is null", () => {
  for (const t of ["are you done with class?", "i'm looking forward to it", "do you need a bag?", "Hello", "omw, 5 min", "i need a minute", "looking for you at the pit", "see you at 4", "i got it covered, i'll bring cash", "never mind, i have one", "changed my mind, can we do 4 instead", "3pm is not happening, 5?", "we're done! thanks", "got it, thanks", "ok i got it", "cool we're all set for 3", "looking for parking now", "looking for the entrance", "i'll need a receipt", "you'll need a cable", "we need a place to meet", "i need an hour"]) expect(dealIntent(t)).toBeNull();
});

test("title filler and substrings don't hide a new request", () => {
  expect(dealIntent("I'm selling my mac mini with the charger", "Desk lamp with bulb")).toBe("new_request");
  expect(dealIntent("I'm selling my notebook", "Book")).toBe("new_request");
});

test("'deal's off' typed after a slot proposal or check-in ask is not read as a yes", async () => {
  await openDeal();
  const agent = spyOn(loop, "runAgentTurn").mockResolvedValue("agent reply");
  await sendTo(buyer, "the pit tmr 2pm? 👍/👎", { ref: { kind: "meetup_slot", matchId, spot: "The Pit", start: new Date(Date.now() + 86_400_000).toISOString() } });
  await say(buyer, "deal's off");
  expect((await db.getMatch(matchId))!.status).toBe("cancelled");
  expect(agent).not.toHaveBeenCalled();
});

test("a checkin dispute 'deal's off' cancels instead of completing the sale", async () => {
  await openDeal();
  await sendTo(buyer, "did you get it? (👍 or 👎)", { ref: { kind: "checkin", matchId } });
  await say(buyer, "deal's off");
  expect((await db.getMatch(matchId))!.status).toBe("cancelled");
  expect((await db.getListing(listing.id))!.status).toBe("active");
});

test("a nameless side's one-word availability answer is not saved as a name", async () => {
  await openDeal(null);
  await sendTo(seller, "when are you free? quick q, what first name should i show the buyer?");
  await say(seller, "Saturday");
  expect((await db.getUser(seller.id))!.firstName).toBeNull();
  expect(lastTextTo(seller)).not.toContain("nice to meet you");
});

test("a name given mid-deal gets a short thanks, not the onboarding line", async () => {
  await openDeal(null);
  await say(seller, "Aarush");
  expect(lastTextTo(seller)).toBe("thanks, Aarush!");
});

test("done/off with two active deals goes to the agent, not 'which one' forever", async () => {
  await openDeal();
  const seller2 = await fakeUser("Pat");
  const l2 = await db.updateListing((await db.createListing({ sellerId: seller2.id, draft: { title: "Lamp", description: "", category: "lamp", condition: "good" as const, priceCents: 500, confidence: 0.9 }, photoId: null })).id, { status: "active" });
  await proposeMatch(buyer, l2);
  const m2 = (await db.activeMatchesForUser(buyer.id)).find((m) => m.listingId === l2.id)!;
  await respondToMatch(seller2, m2.id, true);
  expect(await routeMessage(buyer, "deal's off")).toBe("not_relay");
});
