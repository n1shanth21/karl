// Photo helpers. Owner: Nishanth. iPhones send HEIC; Gemini, browsers and iMessage re-sends want JPEG.

import { attachment, type ContentInput } from "spectrum-ts";
import { heifToJpeg } from "heif2jpeg";
import { db } from "../db";

/** Convert HEIC/HEIF to JPEG (via heif2jpeg); pass JPEG/PNG/WebP through unchanged. */
export async function toJpeg(bytes: Uint8Array, mimeType: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const type = mimeType.toLowerCase();
  if (type === "image/heic" || type === "image/heif") {
    const jpeg = await heifToJpeg(Buffer.from(bytes), { quality: 85 });
    return { bytes: new Uint8Array(jpeg), mimeType: "image/jpeg" };
  }
  if (type === "image/jpeg" || type === "image/png" || type === "image/webp") return { bytes, mimeType };
  throw new Error(`unsupported image type: ${mimeType}`);
}

/** Load a stored listing photo (db.getPhoto) as Spectrum attachment content, or null if missing. */
export async function photoAttachment(photoId: string | null): Promise<ContentInput | null> {
  if (photoId === null) return null;
  const photo = await db.getPhoto(photoId);
  if (!photo) return null;
  return attachment(Buffer.from(photo.bytes), { name: "item.jpg", mimeType: photo.mimeType });
}
