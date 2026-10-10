// Photo helpers. Owner: Nishanth. iPhones send HEIC; Gemini, browsers and iMessage re-sends want JPEG.

import type { ContentInput } from "spectrum-ts";

/** Convert HEIC/HEIF to JPEG (via heif2jpeg); pass JPEG/PNG/WebP through unchanged. */
export async function toJpeg(_bytes: Uint8Array, _mimeType: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  throw new Error("TODO(wave1-photo)");
}

/** Load a stored listing photo (db.getPhoto) as Spectrum attachment content, or null if missing. */
export async function photoAttachment(_photoId: string | null): Promise<ContentInput | null> {
  throw new Error("TODO(wave1-photo)");
}
