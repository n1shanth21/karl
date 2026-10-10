// events + dashboard stats + reset. Owner: Himagna (data branch).
// Mirrors getStats/logEvent/reset in src/db/memory.ts exactly.

import { config } from "../../config";
import type { ListingStatus, Stats } from "../../types";
import type { Db } from "../types";
import { insertEvent, type Sql } from "./client";

type StatsQueries = Pick<Db, "logEvent" | "getStats" | "reset">;

type RecentRow = {
  id: string;
  title: string;
  priceCents: number;
  sellerFirstName: string;
  photoId: string | null;
  status: ListingStatus;
  createdAt: Date;
};

export function statsQueries(sql: Sql): StatsQueries {
  return {
    async logEvent(type, data) {
      await insertEvent(sql, type, data); // never throws
    },

    async getStats(): Promise<Stats> {
      // One round trip for all the counters. count()/sum() are cast so they come back as numbers.
      const [counts] = await sql<
        { listedTotal: number; soldTotal: number; activeListings: number; openWants: number; usersTotal: number; tradedCents: number }[]
      >`
        select
          (select count(*) from listings where status <> 'draft')::int as listed_total,
          (select count(*) from listings where status = 'sold')::int as sold_total,
          (select count(*) from listings where status = 'active')::int as active_listings,
          (select count(*) from wants where status = 'open')::int as open_wants,
          (select count(*) from users)::int as users_total,
          (select coalesce(sum(price_cents), 0) from listings where status = 'sold')::int as traded_cents
      `;

      // Never select phone: the dashboard is public.
      const rows = await sql<RecentRow[]>`
        select l.id, l.title, l.price_cents, coalesce(u.first_name, 'someone') as seller_first_name,
               l.photo_id, l.status, l.created_at
        from listings l
        join users u on u.id = l.seller_id
        where l.status <> 'draft'
        order by l.created_at desc
        limit 10
      `;

      return {
        listedTotal: counts!.listedTotal,
        soldTotal: counts!.soldTotal,
        activeListings: counts!.activeListings,
        openWants: counts!.openWants,
        usersTotal: counts!.usersTotal,
        tradedCents: counts!.tradedCents,
        recent: rows.map((r) => ({
          id: r.id,
          title: r.title,
          priceCents: r.priceCents,
          sellerFirstName: r.sellerFirstName,
          photoUrl: r.photoId ? `${config.publicBaseUrl}/photos/${r.photoId}` : null,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
        })),
        listingsPerHour: [], // TODO(Phase D3): read from the Timescale continuous aggregate
        updatedAt: new Date().toISOString(),
      };
    },

    async reset() {
      // Every table is qualified with the connection's own schema, so a table missing from a test
      // schema can never fall through to the real (public) tables. Wiping public needs an explicit
      // opt-in that only scripts/reset.ts sets. schema_migrations is intentionally NOT truncated.
      const [{ schema }] = await sql<{ schema: string }[]>`select current_schema() as schema`;
      if (!schema.startsWith("test_") && process.env.KARL_ALLOW_PUBLIC_RESET !== "1") {
        throw new Error(`refusing to reset schema "${schema}" (run scripts/reset.ts to wipe the real database)`);
      }
      const tables = ["users", "photos", "listings", "wants", "matches", "conversation_messages", "events"];
      await sql`truncate ${sql(tables.map((t) => `${schema}.${t}`))} restart identity cascade`;
    },
  };
}
