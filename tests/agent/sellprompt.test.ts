// Prompt rules: ask for a photo when someone wants to sell, and use make_offer for price haggling.
import { expect, test } from "bun:test";
import { buildSystemPrompt } from "../../src/agent/systemPrompt";
import { fakeUser } from "./helpers";

const prompt = async () => buildSystemPrompt({ user: await fakeUser(), stuff: "(nothing yet)" });

test("prompt tells Karl to ask for a photo when a seller has none yet", async () => {
  const p = await prompt();
  expect(p).toContain("send me a photo");
  expect(p).toContain("Never say \"let me know when you want to post it\"");
  expect(p).toContain("never invent a listing without a photo");
  expect(p).toContain("price in the same message");
});

test("prompt routes price haggling through make_offer", async () => {
  const p = await prompt();
  expect(p).toContain("make_offer");
  expect(p).toContain("Never promise a price the seller hasn't agreed to");
  expect(p).not.toContain("X*1.5");
  expect(p).toContain("use X as max_price_dollars");
});

test("prompt stays compact", async () => {
  expect((await prompt()).length).toBeLessThan(6000);
});
