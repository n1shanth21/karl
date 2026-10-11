// First-name step: handled by plain code in inbound.ts, so Gemini must not be called for a bare name.
import { afterAll, beforeEach, expect, mock, spyOn, test } from "bun:test";
import type { Message, Space } from "spectrum-ts";
import { resetGeminiForTests, setGeminiForTests } from "../../src/agent/gemini";
import * as loop from "../../src/agent/loop";
import { LIMITS } from "../../src/config";
import { db } from "../../src/db";
import * as relay from "../../src/flows/relay";
import { handleInbound, parseNameReply } from "../../src/spectrum/inbound";
import { fakeSpace, resetAll, sentTo } from "./helpers";

const PHONE = "+15557654321";
let space: Space;
let n = 0;
const chat = mock(async () => ({ role: "model", parts: [{ text: "gemini reply" }] }));
const runAgentTurn = spyOn(loop, "runAgentTurn");
const routeMessage = spyOn(relay, "routeMessage");
const errors = spyOn(console, "error");

beforeEach(async () => {
  LIMITS.debounceMs = 0;
  await resetAll();
  mock.clearAllMocks();
  space = fakeSpace("space-onboarding");
  setGeminiForTests({ chat, pickRelevant: async () => [], describeItem: async () => null } as never);
  runAgentTurn.mockResolvedValue("agent reply");
  routeMessage.mockResolvedValue("not_relay");
});
afterAll(() => {
  resetGeminiForTests();
  mock.restore();
});

const read = mock(async () => {});
const text = (t: string) =>
  ({ id: `o${++n}`, direction: "inbound", sender: { id: PHONE }, content: { type: "text", text: t }, read }) as unknown as Message;
const send = (t: string) => handleInbound(space, text(t));
const user = async () => (await db.getUserByPhone(PHONE))!;
const sentTexts = () => sentTo({ spaceId: space.id } as never).map((s) => s.text);

test("new user: intro, then a bare first name is saved without Gemini", async () => {
  await send("hi karl");
  expect(sentTexts().at(-1)).toContain("what's your first name");
  expect((await user()).firstName).toBeNull();

  await send("Aayush");
  expect((await user()).firstName).toBe("Aayush");
  expect(sentTexts().at(-1)).toContain("nice to meet you, Aayush");
  expect(chat).not.toHaveBeenCalled();
  expect(runAgentTurn).not.toHaveBeenCalled();
  expect(errors.mock.calls.flat().join(" ")).not.toContain("FALLBACK");
});

test("lowercase and 'my name is' forms work", async () => {
  await send("hi karl");
  await send("my name is aayush");
  expect((await user()).firstName).toBe("Aayush");
  expect(sentTexts().at(-1)).toContain("nice to meet you, Aayush");
});

test("name plus request: name saved and the request still reaches the agent loop", async () => {
  await send("hi karl");
  await send("i'm maya, need a desk lamp");
  expect((await user()).firstName).toBe("Maya");
  expect(runAgentTurn).toHaveBeenCalledTimes(1);
  expect(runAgentTurn.mock.calls[0]![1]).toBe("i'm maya, need a desk lamp");
  expect(sentTexts().at(-1)).toBe("agent reply");
});

test.each(["hi", "thanks", "need a lamp", "selling a desk", "lol", "yes", "idk", "help me", "12345", "@maya"])("%p is not taken as a name", async (t) => {
  await send("hi karl");
  await send(t);
  expect((await user()).firstName).toBeNull();
});

test("parseNameReply rules", () => {
  expect(parseNameReply("Maya Chen")).toEqual({ name: "Maya", rest: "" });
  expect(parseNameReply("Aayush!")).toEqual({ name: "Aayush", rest: "" });
  expect(parseNameReply("im Sam")).toEqual({ name: "Sam", rest: "" });
  expect(parseNameReply("it’s Jo")).toEqual({ name: "Jo", rest: "" });
  expect(parseNameReply("call me Lee")).toEqual({ name: "Lee", rest: "" });
  expect(parseNameReply("i'm good")).toBeNull();
  expect(parseNameReply("need lamp")).toBeNull();
  expect(parseNameReply("Aayush, need a lamp")).toBeNull();
});

test("a named user's bare word is not re-saved as a name", async () => {
  const u = await db.createUser({ phone: PHONE, spaceId: space.id });
  await db.updateUser(u.id, { firstName: "Maya", state: { kind: "idle" } });
  await send("Aayush");
  expect((await user()).firstName).toBe("Maya");
  expect(runAgentTurn).toHaveBeenCalledTimes(1);
});

test("loop logs FALLBACK (error) when chat throws", async () => {
  const u = await db.createUser({ phone: "+15550001111", spaceId: space.id });
  setGeminiForTests({
    chat: async () => {
      throw new Error("boom 503");
    },
  } as never);
  runAgentTurn.mockRestore();
  expect(await loop.runAgentTurn(u, "need a lamp")).toBe("my brain glitched for a sec, try that again?");
  expect(errors.mock.calls.flat().join(" ")).toContain("FALLBACK (error): Error: boom 503");
});
