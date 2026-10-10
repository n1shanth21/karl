// Tests for checkImage + isBanned. Gemini is faked; no network calls.
import { expect, test } from "bun:test";
import { checkImage, isBanned } from "../../src/safety";
import type { ImageClassifier, ImageLabel } from "../../src/safety/image";

const PHOTO = new Uint8Array([1, 2, 3]);

function fake(label: ImageLabel): ImageClassifier {
  return async () => label;
}

test("ok photo is allowed, no ban", async () => {
  const v = await checkImage(PHOTO, "image/heic", "user-ok", fake("ok"));
  expect(v).toEqual({ action: "allow", banned: false });
  expect(isBanned("user-ok")).toBe(false);
});

test("explicit photo is blocked and the sender is banned", async () => {
  const v = await checkImage(PHOTO, "image/heic", "user-explicit", fake("explicit"));
  expect(v.action).toBe("block");
  expect(v.banned).toBe(true);
  expect(v.reason).toContain("you're done");
  expect(isBanned("user-explicit")).toBe(true);
});

test("a banned user stays banned even after sending a normal photo", async () => {
  await checkImage(PHOTO, "image/jpeg", "user-repeat", fake("explicit"));
  await checkImage(PHOTO, "image/jpeg", "user-repeat", fake("ok"));
  expect(isBanned("user-repeat")).toBe(true);
});

test("suggestive photo is blocked but not banned", async () => {
  const v = await checkImage(PHOTO, "image/jpeg", "user-suggestive", fake("suggestive"));
  expect(v.action).toBe("block");
  expect(v.banned).toBe(false);
  expect(v.reason?.length).toBeGreaterThan(0);
  expect(isBanned("user-suggestive")).toBe(false);
});

test("if Gemini fails, the photo is blocked but nobody is banned", async () => {
  const v = await checkImage(PHOTO, "image/jpeg", "user-unknown", fake("unknown"));
  expect(v.action).toBe("block");
  expect(v.banned).toBe(false);
  expect(isBanned("user-unknown")).toBe(false);
});

test("banning one user doesn't affect others", async () => {
  await checkImage(PHOTO, "image/jpeg", "user-bad", fake("explicit"));
  expect(isBanned("user-bad")).toBe(true);
  expect(isBanned("user-innocent")).toBe(false);
});
