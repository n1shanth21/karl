// Contract tests for the Phase DX queries: activeListings, soldPricesForCategory, *MissingEmbedding.
import { afterAll, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Sql } from "../../src/db/pg/client";
import type { Db } from "../../src/db/types";
import { backends, draft, hasDatabase, makeTestDb, newUser } from "./helpers";

setDefaultTimeout(30_000);

const vec = Array(768).fill(0).map((_, i) => (i === 0 ? 1 : 0));
/** Distinct created_at values, so "newest first" is never a tie (memory timestamps have ms resolution). */
const tick = () => new Promise((r) => setTimeout(r, 5));

for (const kind of backends) {
  describe.skipIf(kind === "postgres" && !hasDatabase)(`${kind}: robustness + price queries`, () => {
    let db: Db;
    let sql: Sql | undefined;
    let cleanup: () => Promise<void>;
    beforeAll(async () => ({ db, cleanup, sql } = await makeTestDb(kind)));
    afterAll(async () => cleanup());
    beforeEach(async () => db.reset());

    /** A listing in the given status. */
    async function listing(sellerId: string, status: "draft" | "active" | "held" | "sold" | "removed", over: Partial<typeof draft> = {}) {
      const l = await db.createListing({ sellerId, draft: { ...draft, ...over }, photoId: null });
      return status === "draft" ? l : db.updateListing(l.id, { status });
    }

    test("activeListings: newest first, respects the limit, only active", async () => {
      const s = await newUser(db);
      const a = await listing(s.id, "active", { title: "a" });
      await tick();
      await listing(s.id, "sold", { title: "sold" });
      await listing(s.id, "draft", { title: "draft" });
      await listing(s.id, "held", { title: "held" });
      await listing(s.id, "removed", { title: "removed" });
      await tick();
      const c = await listing(s.id, "active", { title: "c" });
      await tick();
      const b = await listing(s.id, "active", { title: "b" });

      expect((await db.activeListings(10)).map((l) => l.id)).toEqual([b.id, c.id, a.id]);
      expect((await db.activeListings(2)).map((l) => l.id)).toEqual([b.id, c.id]);
    });

    test("activeListings with limit 0 (or nothing active) is empty", async () => {
      const s = await newUser(db);
      expect(await db.activeListings(5)).toEqual([]);
      await listing(s.id, "active");
      expect(await db.activeListings(0)).toEqual([]);
    });

    test("soldPricesForCategory: case-insensitive, only sold, newest first, limit", async () => {
      const s = await newUser(db);
      await listing(s.id, "sold", { category: "Mini Fridge", priceCents: 3000 });
      await tick();
      await listing(s.id, "sold", { category: "mini fridge", priceCents: 4000 });
      await tick();
      await listing(s.id, "sold", { category: "desk lamp", priceCents: 999 });
      await listing(s.id, "active", { category: "mini fridge", priceCents: 7000 });
      await listing(s.id, "held", { category: "mini fridge", priceCents: 7100 });
      await tick();
      await listing(s.id, "sold", { category: "MINI FRIDGE", priceCents: 5000 });

      expect(await db.soldPricesForCategory("mini fridge", 10)).toEqual([5000, 4000, 3000]);
      expect(await db.soldPricesForCategory("Mini Fridge", 2)).toEqual([5000, 4000]);
      expect(await db.soldPricesForCategory("mini fridge", 0)).toEqual([]);
      expect(await db.soldPricesForCategory("couch", 10)).toEqual([]);
    });

    if (kind === "memory") {
      test("missing-embedding lists are always empty in memory mode", async () => {
        const s = await newUser(db);
        await listing(s.id, "active");
        await db.createWant({ buyerId: s.id, queryText: "mini fridge", maxPriceCents: null });
        expect(await db.activeListingsMissingEmbedding()).toEqual([]);
        expect(await db.openWantsMissingEmbedding()).toEqual([]);
      });
    } else {
      test("activeListingsMissingEmbedding: appears until an embedding is set; only active", async () => {
        const s = await newUser(db);
        const a = await listing(s.id, "active", { title: "a" });
        const b = await listing(s.id, "active", { title: "b" });
        await listing(s.id, "draft");
        await listing(s.id, "sold");
        expect((await db.activeListingsMissingEmbedding()).map((l) => l.id).sort()).toEqual([a.id, b.id].sort());

        await db.setListingEmbedding(a.id, vec);
        expect((await db.activeListingsMissingEmbedding()).map((l) => l.id)).toEqual([b.id]);
        await db.setListingEmbedding(b.id, vec);
        expect(await db.activeListingsMissingEmbedding()).toEqual([]);
      });

      test("openWantsMissingEmbedding: appears until set; expired or non-open wants excluded", async () => {
        const s = await newUser(db);
        const open = await db.createWant({ buyerId: s.id, queryText: "mini fridge", maxPriceCents: null });
        const expired = await db.createWant({ buyerId: s.id, queryText: "desk lamp", maxPriceCents: null });
        const closed = await db.createWant({ buyerId: s.id, queryText: "couch", maxPriceCents: null });
        const matched = await db.createWant({ buyerId: s.id, queryText: "bike", maxPriceCents: null });
        await sql!`update wants set expires_at = now() - interval '1 day' where id = ${expired.id}`;
        await db.updateWantStatus(closed.id, "closed");
        await db.updateWantStatus(matched.id, "matched");

        expect((await db.openWantsMissingEmbedding()).map((w) => w.id)).toEqual([open.id]);
        await db.setWantEmbedding(open.id, vec);
        expect(await db.openWantsMissingEmbedding()).toEqual([]);
      });
    }
  });
}
