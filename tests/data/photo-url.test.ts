import { expect, test } from "bun:test";
import { photoUrl } from "../../src/db/pg/client";

test("photo links always have a scheme and no double slash", () => {
  expect(photoUrl("https://karl.up.railway.app", "abc")).toBe("https://karl.up.railway.app/photos/abc");
  expect(photoUrl("karl-production.up.railway.app", "abc")).toBe("https://karl-production.up.railway.app/photos/abc");
  expect(photoUrl("http://localhost:3000/", "abc")).toBe("http://localhost:3000/photos/abc");
});
