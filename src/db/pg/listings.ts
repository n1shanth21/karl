// listings table queries. Owner: Himagna (data branch). Follows the users.ts pattern.
// Never select the `embedding` column (768 floats); the search code reads it separately.

import type postgres from "postgres";
import type { Listing } from "../../types";
import type { Db, ListingPatch } from "../types";
import { defined, insertEvent, isUuid, type Sql } from "./client";

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
      // One statement: lock the row, read its old status, update it, and hand the old status back,
      // so "draft -> active" is detected without a race.
      const [row] = keys.length
        ? await sql<(Listing & { oldStatus: string })[]>`
            with old as (select status as old_status from listings where id = ${id} for update)
            update listings set ${sql(changes, keys)} from old where id = ${id}
            returning ${cols}, old_status`
        : await sql<(Listing & { oldStatus: string })[]>`select ${cols}, status as old_status from listings where id = ${id}`;
      if (!row) throw new Error("listing not found");
      const { oldStatus, ...listing } = row;
      if (oldStatus === "draft" && listing.status === "active") {
        await insertEvent(sql, "listing_activated", {
          userId: listing.sellerId,
          listingId: listing.id,
          payload: { priceCents: listing.priceCents, category: listing.category },
        });
      }
      return listing;
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
