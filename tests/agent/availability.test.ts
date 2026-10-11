// Meetup scheduling engine: free text -> windows, two people's windows -> shared slots, windows -> words.
import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { resetGeminiForTests, setGeminiForTests } from "../../src/agent/gemini";
import { describeWindows, overlapSlots, parseAvailability, type Window } from "../../src/flows/availability";

afterEach(() => resetGeminiForTests());
afterAll(() => mock.restore());

// The real two-phone test: Saturday Oct 10 2026, 9:27 PM New York (EDT = UTC-4).
const NOW = new Date("2026-10-11T01:27:00Z");
const et = (iso: string) => new Date(`2026-${iso}:00-04:00`); // "10-11T14:00" -> Oct 11, 2:00 PM EDT
const win = (from: string, to: string): Window => ({ start: et(from), end: et(to) });
const iso = (w: Window) => [w.start.toISOString(), w.end.toISOString()];

test("'pit tmr at 6pm' at 9:27pm means tomorrow, not today, and names the Pit", async () => {
  const out = await parseAvailability("pit tmr at 6pm", NOW);
  expect(out.windows.map(iso)).toEqual([iso(win("10-11T18:00", "10-11T19:00"))]);
  expect(out.spot).toBe("the Pit");
});

test("'union at 4pm' at 9:27pm rolls to tomorrow because 4pm today already passed", async () => {
  const out = await parseAvailability("union at 4pm", NOW);
  expect(out.windows.map(iso)).toEqual([iso(win("10-11T16:00", "10-11T17:00"))]);
  expect(out.spot).toBe("Student Union lobby");
});

test("common forms parse without Gemini", async () => {
  setGeminiForTests({ extractAvailability: async () => Promise.reject(new Error("should not be called")) });
  const cases: [string, Window][] = [
    ["tmr after 2", win("10-11T14:00", "10-11T20:00")],
    ["tomorrow 2-5", win("10-11T14:00", "10-11T17:00")],
    ["sat 11-3", win("10-17T11:00", "10-17T15:00")], // it's already Saturday night: next Saturday
    ["sunday 10-12", win("10-11T10:00", "10-11T12:00")],
    ["anytime tomorrow", win("10-11T09:00", "10-11T20:00")],
    ["free after 4", win("10-11T16:00", "10-11T20:00")], // today is over, so tomorrow
  ];
  for (const [text, want] of cases) expect((await parseAvailability(text, NOW)).windows.map(iso)).toEqual([iso(want)]);
});

test("earlier in the day, 'today after 3' starts today and the part before now is dropped", async () => {
  const noon = new Date("2026-10-10T16:00:00Z"); // noon EDT
  expect((await parseAvailability("today after 3", noon)).windows.map(iso)).toEqual([iso(win("10-10T15:00", "10-10T20:00"))]);
  const five = new Date("2026-10-10T21:00:00Z"); // 5pm EDT
  expect((await parseAvailability("free 2-6 today", five)).windows.map(iso)).toEqual([[five.toISOString(), et("10-10T18:00").toISOString()]]);
});

test("clips to 9am-8pm and the next 7 days", async () => {
  expect((await parseAvailability("tomorrow 7am-11am", NOW)).windows.map(iso)).toEqual([iso(win("10-11T09:00", "10-11T11:00"))]);
  expect((await parseAvailability("tomorrow after 9pm", NOW)).windows).toEqual([]);
});

test("DST-safe: Sunday Nov 1 2026 is EST (UTC-5)", async () => {
  const fri = new Date("2026-10-30T16:00:00Z");
  const out = await parseAvailability("sun 11-3", fri);
  expect(iso(out.windows[0]!)).toEqual(["2026-11-01T16:00:00.000Z", "2026-11-01T20:00:00.000Z"]);
});

test("odd phrasing falls back to Gemini; its output is validated and clipped", async () => {
  const seen: string[] = [];
  setGeminiForTests({
    extractAvailability: async (text, nowIso) => {
      seen.push(text, nowIso);
      return {
        windows: [
          { startIso: "2026-10-11T13:00:00-04:00", endIso: "2026-10-11T22:00:00-04:00" }, // clipped to 8pm
          { startIso: "2026-10-09T10:00:00-04:00", endIso: "2026-10-09T12:00:00-04:00" }, // past: dropped
          { startIso: "2026-10-12T15:00:00-04:00", endIso: "2026-10-12T14:00:00-04:00" }, // end before start: dropped
          { startIso: "garbage", endIso: "2026-10-12T14:00:00-04:00" }, // unparseable: dropped
          { startIso: "2026-10-12T10:00:00", endIso: "2026-10-12T11:00:00" }, // no offset: read as New York time
        ],
        spot: "student union",
      };
    },
  });
  const out = await parseAvailability("monday or the day after, whenever honestly", NOW);
  expect(seen).toEqual(["monday or the day after, whenever honestly", NOW.toISOString()]);
  expect(out.windows.map(iso)).toEqual([iso(win("10-11T13:00", "10-11T20:00")), iso(win("10-12T10:00", "10-12T11:00"))]);
  expect(out.spot).toBe("Student Union lobby");
});

test("if Gemini fails, no windows (the caller asks again) but a named spot is kept", async () => {
  setGeminiForTests({ extractAvailability: async () => Promise.reject(new Error("boom")) });
  expect(await parseAvailability("not sure, maybe the pit?", NOW)).toEqual({ windows: [], spot: "the Pit" });
});

test("overlap of tmr 2-8pm and tmr 10-4pm starts at tmr 2pm", () => {
  const slots = overlapSlots([win("10-11T14:00", "10-11T20:00")], [win("10-11T10:00", "10-11T16:00")], NOW);
  expect(slots).toEqual([{ start: et("10-11T14:00"), spot: "the Pit" }]);
});

test("no overlap, or under 30 minutes, gives no slots", () => {
  expect(overlapSlots([win("10-11T18:00", "10-11T19:00")], [win("10-11T16:00", "10-11T17:00")], NOW)).toEqual([]);
  expect(overlapSlots([win("10-11T14:00", "10-11T15:00")], [win("10-11T14:40", "10-11T16:00")], NOW)).toEqual([]);
});

test("slot start rounds up to :00/:30 and is at least 30 minutes from now", () => {
  const w = [win("10-11T14:10", "10-11T16:00")];
  expect(overlapSlots(w, w, NOW)[0]!.start).toEqual(et("10-11T14:30"));
  const soon = new Date("2026-10-11T18:05:00Z"); // 2:05pm EDT -> earliest 2:35 -> 3:00
  expect(overlapSlots(w, w, soon)[0]!.start).toEqual(et("10-11T15:00"));
});

test("a long overlap offers later slots too (limit 3, earliest first); spot preference wins", () => {
  const w = [win("10-11T10:00", "10-11T20:00")];
  const slots = overlapSlots(w, w, NOW, { spotPrefs: ["Davis Library entrance"] });
  expect(slots.map((s) => s.start)).toEqual([et("10-11T10:00"), et("10-11T12:00"), et("10-11T14:00")]);
  expect(slots.every((s) => s.spot === "Davis Library entrance")).toBe(true);
  expect(overlapSlots(w, w, NOW, { limit: 1 })).toHaveLength(1);
});

test("describeWindows reads like a text", () => {
  expect(describeWindows([win("10-11T14:00", "10-11T16:00")], NOW)).toBe("tomorrow 2–4pm");
  expect(describeWindows([win("10-15T11:00", "10-15T15:00")], NOW)).toBe("thu 11am–3pm");
  expect(describeWindows([win("10-17T11:00", "10-17T15:00")], NOW)).toBe("next sat 11am–3pm");
  expect(describeWindows([win("10-11T14:30", "10-11T20:00"), win("10-12T09:00", "10-12T10:00")], NOW)).toBe("tomorrow 2:30–8pm, mon 9–10am");
  expect(describeWindows([win("10-10T22:00", "10-10T23:00")], NOW)).toBe("today 10–11pm");
  expect(describeWindows([], NOW)).toBe("");
});

test("noon reads as 12pm: '10am-noon', 'after noon', 'tmr at noon'", async () => {
  setGeminiForTests({ extractAvailability: async () => Promise.reject(new Error("should not be called")) });
  const cases: [string, Window][] = [
    ["tmr 10am-noon", win("10-11T10:00", "10-11T12:00")],
    ["tmr after noon", win("10-11T12:00", "10-11T20:00")],
    ["tmr at noon", win("10-11T12:00", "10-11T13:00")],
  ];
  for (const [text, want] of cases) expect((await parseAvailability(text, NOW)).windows.map(iso)).toEqual([iso(want)]);
});

test("a named day is the whole day only when nothing else is said; otherwise Gemini decides", async () => {
  const seen: string[] = [];
  setGeminiForTests({ extractAvailability: async (text) => (seen.push(text), { windows: [{ startIso: "2026-10-11T16:00:00-04:00", endIso: "2026-10-11T18:00:00-04:00" }], spot: null }) });
  expect((await parseAvailability("tmr im free", NOW)).windows.map(iso)).toEqual([iso(win("10-11T09:00", "10-11T20:00"))]);
  expect((await parseAvailability("union tomorrow", NOW)).windows.map(iso)).toEqual([iso(win("10-11T09:00", "10-11T20:00"))]);
  expect(seen).toEqual([]);
  for (const text of ["tmr after class", "i have 2 classes tmr", "tmr after my 2pm class"]) {
    expect((await parseAvailability(text, NOW)).windows.map(iso)).toEqual([iso(win("10-11T16:00", "10-11T18:00"))]);
  }
  expect(seen).toHaveLength(3);
});

test("plain chat never costs a Gemini call", async () => {
  const extract = mock(async () => ({ windows: [], spot: null }));
  setGeminiForTests({ extractAvailability: extract });
  for (const text of ["omw", "thanks!", "does it come with the shelf?"]) expect(await parseAvailability(text, NOW)).toEqual({ windows: [], spot: null });
  expect(extract).not.toHaveBeenCalled();
});

test("just after midnight, 'tmr' means the coming daytime (12:30am Sunday -> Sunday)", async () => {
  const lateNight = new Date("2026-10-11T04:30:00Z"); // 12:30am EDT Sunday
  expect((await parseAvailability("tmr after 2", lateNight)).windows.map(iso)).toEqual([iso(win("10-11T14:00", "10-11T20:00"))]);
  expect((await parseAvailability("tmr after 2", NOW)).windows.map(iso)).toEqual([iso(win("10-11T14:00", "10-11T20:00"))]); // 9:27pm Saturday: still Sunday
  const evening = new Date("2026-10-11T23:30:00Z"); // 7:30pm Sunday: tmr is Monday
  expect((await parseAvailability("tmr after 2", evening)).windows.map(iso)).toEqual([iso(win("10-12T14:00", "10-12T20:00"))]);
});
