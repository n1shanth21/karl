// Gemini must know the current date/time so "tmr" never resolves to a time that already passed.
import { afterEach, beforeEach, expect, mock, setSystemTime, spyOn, test } from "bun:test";
import { buildSystemPrompt } from "../../src/agent/systemPrompt";
import { tools } from "../../src/agent/tools";
import { db } from "../../src/db";
import * as photo from "../../src/flows/photo";
import { proposeMatch, respondToMatch } from "../../src/flows/match";
import { onSlotVote } from "../../src/flows/scheduling";
import * as safety from "../../src/safety";
import { lookupRef } from "../../src/spectrum/refs";
import { fakeUser, resetAll, sentTo } from "./helpers";

const NINE_27_PM = new Date("2026-10-11T01:27:00Z"); // Saturday Oct 10, 9:27 PM EDT

beforeEach(async () => {
  setSystemTime(NINE_27_PM);
  await resetAll();
  spyOn(safety, "scanRelayMessage").mockResolvedValue({ action: "allow" });
  spyOn(photo, "photoAttachment").mockResolvedValue(null);
});

afterEach(() => {
  mock.restore();
  setSystemTime();
});

test("system prompt has the ET now line and the relative-day rule", async () => {
  const p = buildSystemPrompt({ user: await fakeUser(), stuff: "(nothing yet)", now: NINE_27_PM });
  expect(p).toContain("now: Saturday, Oct 10 2026, 9:27 PM (America/New_York)");
  expect(p).toContain("relative to the \"now\" line");
  expect(p).toContain("Never call a time \"already passed\" unless it is before now");
  expect(p).toContain("Karl asks both people when they're free");
});

test("set_meetup with a time that already passed today resolves to tomorrow", async () => {
  const buyer = await fakeUser("Maya");
  const seller = await fakeUser("Sam");
  const draft = { title: "Mini fridge", description: "works", category: "fridge", condition: "good" as const, priceCents: 4500, confidence: 0.9 };
  const listing = await db.updateListing((await db.createListing({ sellerId: seller.id, draft, photoId: null })).id, { status: "active" });
  await proposeMatch(buyer, listing);
  const [match] = await db.activeMatchesForUser(buyer.id);
  await respondToMatch(seller, match!.id, true);

  const setMeetup = tools.find((t) => t.name === "set_meetup")!;
  expect(setMeetup.description).toContain("America/New_York");
  await setMeetup.run(buyer, { match_id: match!.id, spot: "the Pit", time_iso: "2026-10-10T16:00:00-04:00" }); // 4pm today, already passed
  // set_meetup only PROPOSES: the seller is asked about 4pm tomorrow, and it locks when they 👍
  const ask = sentTo(seller).at(-1)!;
  expect(ask.text).toContain("tomorrow at 4pm");
  expect(lookupRef(ask.id)).toMatchObject({ kind: "meetup_slot", start: "2026-10-11T20:00:00.000Z" });
  await onSlotVote(seller, match!.id, true);
  expect((await db.getMatch(match!.id))?.meetupAt?.toISOString()).toBe("2026-10-11T20:00:00.000Z");
});
