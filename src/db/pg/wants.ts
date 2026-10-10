// wants table queries. Owner: Himagna (data branch). Follows the pattern in users.ts.
// The `embedding` column is written by the matching code, never selected here.

import type { Want } from "../../types";
import type { Db } from "../types";
import { isUuid, type Sql } from "./client";

type WantQueries = Pick<Db, "createWant" | "getWant" | "updateWantStatus" | "openWantsByBuyer" | "openWantsExpiredBefore">;

export function wantsQueries(sql: Sql): WantQueries {
  const cols = sql`id, buyer_id, query_text, max_price_cents, status, expires_at, created_at`;

  return {
    async createWant({ buyerId, queryText, maxPriceCents }) {
      // status 'open' and expires_at (now + 7 days) come from the column defaults.
      const [row] = await sql<Want[]>`
        insert into wants (buyer_id, query_text, max_price_cents)
        values (${buyerId}, ${queryText}, ${maxPriceCents})
        returning ${cols}
      `;
      return row!;
    },

    async getWant(id) {
      if (!isUuid(id)) return null;
      const [row] = await sql<Want[]>`select ${cols} from wants where id = ${id}`;
      return row ?? null;
    },

    async updateWantStatus(id, status) {
      if (!isUuid(id)) throw new Error("want not found");
      const [row] = await sql<Want[]>`update wants set status = ${status} where id = ${id} returning ${cols}`;
      if (!row) throw new Error("want not found");
      return row;
    },

    async openWantsByBuyer(buyerId) {
      if (!isUuid(buyerId)) return [];
      return sql<Want[]>`
        select ${cols} from wants
        where buyer_id = ${buyerId} and status = 'open'
        order by created_at asc
      `;
    },

    async openWantsExpiredBefore(date) {
      return sql<Want[]>`
        select ${cols} from wants
        where status = 'open' and expires_at < ${date}
        order by expires_at asc
      `;
    },
  };
}
