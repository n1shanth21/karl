// listings table queries. Owner: Himagna (data branch). Follows the users.ts pattern.
// Never select the `embedding` column (768 floats); the search code reads it separately.

import type postgres from "postgres";
import type { Listing } from "../../types";
import type { Db, ListingPatch } from "../types";
import { defined, isUuid, type Sql } from "./client";

type ListingQueries = Pick<Db, "createListing" | "getListing" | "updateListing" | "listingsBySeller">;

export function listingsQueries(sql: Sql): ListingQueries {
  const cols = sql`id, seller_id, title, description, category, condition, price_cents, photo_id, status, created_at`;

  return {
    async createListing({ sellerId, draft, photoId }) {
      // draft.confidence is only for the agent; it is not stored.
      const [row] = await sql<Listing[]>`
        insert into listings (seller_id, title, description, category, condition, price_cents, photo_id, status)
        values (${sellerId}, ${draft.title}, ${draft.description}, ${draft.category}, ${draft.condition},
                ${draft.priceCents}, ${photoId}, 'draft')
        returning ${cols}
      `;
      return row!;
    },

    async getListing(id) {
      if (!isUuid(id)) return null;
      const [row] = await sql<Listing[]>`select ${cols} from listings where id = ${id}`;
      return row ?? null;
    },

    async updateListing(id, patch: ListingPatch) {
      const changes = defined(patch) as Record<string, postgres.ParameterOrJSON<never>>;
      const keys = Object.keys(changes);

      if (!isUuid(id)) throw new Error("listing not found");
      const [row] = keys.length
        ? await sql<Listing[]>`update listings set ${sql(changes, keys)} where id = ${id} returning ${cols}`
        : await sql<Listing[]>`select ${cols} from listings where id = ${id}`;
      if (!row) throw new Error("listing not found");
      return row;
    },

    async listingsBySeller(sellerId, statuses) {
      if (!isUuid(sellerId)) return [];
      if (statuses && statuses.length === 0) return []; // `in ()` is invalid SQL; empty filter matches nothing
      return sql<Listing[]>`
        select ${cols} from listings
        where seller_id = ${sellerId} ${statuses ? sql`and status in ${sql(statuses)}` : sql``}
        order by created_at asc
      `;
    },
  };
}
