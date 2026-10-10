// The db layer logs five analytics events itself (flows never call logEvent for them).
// Same cases for memory and postgres; postgres also checks the stored payloads.
import { afterAll, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Sql } from "../../src/db/pg/client";
import type { Db } from "../../src/db/types";
import { backends, draft, hasDatabase, makeTestDb, newUser } from "./helpers";

setDefaultTimeout(30_000);

const TYPES = ["user_created", "want_created", "listing_activated", "match_accepted", "sale_completed"];

for (const kind of backends) {
  describe.skipIf(kind === "postgres" && !hasDatabase)(`${kind}: db-layer analytics events`, () => {
    let db: Db;
    let sql: Sql | undefined;
    let cleanup: () => Promise<void>;
    beforeAll(async () => ({ db, cleanup, sql } = await makeTestDb(kind)));
    afterAll(async () => cleanup());
    beforeEach(async () => db.reset());

    const count = (type: string, userId: string) => db.countEventsSince(type, { userId, since: new Date(0) });
    /** How many of the five events this user has, by type (zeros omitted). */
    async function counts(userId: string) {
      const out: Record<string, number> = {};
      for (const t of TYPES) {
        const n = await count(t, userId);
        if (n > 0) out[t] = n;
      }
      return out;
    }
    /** Payload rows straight from postgres (memory has no raw handle). */
    async function rows(type: string) {
      if (!sql) return [];
      return sql<{ userId: string | null; listingId: string | null; payload: Record<string, unknown> }[]>`
        select user_id, listing_id, payload from events where type = ${type}
      `;
    }
    async function liveListing(sellerId: string) {
      const l = await db.createListing({ sellerId, draft, photoId: null });
      return db.updateListing(l.id, { status: "active" });
    }

    test("createUser logs user_created once; a repeat call for the same phone does not", async () => {
      const u = await db.createUser({ phone: "+15557770001", spaceId: "a" });
      expect(await counts(u.id)).toEqual({ user_created: 1 });
      const again = await db.createUser({ phone: "+15557770001", spaceId: "b" });
      expect(again.id).toBe(u.id);
      expect(again.spaceId).toBe("b");
      expect(Object.keys(again)).not.toContain("inserted");
      expect(await counts(u.id)).toEqual({ user_created: 1 });
      const [row, ...rest] = await rows("user_created");
      if (sql) {
        expect(rest).toHaveLength(0);
        expect(row).toMatchObject({ userId: u.id, listingId: null, payload: {} });
      }
    });

    test("createWant logs want_created with maxPriceCents (null allowed)", async () => {
      const buyer = await newUser(db);
      await db.createWant({ buyerId: buyer.id, queryText: "mini fridge", maxPriceCents: 6000 });
      await db.createWant({ buyerId: buyer.id, queryText: "desk lamp", maxPriceCents: null });
      expect(await counts(buyer.id)).toEqual({ user_created: 1, want_created: 2 });
      if (sql) {
        const payloads = (await rows("want_created")).map((r) => r.payload).sort((a, b) => String(a.maxPriceCents).localeCompare(String(b.maxPriceCents)));
        expect(payloads).toEqual([{ maxPriceCents: 6000 }, { maxPriceCents: null }]);
      }
    });

    test("listing_activated logs only for the first draft -> active", async () => {
      const seller = await newUser(db);
      const l = await db.createListing({ sellerId: seller.id, draft, photoId: null });
      expect(await count("listing_activated", seller.id)).toBe(0); // draft only

      await db.updateListing(l.id, { title: "Mini fridge v2" }); // draft -> draft
      expect(await count("listing_activated", seller.id)).toBe(0);

      await db.updateListing(l.id, { status: "active" }); // draft -> active
      expect(await count("listing_activated", seller.id)).toBe(1);
      await db.updateListing(l.id, { status: "active", priceCents: 4000 }); // active -> active
      expect(await count("listing_activated", seller.id)).toBe(1);

      await db.updateListing(l.id, { status: "held" });
      await db.updateListing(l.id, { status: "active" }); // held -> active (hold expired)
      expect(await count("listing_activated", seller.id)).toBe(1);

      if (sql) {
        const [row, ...rest] = await rows("listing_activated");
        expect(rest).toHaveLength(0);
        expect(row).toMatchObject({ userId: seller.id, listingId: l.id, payload: { priceCents: 4500, category: "mini fridge" } });
      }
    });

    test("an empty patch on a draft logs nothing", async () => {
      const seller = await newUser(db);
      const l = await db.createListing({ sellerId: seller.id, draft, photoId: null });
      await db.updateListing(l.id, {});
      await db.updateListing(l.id, { title: undefined });
      expect(await count("listing_activated", seller.id)).toBe(0);
    });

    test("match_accepted logs on proposed -> accepted only", async () => {
      const seller = await newUser(db);
      const buyer = await newUser(db);
      const l = await liveListing(seller.id);
      const m = await db.createMatch({ listingId: l.id, buyerId: buyer.id, sellerId: seller.id });
      expect(await count("match_accepted", buyer.id)).toBe(0);

      await db.updateMatch(m.id, { meetupSpot: "the Pit" }); // proposed -> proposed
      expect(await count("match_accepted", buyer.id)).toBe(0);

      await db.updateMatch(m.id, { status: "accepted", holdExpiresAt: new Date(Date.now() + 60_000) });
      expect(await count("match_accepted", buyer.id)).toBe(1);
      await db.updateMatch(m.id, { status: "accepted" }); // accepted -> accepted
      expect(await count("match_accepted", buyer.id)).toBe(1);
      expect(await count("match_accepted", seller.id)).toBe(0); // logged under the buyer

      if (sql) {
        const [row, ...rest] = await rows("match_accepted");
        expect(rest).toHaveLength(0);
        expect(row).toMatchObject({ userId: buyer.id, listingId: l.id, payload: { matchId: m.id } });
      }
    });

    test("proposed -> cancelled logs neither accepted nor completed", async () => {
      const seller = await newUser(db);
      const buyer = await newUser(db);
      const l = await liveListing(seller.id);
      const m = await db.createMatch({ listingId: l.id, buyerId: buyer.id, sellerId: seller.id });
      await db.updateMatch(m.id, { status: "cancelled" });
      expect(await counts(buyer.id)).toEqual({ user_created: 1 });
      expect(await counts(seller.id)).toEqual({ user_created: 1, listing_activated: 1 });
    });

    test("sale_completed logs once, on the move to completed from any other status", async () => {
      const seller = await newUser(db);
      const buyer = await newUser(db);
      const l = await liveListing(seller.id);

      const viaMeetup = await db.createMatch({ listingId: l.id, buyerId: buyer.id, sellerId: seller.id });
      await db.updateMatch(viaMeetup.id, { status: "accepted" });
      await db.updateMatch(viaMeetup.id, { status: "meetup_set" });
      await db.updateMatch(viaMeetup.id, { status: "completed" });
      expect(await count("sale_completed", buyer.id)).toBe(1);
      await db.updateMatch(viaMeetup.id, { status: "completed" }); // completed -> completed
      expect(await count("sale_completed", buyer.id)).toBe(1);

      const direct = await db.createMatch({ listingId: l.id, buyerId: buyer.id, sellerId: seller.id });
      await db.updateMatch(direct.id, { status: "completed" }); // proposed -> completed
      expect(await count("sale_completed", buyer.id)).toBe(2);
      expect(await count("match_accepted", buyer.id)).toBe(1); // only the first match was accepted
      expect(await count("sale_completed", seller.id)).toBe(0);

      if (sql) {
        const all = await rows("sale_completed");
        expect(all).toHaveLength(2);
        expect(all.map((r) => r.payload).sort((a, b) => String(a.matchId).localeCompare(String(b.matchId)))).toEqual(
          [{ matchId: viaMeetup.id, sellerId: seller.id }, { matchId: direct.id, sellerId: seller.id }].sort((a, b) =>
            a.matchId.localeCompare(b.matchId),
          ),
        );
        expect(all.every((r) => r.userId === buyer.id && r.listingId === l.id)).toBe(true);
      }
    });

    test("payloads never carry phone numbers or names", async () => {
      if (!sql) return;
      const seller = await newUser(db, "Maya");
      const buyer = await newUser(db, "Jordan");
      const l = await liveListing(seller.id);
      await db.createWant({ buyerId: buyer.id, queryText: "call me at +15559998888", maxPriceCents: 100 });
      const m = await db.createMatch({ listingId: l.id, buyerId: buyer.id, sellerId: seller.id });
      await db.updateMatch(m.id, { status: "completed" });
      const dump = JSON.stringify(await sql`select type, payload from events`);
      expect(dump).not.toMatch(/\+1555|Maya|Jordan|call me/);
    });
  });
}
