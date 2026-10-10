// Send helpers. Owner: Nishanth. Use these instead of calling Spectrum directly, so every
// outbound message is logged, saved to history, and (optionally) tagged with a Ref.

import type { ContentInput, Message, Space } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { db } from "../db";
import type { User } from "../types";
import type { App } from "./client";
import { rememberRef, type Ref } from "./refs";

let app: App | null = null;
// Spaces we've seen this process (covers terminal + tests, where there's no lookup by id).
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

/**
 * Send text (or any Spectrum content: markdown(), attachment(), poll...) to a user.
 * - logText: what to save in history/logs when content isn't a plain string
 * - ref: tag the sent message so tapbacks/replies on it can be routed (see refs.ts)
 * Never throws for opted-out users; it just skips them.
 */
export async function sendTo(user: User, content: ContentInput, opts: { logText?: string; ref?: Ref } = {}): Promise<Message | undefined> {
  if (user.optedOut) return undefined;
  const space = await spaceFor(user);
  const sent = await space.send(content);
  if (sent && opts.ref) rememberRef(sent.id, opts.ref);
  const text = opts.logText ?? (typeof content === "string" ? content : "[rich content]");
  await db.saveOutbound({ userId: user.id, text });
  console.log(`[out ${last4(user.phone)}] ${text}`);
  return sent;
}
