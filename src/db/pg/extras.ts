// Robustness + price-hint queries (Phase DX). Owner: Himagna (data branch).

import type { Listing, Want } from "../../types";
import type { Db } from "../types";
import type { Sql } from "./client";

type ExtraQueries = Pick<Db, "activeListings" | "activeListingsMissingEmbedding" | "openWantsMissingEmbedding" | "soldPricesForCategory">;

export function extrasQueries(sql: Sql): ExtraQueries {
  const listingCols = sql`id, seller_id, title, description, category, condition, price_cents, photo_id, status, created_at`;
  const wantCols = sql`id, buyer_id, query_text, max_price_cents, status, expires_at, created_at`;

  return {
    async activeListings(limit) {
      if (limit <= 0) return [];
      return sql<Listing[]>`select ${listingCols} from listings where status = 'active' order by created_at desc limit ${limit}`;
    },

    async activeListingsMissingEmbedding() {
      return sql<Listing[]>`select ${listingCols} from listings where status = 'active' and embedding is null order by created_at`;
    },

    async openWantsMissingEmbedding() {
      return sql<Want[]>`
        select ${wantCols} from wants where status = 'open' and expires_at > now() and embedding is null order by created_at
      `;
    },

    async soldPricesForCategory(category, limit) {
      if (limit <= 0) return [];
      const rows = await sql<{ priceCents: number }[]>`
        select price_cents from listings
        where status = 'sold' and lower(category) = lower(${category})
        order by created_at desc limit ${limit}
      `;
      return rows.map((r) => r.priceCents);
    },
  };
}
