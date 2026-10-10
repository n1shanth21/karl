import { expect, test } from "bun:test";
import { db } from "../../src/db";
import { photoAttachment, toJpeg } from "../../src/flows/photo";

test("toJpeg passes jpeg through unchanged", async () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const out = await toJpeg(bytes, "image/jpeg");
  expect(out.bytes).toEqual(bytes);
  expect(out.mimeType).toBe("image/jpeg");
});

test("toJpeg throws on unsupported type", async () => {
  await expect(toJpeg(new Uint8Array([1, 2, 3]), "image/gif")).rejects.toThrow("unsupported image type: image/gif");
});

test("photoAttachment(null) is null", async () => {
  expect(await photoAttachment(null)).toBeNull();
});

test("photoAttachment with unknown id is null", async () => {
  expect(await photoAttachment("does-not-exist")).toBeNull();
});

test("photoAttachment for a saved photo returns an attachment", async () => {
  const photoId = await db.savePhoto(new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg");
  expect(await photoAttachment(photoId)).not.toBeNull();
});
