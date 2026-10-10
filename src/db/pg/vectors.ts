// Embeddings + pgvector similarity search. Owner: Himagna (data branch).
// `<=>` is pgvector's cosine DISTANCE (0 = same meaning, 2 = opposite), so similarity = 1 - distance.
// We clamp it to 0..1 because the rest of the app treats scores that way.

import type { Listing, SearchResult, Want } from "../../types";
import type { Db } from "../types";
import { isUuid, toVector, type Sql } from "./client";

type VectorQueries = Pick<
  Db,
  "setListingEmbedding" | "setWantEmbedding" | "searchListingsByVector" | "openWantsByVector" | "countEventsSince"
>;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function vectorsQueries(sql: Sql): VectorQueries {
  const listingCols = sql`l.id, l.seller_id, l.title, l.description, l.category, l.condition, l.price_cents, l.photo_id, l.status, l.created_at`;
  const wantCols = sql`w.id, w.buyer_id, w.query_text, w.max_price_cents, w.status, w.expires_at, w.created_at`;

  return {
    async setListingEmbedding(listingId, embedding) {
      if (!isUuid(listingId)) return;
      await sql`update listings set embedding = ${toVector(embedding)}::vector where id = ${listingId}`;
    },

    async setWantEmbedding(wantId, embedding) {
      if (!isUuid(wantId)) return;
      await sql`update wants set embedding = ${toVector(embedding)}::vector where id = ${wantId}`;
    },

    async searchListingsByVector(embedding, { maxPriceCents = null, excludeSellerId, minScore, limit }) {
      const vec = toVector(embedding);
      const exclude = excludeSellerId && isUuid(excludeSellerId) ? excludeSellerId : null;
      const rows = await sql<(Listing & { score: number })[]>`
        select ${listingCols}, 1 - (l.embedding <=> ${vec}::vector) as score
        from listings l
        where l.status = 'active'
          and l.embedding is not null
          and (${maxPriceCents}::int is null or l.price_cents <= ${maxPriceCents}::int)
          and (${exclude}::uuid is null or l.seller_id <> ${exclude}::uuid)
          and 1 - (l.embedding <=> ${vec}::vector) >= ${minScore}
        order by l.embedding <=> ${vec}::vector
        limit ${limit}
      `;
      return rows.map(({ score, ...listing }): SearchResult => ({ listing, score: clamp01(Number(score)) }));
    },

    async openWantsByVector(embedding, { priceCents, excludeBuyerId, minScore }) {
      const vec = toVector(embedding);
      const exclude = isUuid(excludeBuyerId) ? excludeBuyerId : null;
      const rows = await sql<(Want & { score: number })[]>`
        select ${wantCols}, 1 - (w.embedding <=> ${vec}::vector) as score
        from wants w
        where w.status = 'open'
          and w.expires_at > now()
          and w.embedding is not null
          and (w.max_price_cents is null or w.max_price_cents >= ${priceCents})
          and (${exclude}::uuid is null or w.buyer_id <> ${exclude}::uuid)
          and 1 - (w.embedding <=> ${vec}::vector) >= ${minScore}
        order by w.embedding <=> ${vec}::vector
      `;
      return rows.map(({ score, ...want }) => ({ want, score: clamp01(Number(score)) }));
    },

    async countEventsSince(type, { userId, since }) {
      if (!isUuid(userId)) return 0;
      const [row] = await sql<{ n: number }[]>`
        select count(*)::int as n from events where type = ${type} and user_id = ${userId} and ts >= ${since}
      `;
      return row?.n ?? 0;
    },
  };
}
