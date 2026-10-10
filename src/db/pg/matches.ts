// matches table queries. Owner: Himagna (data branch). Same pattern as users.ts.

import type postgres from "postgres";
import type { Match } from "../../types";
import type { Db, MatchPatch } from "../types";
import { defined, insertEvent, isUuid, type Sql } from "./client";

type MatchQueries = Pick<
  Db,
  "createMatch" | "getMatch" | "updateMatch" | "activeMatchesForUser" | "matchesWithExpiredHold" | "matchesDueForCheckin"
>;

export function matchesQueries(sql: Sql): MatchQueries {
  const cols = sql`id, listing_id, buyer_id, seller_id, status, hold_expires_at, meetup_spot, meetup_at, buyer_confirmed, seller_confirmed, created_at`;

  return {
    async createMatch({ listingId, buyerId, sellerId }) {
      const [row] = await sql<Match[]>`
        insert into matches (listing_id, buyer_id, seller_id, status)
        values (${listingId}, ${buyerId}, ${sellerId}, 'proposed')
        returning ${cols}
      `;
      return row!;
    },

    async getMatch(id) {
      if (!isUuid(id)) return null;
      const [row] = await sql<Match[]>`select ${cols} from matches where id = ${id}`;
      return row ?? null;
    },

    async updateMatch(id, patch: MatchPatch) {
      // undefined keys are ignored; null is a real value (e.g. clearing holdExpiresAt).
      const changes = defined(patch) as Record<string, postgres.ParameterOrJSON<never>>;
      const keys = Object.keys(changes);

      if (!isUuid(id)) throw new Error("match not found");
      // One statement: lock the row, read its old status, update, return the old status (see listings.ts).
      const [row] = keys.length
        ? await sql<(Match & { oldStatus: string })[]>`
            with old as (select status as old_status from matches where id = ${id} for update)
            update matches set ${sql(changes, keys)} from old where id = ${id}
            returning ${cols}, old_status`
        : await sql<(Match & { oldStatus: string })[]>`select ${cols}, status as old_status from matches where id = ${id}`;
      if (!row) throw new Error("match not found");
      const { oldStatus, ...match } = row;
      if (oldStatus === "proposed" && match.status === "accepted") {
        await insertEvent(sql, "match_accepted", { userId: match.buyerId, listingId: match.listingId, payload: { matchId: match.id } });
      } else if (oldStatus !== "completed" && match.status === "completed") {
        await insertEvent(sql, "sale_completed", {
          userId: match.buyerId,
          listingId: match.listingId,
          payload: { matchId: match.id, sellerId: match.sellerId },
        });
      }
      return match;
    },

    async activeMatchesForUser(userId) {
      if (!isUuid(userId)) return [];
      return sql<Match[]>`
        select ${cols} from matches
        where status in ('proposed', 'accepted', 'meetup_set')
          and (buyer_id = ${userId} or seller_id = ${userId})
        order by created_at asc
      `;
    },

    async matchesWithExpiredHold(date) {
      return sql<Match[]>`
        select ${cols} from matches
        where status = 'accepted' and hold_expires_at is not null and hold_expires_at < ${date}
        order by hold_expires_at asc
      `;
    },

    async matchesDueForCheckin(date) {
      return sql<Match[]>`
        select ${cols} from matches
        where status = 'meetup_set' and meetup_at is not null and meetup_at < ${date}
        order by meetup_at asc
      `;
    },
  };
}
