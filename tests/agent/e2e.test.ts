// End-to-end: two phones (buyer Maya, seller Jordan) talk to Karl through the public entry
// handleInbound() only. Real db (memory), real flows, real relay, real notifications.
// Only Gemini is faked (scripted), so we can see exactly where Karl calls it.
import { afterAll, beforeAll, expect, mock, setSystemTime, spyOn, test } from "bun:test";
import type { Content } from "@google/genai";
import type { Message, Space } from "spectrum-ts";
import { registerNotifications } from "../../src/agent/notifications";
import { resetGeminiForTests, setGeminiForTests } from "../../src/agent/gemini";
import { bus } from "../../src/bus";
import { LIMITS } from "../../src/config";
import { db } from "../../src/db";
import { setResultPauseForTests } from "../../src/flows/buy";
import * as safety from "../../src/safety";
import { handleInbound } from "../../src/spectrum/inbound";
import { lookupRef } from "../../src/spectrum/refs";
import type { User } from "../../src/types";
import { fakeSpace, resetAll, sentTo } from "./helpers";

spyOn(safety, "checkImage").mockResolvedValue({ action: "allow", banned: false }); // photo check is covered in photo-safety.test.ts
registerNotifications(); // once: the bus is process-wide

// Weekday noon in New York (Wed 2026-10-14, EDT), so "2:30pm" is a valid daytime meetup.
const NOON_ET = new Date("2026-10-14T12:00:00-04:00");
const MEETUP_AT = "2026-10-14T14:30:00-04:00";

const MAYA_PHONE = "+19195550101";
const JORDAN_PHONE = "+19195550102";
const mayaSpace: Space = fakeSpace("space-e2e-maya");
const jordanSpace: Space = fakeSpace("space-e2e-jordan");

// ---- scripted Gemini ------------------------------------------------------------------------
type ChatReq = { system: string; contents: Content[]; tools: unknown[] };
type Turn = (req: ChatReq) => Content;
const chatQueue: Turn[] = [];
const chatCalls: { step: string; req: ChatReq }[] = [];
const describeCalls: { caption?: string; bytes: number }[] = [];
let step = "setup";

const call = (name: string, args: Record<string, unknown>): Content => ({ role: "model", parts: [{ functionCall: { name, args } }] });
const say = (text: string): Content => ({ role: "model", parts: [{ text }] });
const lastContent = (req: ChatReq) => req.contents.at(-1)!;
const toolResult = (req: ChatReq) => lastContent(req).parts?.[0]?.functionResponse;

setGeminiForTests({
  pickRelevant: async (_request, titles) => titles.map((_, i) => i),
  describeItem: async (jpeg, caption) => {
    describeCalls.push({ caption, bytes: jpeg.length });
    return { title: "Desk Lamp", description: "works great", category: "desk lamp", condition: "good", priceCents: 1500, confidence: 0.9 };
  },
  chat: async (req) => {
    chatCalls.push({ step, req });
    const turn = chatQueue.shift();
    if (!turn) throw new Error(`unscripted Gemini chat call in step "${step}"`);
    return turn(req);
  },
});

beforeAll(async () => {
  await resetAll();
  LIMITS.debounceMs = 0;
  setResultPauseForTests(0);
  setSystemTime(NOON_ET);
});
afterAll(() => {
  setSystemTime();
  mock.restore();
  resetGeminiForTests();
});

// ---- fake phones ----------------------------------------------------------------------------
let n = 0;
const read = mock(async () => {});
const msg = (phone: string, content: unknown) => ({ id: `e2e-${++n}`, direction: "inbound", sender: { id: phone }, content, read }) as unknown as Message;
const text = (t: string) => ({ type: "text", text: t });
const tapback = (emoji: string, targetId: string) => ({ type: "reaction", emoji, target: { id: targetId } });
const photo = () => ({ type: "attachment", id: "photo-1", name: "lamp.jpg", mimeType: "image/jpeg", read: async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });

const maya = (content: unknown) => handleInbound(mayaSpace, msg(MAYA_PHONE, content));
const jordan = (content: unknown) => handleInbound(jordanSpace, msg(JORDAN_PHONE, content));
const userOf = async (phone: string): Promise<User> => (await db.getUserByPhone(phone))!;

type Built = { type: string; markdown?: string; name?: string };
/** What a phone actually received: plain text, or the built markdown / attachment. */
async function received(user: User): Promise<{ text: string; built?: Built }[]> {
  return Promise.all(
    sentTo(user).map(async (s) => {
      const raw = s.raw as { build?: () => Promise<Built> };
      if (typeof raw === "string" || !raw.build) return { text: s.text };
      const built = await raw.build();
      return { text: built.markdown ?? s.text, built };
    }),
  );
}
const texts = async (user: User) => (await received(user)).map((r) => r.text);
const lastText = async (user: User) => (await texts(user)).at(-1) ?? "";

/** Bus handlers (proactive texts) run in the background: wait for them like a person waits for a buzz. */
async function waitFor(what: string, cond: () => Promise<boolean> | boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for: ${what}`);
}

const chatCallsIn = (s: string) => chatCalls.filter((c) => c.step === s).length;

test("a desk lamp goes from photo to sold, across two phones, through handleInbound only", async () => {
  // ---------------------------------------------------------------- 1. Maya (new) says hi
  step = "1 hi";
  await maya(text("hi"));
  const mayaUser = await userOf(MAYA_PHONE);
  expect(await texts(mayaUser)).toHaveLength(1);
  expect(await lastText(mayaUser)).toContain("i'm karl");
  expect(chatCalls).toHaveLength(0);
  // Names only get saved if Gemini calls set_name; skip that detour so relay labels read "Maya" / "Jordan".
  await db.updateUser(mayaUser.id, { firstName: "Maya" });

  // ---------------------------------------------------------------- 2. Maya wants a lamp: search -> nothing -> want saved
  step = "2 want";
  chatQueue.push(
    (req) => {
      expect(lastContent(req)).toEqual({ role: "user", parts: [{ text: "need a desk lamp under $20" }] });
      return call("search", { query: "desk lamp", max_price_dollars: 20 });
    },
    (req) => {
      expect(toolResult(req)?.name).toBe("search");
      expect(toolResult(req)?.response).toEqual({ found: 0, saved_want: true });
      return say("nothing yet, but i'll text you as soon as someone lists a desk lamp");
    },
  );
  await maya(text("need a desk lamp under $20"));
  expect(chatCallsIn(step)).toBe(2);
  expect(chatQueue).toHaveLength(0);
  expect(await lastText(mayaUser)).toBe("nothing yet, but i'll text you as soon as someone lists a desk lamp");
  const wants = await db.openWantsByBuyer(mayaUser.id);
  expect(wants).toHaveLength(1);
  expect(wants[0]).toMatchObject({ queryText: "desk lamp", maxPriceCents: 2000 });

  // ---------------------------------------------------------------- 3. Jordan (new) sends a photo + caption
  step = "3 photo";
  LIMITS.debounceMs = 25; // photo and caption are two messages; give them a moment to land in one batch
  await Promise.all([jordan(photo()), jordan(text("selling this"))]);
  LIMITS.debounceMs = 0;
  const jordanUser = await userOf(JORDAN_PHONE);
  await db.updateUser(jordanUser.id, { firstName: "Jordan" });
  expect(describeCalls).toEqual([{ caption: "selling this", bytes: 4 }]);
  const jordanMsgs = await texts(jordanUser);
  expect(jordanMsgs).toHaveLength(2);
  expect(jordanMsgs[0]).toContain("i'm karl");
  expect(jordanMsgs[1]).toMatch(/^desk lamp, good, \$15\. post it\?/);
  expect(lookupRef(sentTo(jordanUser).at(-1)!.id)).toMatchObject({ kind: "draft" });
  expect(chatCalls).toHaveLength(2); // still only step 2's calls

  // ---------------------------------------------------------------- 4. Jordan says yes: live, and Maya is pinged proactively
  step = "4 confirm";
  const mayaBefore = sentTo(mayaUser).length;
  await jordan(text("yes"));
  expect(await lastText(jordanUser)).toContain("it's live");
  const [listing] = await db.listingsBySeller(jordanUser.id, ["active"]);
  expect(listing).toMatchObject({ title: "Desk Lamp", priceCents: 1500, status: "active" });
  await waitFor("Maya's offer (photo + text)", async () => sentTo(mayaUser).length >= mayaBefore + 2);
  await waitFor("Maya in choosing_result", async () => (await userOf(MAYA_PHONE)).state.kind === "choosing_result");
  const offer = (await received(mayaUser)).slice(mayaBefore);
  expect(offer[0]!.built?.type).toBe("attachment");
  expect(offer[1]!.text).toBe("someone just listed a desk lamp, $15. want it? (❤️ or yes)");
  expect(chatCalls).toHaveLength(2);
  expect(describeCalls).toHaveLength(1);

  // ---------------------------------------------------------------- 5. Maya says yes: Jordan gets the match request
  step = "5 request";
  await maya(text("yes"));
  expect(await lastText(mayaUser)).toContain("asked the seller");
  expect(await lastText(jordanUser)).toBe("someone wants your desk lamp at $15. ok to hold it for them for 2 hrs? (❤️ or yes)");
  const requestMsgId = sentTo(jordanUser).at(-1)!.id;
  expect(lookupRef(requestMsgId)).toMatchObject({ kind: "match_request" });
  expect(chatCalls).toHaveLength(2);

  // ---------------------------------------------------------------- 6. Jordan taps ❤️ on the request: accepted, both get a meetup proposal
  step = "6 accept";
  await jordan(tapback("❤️", requestMsgId));
  const [match] = await db.activeMatchesForUser(mayaUser.id);
  expect(match).toMatchObject({ status: "accepted", buyerId: mayaUser.id, sellerId: jordanUser.id });
  expect((await db.getListing(listing!.id))!.status).toBe("held");
  const proposal = "the Pit at 1pm or Student Union lobby at 2pm? or suggest a time";
  expect(await lastText(mayaUser)).toContain("Jordan said yes, the desk lamp is held for you");
  expect(await lastText(mayaUser)).toContain(proposal);
  expect(await lastText(jordanUser)).toContain("held the desk lamp for Maya");
  expect(await lastText(jordanUser)).toContain(proposal);
  expect(chatCalls).toHaveLength(2);

  // ---------------------------------------------------------------- 7. Maya picks the Pit at 2:30: Gemini calls set_meetup
  step = "7 meetup";
  chatQueue.push(
    (req) => {
      expect(lastContent(req)).toEqual({ role: "user", parts: [{ text: "the pit at 2:30 works" }] });
      return call("set_meetup", { match_id: match!.id, spot: "the Pit", time_iso: MEETUP_AT });
    },
    (req) => {
      expect(toolResult(req)?.name).toBe("set_meetup");
      expect(JSON.stringify(toolResult(req)?.response)).toContain("meetup set: the Pit at 2:30pm");
      return say("locked in, the pit at 2:30. see you there");
    },
  );
  await maya(text("the pit at 2:30 works"));
  expect(chatCallsIn(step)).toBe(2);
  expect(chatQueue).toHaveLength(0);
  expect(await lastText(mayaUser)).toBe("locked in, the pit at 2:30. see you there");
  expect(await db.getMatch(match!.id)).toMatchObject({ status: "meetup_set", meetupSpot: "the Pit", meetupAt: new Date(MEETUP_AT) });
  expect(await lastText(jordanUser)).toBe("meetup set: the Pit at 2:30pm, for the desk lamp. text me if plans change.");

  // ---------------------------------------------------------------- 8. Maya texts "omw": relayed, labeled, no phone number
  step = "8 relay omw";
  await maya(text("omw"));
  expect(await lastText(jordanUser)).toBe("**Maya · desk lamp**\nomw");
  expect((await received(jordanUser)).at(-1)!.built?.type).toBe("markdown");
  expect(await lastText(jordanUser)).not.toMatch(/\d/); // no digits at all, so no piece of her number can leak
  expect(chatCalls).toHaveLength(4); // routing is plain code

  // ---------------------------------------------------------------- 9. Jordan texts "venmo me first pls"
  step = "9 relay venmo";
  await jordan(text("venmo me first pls"));
  // Real safety (Aarush) WARNS on pay-first: the message is still relayed, then Maya gets a heads-up.
  const mayaTexts = (await texts(mayaUser)).slice(-2);
  expect(mayaTexts[0]).toBe("**Jordan · desk lamp**\nvenmo me first pls");
  expect(mayaTexts[1]).toMatch(/^heads up: only pay once/);
  expect(chatCalls).toHaveLength(4);

  // ---------------------------------------------------------------- 10. Timer fires the check-in; both say yep: sold, both thanked
  step = "10 checkin";
  bus.emit("meetup_checkin_due", { matchId: match!.id });
  await waitFor("both check-ins", async () =>
    (await lastText(mayaUser)).includes("handoff happen?") && (await lastText(jordanUser)).includes("handoff happen?"));
  expect(await lastText(mayaUser)).toBe("did the desk lamp handoff happen? (👍 or 👎)");
  expect(await lastText(jordanUser)).toBe("did the desk lamp handoff happen? (👍 or 👎)");

  await maya(text("yep"));
  expect(await lastText(mayaUser)).toBe("thanks! waiting to hear from the other side too");
  expect((await db.getMatch(match!.id))!.status).toBe("meetup_set");
  await jordan(text("yep"));

  expect((await db.getMatch(match!.id))!.status).toBe("completed");
  expect((await db.getListing(listing!.id))!.status).toBe("sold");
  expect(await lastText(jordanUser)).toBe("sold! thanks for selling your desk lamp through me");
  expect(await lastText(mayaUser)).toBe("enjoy the desk lamp! thanks for using karl");
  expect((await db.getWant((wants[0]!).id))!.status).toBe("matched");
  expect(await db.activeMatchesForUser(mayaUser.id)).toHaveLength(0);

  // ---------------------------------------------------------------- Gemini was only used where expected
  expect(chatCalls.map((c) => c.step)).toEqual(["2 want", "2 want", "7 meetup", "7 meetup"]);
  expect(chatQueue).toHaveLength(0);
  expect(describeCalls).toHaveLength(1);

  // ---------------------------------------------------------------- privacy sweep: nobody ever saw the other's number
  const everything = async (u: User) => [...(await texts(u)), JSON.stringify(sentTo(u).map((s) => s.text))].join("\n");
  for (const digits of ["5550101", "9195550101", "+19195550101"]) expect(await everything(jordanUser)).not.toContain(digits);
  for (const digits of ["5550102", "9195550102", "+19195550102"]) expect(await everything(mayaUser)).not.toContain(digits);
});
