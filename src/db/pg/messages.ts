// conversation_messages table queries. Owner: Himagna (data branch).
// Mirrors src/db/memory.ts: duplicate inbound ids return false, history comes back oldest-first.

import type { StoredMessage } from "../../types";
import type { Db } from "../types";
import { isUuid, type Sql } from "./client";

type MessageQueries = Pick<Db, "saveInbound" | "saveOutbound" | "recentMessages">;

export function messagesQueries(sql: Sql): MessageQueries {
  const cols = sql`user_id, direction, text, platform_message_id, created_at`;

  return {
    async saveInbound({ userId, text, platformMessageId }) {
      // platform_message_id is unique across ALL users, so a repeat delivery inserts nothing.
      const rows = await sql`
        insert into conversation_messages (user_id, direction, text, platform_message_id)
        values (${userId}, 'in', ${text}, ${platformMessageId})
        on conflict (platform_message_id) do nothing
        returning id
      `;
      return rows.length > 0;
    },

    async saveOutbound({ userId, text }) {
      await sql`
        insert into conversation_messages (user_id, direction, text, platform_message_id)
        values (${userId}, 'out', ${text}, null)
      `;
    },

    async recentMessages(userId, limit) {
      if (limit <= 0 || !isUuid(userId)) return [];
      // Newest `limit` rows first, then flip them so the caller gets oldest-first.
      const rows = await sql<(StoredMessage & { id: string })[]>`
        select id, ${cols} from conversation_messages
        where user_id = ${userId}
        order by created_at desc, id desc
        limit ${limit}
      `;
      return rows.reverse().map(({ id: _id, ...message }) => message);
    },
  };
}
