// Name rules: slurs / profanity / fake-official names are never saved or shown.
import { afterAll, beforeEach, expect, mock, spyOn, test } from "bun:test";
import type { Message, Space } from "spectrum-ts";
import { resetGeminiForTests, setGeminiForTests } from "../../src/agent/gemini";
import * as loop from "../../src/agent/loop";
import { tools } from "../../src/agent/tools";
import { LIMITS } from "../../src/config";
import { db } from "../../src/db";
import * as relay from "../../src/flows/relay";
import { acceptableName, displayName, NAME_RETRY } from "../../src/flows/names";
import { firstNameOnly } from "../../src/http/publicStats";
import { handleInbound, parseNameReply } from "../../src/spectrum/inbound";
import { fakeSpace, fakeUser, resetAll, sentTo } from "./helpers";

const PHONE = "+15557654399";
let space: Space;
let n = 0;
const runAgentTurn = spyOn(loop, "runAgentTurn");
const routeMessage = spyOn(relay, "routeMessage");

beforeEach(async () => {
  LIMITS.debounceMs = 0;
  await resetAll();
  mock.clearAllMocks();
  space = fakeSpace("space-names");
  setGeminiForTests({ chat: async () => ({ role: "model", parts: [{ text: "gemini" }] }), pickRelevant: async () => [], describeItem: async () => null } as never);
  runAgentTurn.mockResolvedValue("agent reply");
  routeMessage.mockResolvedValue("not_relay");
});
afterAll(() => {
  resetGeminiForTests();
  mock.restore();
});

test("slurs, leetspeak and stretched variants are rejected", () => {
  for (const bad of ["Nigganth", "N1gganth", "niiigga", "nigga", "Fuckface", "karl", "Admin", "buyer"]) expect(acceptableName(bad)).toBeNull();
});

test("stretched vowels, q-for-g and shorthand slur variants are rejected", () => {
  for (const bad of ["Niigganth", "Niiiggganth", "Niiggganth", "Niqqa", "Niqqer", "Nygga", "Nig", "Nigr", "Shit", "Shithead", "Nazi", "Kyke", "Jap", "Raghead", "Wanker", "Prick", "Phuck", "Fuk", "Biatch", "Chinks", "Kikes", "Coons", "Spics", "Pedo", "Dick", "Dickhead", "Karl"]) {
    expect(acceptableName(bad)).toBeNull();
  }
});

test("real names that contain a bad substring are accepted", () => {
  for (const ok of ["Dickson", "Dickie", "Benedick", "Pornima", "Anal", "Shitij", "Kshitij", "Cumberbatch", "Assad", "Nigel", "Titus", "Hancock", "Peacock", "Karlie", "Anusha"]) expect(acceptableName(ok)).toBe(ok);
});

test("a stored bad name is forgotten on the user's next text, so karl asks again", async () => {
  const u = await fakeUser("Nigganth");
  await db.updateUser(u.id, { spaceId: space.id });
  const msg = { id: "bad1", direction: "inbound", sender: { id: u.phone }, content: { type: "text", text: "hello there" }, read: async () => {} } as unknown as Message;
  await handleInbound(space, msg);
  expect((await db.getUser(u.id))!.firstName).toBeNull();
});

test("firstNameOnly hides a bad stored name on the public dashboard", () => {
  expect(firstNameOnly("Nigganth")).toBe("someone");
  expect(firstNameOnly("Maya Smith")).toBe("Maya");
});

test("real names are accepted", () => {
  for (const ok of ["Nishanth", "Aarush", "Himagna", "Aayush", "Maya", "O'Neil", "Mary-Kate", "Nigam", "Spicer"]) expect(acceptableName(ok)).toBe(ok);
  expect(acceptableName("maya chen")).toBe("Maya");
});

test("displayName falls back for unacceptable stored names", () => {
  expect(displayName({ firstName: "Maya" }, "buyer")).toBe("Maya");
  expect(displayName({ firstName: "Nigganth" }, "buyer")).toBe("buyer");
  expect(displayName({ firstName: null }, "seller")).toBe("seller");
});

test("set_name tool refuses a slur name, saves nothing, returns the neutral reply", async () => {
  const u = await fakeUser(null);
  const setName = tools.find((t) => t.name === "set_name")!;
  const res = (await setName.run(u, { first_name: "Nigganth" })) as { error?: string; say?: string };
  expect(res.say).toBe(NAME_RETRY);
  expect(JSON.stringify(res)).not.toMatch(/nigg/i);
  expect((await db.getUser(u.id))!.firstName).toBeNull();
  expect(await setName.run(u, { first_name: "Nishanth" })).toEqual({ ok: true, first_name: "Nishanth" });
});

test("parseNameReply flags a rejected name but not a non-name", () => {
  expect(parseNameReply("Nigganth")).toEqual({ name: "", rest: "", rejected: true });
  expect(parseNameReply("need lamp")).toBeNull();
});

test("deterministic name reply with a slur: neutral retry, not saved, no Gemini", async () => {
  const msg = (t: string) =>
    ({ id: `n${++n}`, direction: "inbound", sender: { id: PHONE }, content: { type: "text", text: t }, read: async () => {} }) as unknown as Message;
  await handleInbound(space, msg("hey")); // intro asks for a first name
  const u = (await db.getUserByPhone(PHONE))!;
  await handleInbound(space, msg("Nigganth"));
  const texts = sentTo({ spaceId: space.id } as never).map((s) => s.text);
  expect(texts.at(-1)).toBe(NAME_RETRY);
  expect(texts.join("\n")).not.toMatch(/nigg/i);
  expect((await db.getUser(u.id))!.firstName).toBeNull();
  expect(runAgentTurn).not.toHaveBeenCalled();
  await handleInbound(space, msg("Maya"));
  expect((await db.getUser(u.id))!.firstName).toBe("Maya");
});
