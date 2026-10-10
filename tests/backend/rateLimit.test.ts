// Tests for allowMessage: sliding 10-minute window per user.
import { expect, test } from "bun:test";
import { LIMITS } from "../../src/config";
import { allowMessage } from "../../src/safety";

const MAX = LIMITS.rateLimitMessagesPer10Min;
const MIN = 60 * 1000;

test("allows up to the limit, then throttles", () => {
  const start = 1_000_000;
  for (let i = 0; i < MAX; i++) expect(allowMessage("rl-a", start + i)).toBe(true);
  expect(allowMessage("rl-a", start + MAX)).toBe(false);
});

test("lets the user back in once old messages leave the 10-minute window", () => {
  const start = 1_000_000;
  for (let i = 0; i < MAX; i++) allowMessage("rl-b", start);
  expect(allowMessage("rl-b", start + 9 * MIN)).toBe(false);
  expect(allowMessage("rl-b", start + 10 * MIN)).toBe(true);
});

test("throttled messages don't extend the wait", () => {
  const start = 1_000_000;
  for (let i = 0; i < MAX; i++) allowMessage("rl-c", start);
  for (let i = 0; i < 50; i++) allowMessage("rl-c", start + 5 * MIN); // spam while blocked
  expect(allowMessage("rl-c", start + 10 * MIN)).toBe(true);
});

test("one user hitting the limit doesn't affect another", () => {
  const start = 1_000_000;
  for (let i = 0; i < MAX + 5; i++) allowMessage("rl-d", start);
  expect(allowMessage("rl-e", start)).toBe(true);
});
