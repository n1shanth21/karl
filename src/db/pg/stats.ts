// events + dashboard stats + reset. Owner: Himagna (data branch).
// Mirrors getStats/logEvent/reset in src/db/memory.ts exactly.

import { config } from "../../config";
import type { ListingStatus, Stats } from "../../types";
import { DB_OWNED_EVENTS, type Db } from "../types";
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

const HOURS = 12;

export function statsQueries(sql: Sql): StatsQueries {
  // Detected once per connection pool: does this schema have the events_hourly continuous aggregate?
  // (A schema migrated without 003_tiger.sql does not, and falls back to counting raw events.)
  // Qualified with current_schema() on purpose: an unqualified name would also find public.events_hourly
  // through the search_path and read the real database's counts from a test schema.
  let hasAggregate: Promise<boolean> | null = null;
  const aggregateExists = () =>
    (hasAggregate ??= sql<{ found: boolean }[]>`select to_regclass(current_schema() || '.events_hourly') is not null as found`.then(
      (r) => r[0]!.found,
      (err) => {
        hasAggregate = null; // don't cache a failed check
        throw err;
      },
    ));

  // Last 12 hours of listing_activated counts, oldest first, empty hours = 0.
  // time_bucket('1 hour', now()) lines the series up with the aggregate's own UTC hour buckets.
  async function listingsPerHour(): Promise<Stats["listingsPerHour"]> {
    const rows = (await aggregateExists())
      ? await sql<{ hour: Date; count: number }[]>`
          select g.hour, coalesce(h.n, 0)::int as count
          from generate_series(time_bucket('1 hour', now()) - interval '11 hours', time_bucket('1 hour', now()), interval '1 hour') as g(hour)
          left join (
            select bucket, sum(n) as n from events_hourly where type = 'listing_activated' group by bucket
          ) h on h.bucket = g.hour
          order by g.hour
        `
      : await sql<{ hour: Date; count: number }[]>`
          select g.hour, coalesce(h.n, 0)::int as count
          from generate_series(time_bucket('1 hour', now()) - interval '11 hours', time_bucket('1 hour', now()), interval '1 hour') as g(hour)
          left join (
            select time_bucket('1 hour', ts) as bucket, count(*) as n
            from events
            where type = 'listing_activated' and ts >= time_bucket('1 hour', now()) - interval '11 hours'
            group by 1
          ) h on h.bucket = g.hour
          order by g.hour
        `;
    return rows.map((r) => ({ hour: r.hour.toISOString(), count: r.count }));
  }

  return {
    async logEvent(type, data) {
      if (DB_OWNED_EVENTS.has(type)) return; // already logged by the write itself (see DB_OWNED_EVENTS)
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
        listingsPerHour: await listingsPerHour(),
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
      // Already-materialized hours would keep their old counts until the next policy run; refresh now.
      // (Runs as its own autocommitted statement, which Timescale requires.)
      const [{ cagg }] = await sql<{ cagg: string | null }[]>`select to_regclass(${`${schema}.events_hourly`})::text as cagg`;
      if (cagg) await sql`call refresh_continuous_aggregate(${cagg}::regclass, null, null)`;
    },
  };
}
