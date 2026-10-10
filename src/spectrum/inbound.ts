// Inbound pipeline. Owner: Nishanth (agent branch).
// Phase 0: identify the sender, create/load the user, dedupe, reply hello.
// TODO(Nishanth, Phase A1): debounce bursts (LIMITS.debounceMs), stop/help, onboarding,
// then hand the batched messages to the agent loop in src/agent.

import type { Message, Space } from "spectrum-ts";
import { db } from "../db";
import { last4, rememberSpace, sendTo } from "./send";

function describe(message: Message): string {
  const c = message.content;
  if (c.type === "text") return c.text;
  if (c.type === "attachment") return `[photo: ${c.mimeType}]`;
  return `[${c.type}]`;
}

export async function handleInbound(space: Space, message: Message): Promise<void> {
  if (message.direction === "outbound") return;
  const phone = message.sender?.id;
  if (!phone) return;

  rememberSpace(space);
  const user = (await db.getUserByPhone(phone)) ?? (await db.createUser({ phone, spaceId: space.id }));
  if (user.spaceId !== space.id) await db.updateUser(user.id, { spaceId: space.id });

  const text = describe(message);
  const isNew = await db.saveInbound({ userId: user.id, text, platformMessageId: message.id });
  if (!isNew) return; // duplicate delivery
  console.log(`[in ${last4(phone)}] ${text}`);

  await space.responding(async () => {
    await sendTo(user, "hey, it's Karl 👋 (setup works)");
  });
}
