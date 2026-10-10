// Send helpers. Owner: Nishanth. Use these instead of calling Spectrum directly, so every
// outbound message is logged and saved to history in one place.

import type { ContentInput, Space } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { db } from "../db";
import type { User } from "../types";
import type { App } from "./client";

let app: App | null = null;
// Spaces we've seen this process (covers terminal, where there's no lookup by id).
const knownSpaces = new Map<string, Space>();

export function initSend(spectrumApp: App) {
  app = spectrumApp;
}

export function rememberSpace(space: Space) {
  knownSpaces.set(space.id, space);
}

/** Get the DM space for a user (used when Karl messages someone who didn't just text him). */
export async function spaceFor(user: User): Promise<Space> {
  const known = knownSpaces.get(user.spaceId);
  if (known) return known;
  if (!app) throw new Error("initSend() was not called");
  return imessage(app).space.get(user.spaceId);
}

export const last4 = (phone: string) => `…${phone.slice(-4)}`;

/** Send text (or any Spectrum content) to a user and save it to history. */
export async function sendTo(user: User, content: ContentInput, logText?: string): Promise<void> {
  const space = await spaceFor(user);
  await space.send(content);
  const text = logText ?? (typeof content === "string" ? content : "[rich content]");
  await db.saveOutbound({ userId: user.id, text });
  console.log(`[out ${last4(user.phone)}] ${text}`);
}
