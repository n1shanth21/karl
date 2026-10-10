// Shared test helpers for the agent branch: fake users with fake iMessage spaces that record
// everything Karl sends them. Use these in every agent test so tests look the same.

import type { Space } from "spectrum-ts";
import { db } from "../../src/db";
import { rememberSpace } from "../../src/spectrum/send";
import type { User } from "../../src/types";

export type Sent = { text: string; raw: unknown; id: string };

const outbox = new Map<string, Sent[]>(); // spaceId -> messages Karl sent there
let counter = 0;

/** Best-effort readable text for any content Karl sent (string, markdown(), attachment(), ...). */
export function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  const c = content as Record<string, unknown> | null;
  if (!c) return "";
  for (const key of ["text", "markdown", "name", "title"]) if (typeof c[key] === "string") return c[key] as string;
  if (c.content) return textOf(c.content);
  return `[${String(c.type ?? "content")}]`;
}

export function fakeSpace(id: string): Space {
  outbox.set(id, []);
  const space = {
    id,
    __platform: "imessage",
    async send(...content: unknown[]) {
      const sent = content.map((c) => ({ text: textOf(c), raw: c, id: `out-${++counter}` }));
      outbox.get(id)!.push(...sent);
      const msgs = sent.map((s) => ({ id: s.id }));
      return content.length === 1 ? msgs[0] : msgs;
    },
    async responding<T>(fn: () => T | Promise<T>) {
      return fn();
    },
    async startTyping() {},
    async stopTyping() {},
  };
  return space as unknown as Space;
}

/** Create a user (named, past onboarding) with a recording fake space. */
export async function fakeUser(firstName: string | null = "Maya", phone = `+1555${String(++counter).padStart(7, "0")}`): Promise<User> {
  const spaceId = `space-${phone}`;
  rememberSpace(fakeSpace(spaceId));
  const user = await db.createUser({ phone, spaceId });
  return db.updateUser(user.id, { firstName, state: { kind: "idle" } });
}

/** Everything Karl sent this user, oldest first. */
export function sentTo(user: User): Sent[] {
  return outbox.get(user.spaceId) ?? [];
}

export function lastTextTo(user: User): string {
  return sentTo(user).at(-1)?.text ?? "";
}

export async function resetAll(): Promise<void> {
  await db.reset();
  for (const list of outbox.values()) list.length = 0;
}
