// Contract tests: wants, matches, stats. Same cases for memory and postgres.
import { afterAll, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Db } from "../../src/db/types";
import { backends, draft, hasDatabase, makeTestDb, near, newUser } from "./helpers";

setDefaultTimeout(30_000);

const DAY = 24 * 3600_000;

for (const kind of backends) {
  describe.skipIf(kind === "postgres" && !hasDatabase)(`${kind}: wants, matches, stats`, () => {
    let db: Db;
    let cleanup: () => Promise<void>;
    beforeAll(async () => ({ db, cleanup } = await makeTestDb(kind)));
    afterAll(async () => cleanup());
    beforeEach(async () => db.reset());

    test("createWant is open and expires in about 7 days", async () => {
      const buyer = await newUser(db);
      const w = await db.createWant({ buyerId: buyer.id, queryText: "mini fridge", maxPriceCents: 6000 });
      expect(w.status).toBe("open");
      expect(w.queryText).toBe("mini fridge");
      expect(w.maxPriceCents).toBe(6000);
      expect(near(w.expiresAt, new Date(Date.now() + 7 * DAY))).toBe(true);
      expect(near(w.createdAt, new Date())).toBe(true);
      expect((await db.getWant(w.id))?.id).toBe(w.id);
      expect(await db.getWant(crypto.randomUUID())).toBeNull();
      const noCap = await db.createWant({ buyerId: buyer.id, queryText: "lamp", maxPriceCents: null });
      expect(noCap.maxPriceCents).toBeNull();
    });

    test("updateWantStatus and openWantsByBuyer", async () => {
      const buyer = await newUser(db);
      const other = await newUser(db);
      const a = await db.createWant({ buyerId: buyer.id, queryText: "a", maxPriceCents: null });
      const b = await db.createWant({ buyerId: buyer.id, queryText: "b", maxPriceCents: null });
      await db.createWant({ buyerId: other.id, queryText: "c", maxPriceCents: null });
      expect((await db.openWantsByBuyer(buyer.id)).map((w) => w.id).sort()).toEqual([a.id, b.id].sort());

      const closed = await db.updateWantStatus(a.id, "closed");
      expect(closed.status).toBe("closed");
      expect((await db.openWantsByBuyer(buyer.id)).map((w) => w.id)).toEqual([b.id]);
      await expect(db.updateWantStatus(crypto.randomUUID(), "closed")).rejects.toThrow(/not found/);
    });

    test("openWantsExpiredBefore compares against expiresAt", async () => {
      const buyer = await newUser(db);
      const w = await db.createWant({ buyerId: buyer.id, queryText: "x", maxPriceCents: null });
      const future = new Date(Date.now() + 30 * DAY);
      expect((await db.openWantsExpiredBefore(future)).map((r) => r.id)).toEqual([w.id]);
      expect(await db.openWantsExpiredBefore(new Date())).toEqual([]);
      await db.updateWantStatus(w.id, "matched");
      expect(await db.openWantsExpiredBefore(future)).toEqual([]);
    });

    test("createMatch defaults, updateMatch, getMatch", async () => {
      const seller = await newUser(db);
      const buyer = await newUser(db);
      const l = await db.createListing({ sellerId: seller.id, draft, photoId: null });
      const m = await db.createMatch({ listingId: l.id, buyerId: buyer.id, sellerId: seller.id });
      expect(m.status).toBe("proposed");
      expect(m.holdExpiresAt).toBeNull();
      expect(m.meetupSpot).toBeNull();
      expect(m.meetupAt).toBeNull();
      expect(m.buyerConfirmed).toBe(false);
      expect(m.sellerConfirmed).toBe(false);

      const hold = new Date(Date.now() + 2 * 3600_000);
      const u = await db.updateMatch(m.id, { status: "accepted", holdExpiresAt: hold, buyerConfirmed: true });
      expect(u.status).toBe("accepted");
      expect(near(u.holdExpiresAt!, hold, 1000)).toBe(true);
      expect(u.buyerConfirmed).toBe(true);
      expect(u.sellerConfirmed).toBe(false);
      expect((await db.getMatch(m.id))?.status).toBe("accepted");
      expect(await db.getMatch(crypto.randomUUID())).toBeNull();
      await expect(db.updateMatch(crypto.randomUUID(), { status: "cancelled" })).rejects.toThrow(/not found/);
    });

    test("activeMatchesForUser covers buyer and seller, excludes finished matches", async () => {
      const seller = await newUser(db);
      const buyer = await newUser(db);
      const stranger = await newUser(db);
      const l1 = await db.createListing({ sellerId: seller.id, draft, photoId: null });
      const l2 = await db.createListing({ sellerId: seller.id, draft, photoId: null });
      const l3 = await db.createListing({ sellerId: seller.id, draft, photoId: null });
      const live = await db.createMatch({ listingId: l1.id, buyerId: buyer.id, sellerId: seller.id });
      const accepted = await db.createMatch({ listingId: l2.id, buyerId: buyer.id, sellerId: seller.id });
      await db.updateMatch(accepted.id, { status: "accepted" });
      const done = await db.createMatch({ listingId: l3.id, buyerId: buyer.id, sellerId: seller.id });
      await db.updateMatch(done.id, { status: "completed" });

      const want = [live.id, accepted.id].sort();
      expect((await db.activeMatchesForUser(buyer.id)).map((m) => m.id).sort()).toEqual(want);
      expect((await db.activeMatchesForUser(seller.id)).map((m) => m.id).sort()).toEqual(want);
      expect(await db.activeMatchesForUser(stranger.id)).toEqual([]);
    });

    test("matchesWithExpiredHold and matchesDueForCheckin use strict less-than", async () => {
      const seller = await newUser(db);
      const buyer = await newUser(db);
      const mk = async () => {
        const l = await db.createListing({ sellerId: seller.id, draft, photoId: null });
        return db.createMatch({ listingId: l.id, buyerId: buyer.id, sellerId: seller.id });
      };
      const t = new Date("2030-01-01T12:00:00.000Z");

      const held = await mk();
      await db.updateMatch(held.id, { status: "accepted", holdExpiresAt: t });
      const proposed = await mk(); // proposed, no hold: never expires
      expect(proposed.status).toBe("proposed");
      expect(await db.matchesWithExpiredHold(t)).toEqual([]);
      expect((await db.matchesWithExpiredHold(new Date(t.getTime() + 1))).map((m) => m.id)).toEqual([held.id]);
      expect(await db.matchesWithExpiredHold(new Date(t.getTime() - 1))).toEqual([]);

      const meet = await mk();
      await db.updateMatch(meet.id, { status: "meetup_set", meetupSpot: "Davis Library", meetupAt: t });
      expect(await db.matchesDueForCheckin(t)).toEqual([]);
      const due = await db.matchesDueForCheckin(new Date(t.getTime() + 1));
      expect(due.map((m) => m.id)).toEqual([meet.id]);
      expect(due[0]?.meetupSpot).toBe("Davis Library");
      expect(due[0]?.meetupAt?.getTime()).toBe(t.getTime());
    });

    test("getStats on an empty db is all zeros", async () => {
      const s = await db.getStats();
      expect([s.listedTotal, s.soldTotal, s.activeListings, s.openWants, s.usersTotal, s.tradedCents]).toEqual([0, 0, 0, 0, 0, 0]);
      expect(s.recent).toEqual([]);
      expect(Array.isArray(s.listingsPerHour)).toBe(true);
      expect(Number.isNaN(Date.parse(s.updatedAt))).toBe(false);
    });

    test("getStats counts listings, hides drafts and phone numbers", async () => {
      const named = await newUser(db, "Maya");
      const anon = await newUser(db);
      const photoId = await db.savePhoto(new Uint8Array([1, 2]), "image/jpeg");
      await db.createListing({ sellerId: named.id, draft, photoId: null }); // stays a draft
      const active = await db.createListing({ sellerId: named.id, draft: { ...draft, title: "Lamp" }, photoId });
      await db.updateListing(active.id, { status: "active" });
      const sold = await db.createListing({ sellerId: anon.id, draft: { ...draft, title: "Desk", priceCents: 7000 }, photoId: null });
      await db.updateListing(sold.id, { status: "sold" });
      await db.createWant({ buyerId: named.id, queryText: "chair", maxPriceCents: null });

      const s = await db.getStats();
      expect(s.listedTotal).toBe(2);
      expect(s.soldTotal).toBe(1);
      expect(s.activeListings).toBe(1);
      expect(s.openWants).toBe(1);
      expect(s.usersTotal).toBe(2);
      expect(s.tradedCents).toBe(7000);
      expect(s.recent.map((r) => r.id).sort()).toEqual([active.id, sold.id].sort());

      const lamp = s.recent.find((r) => r.id === active.id)!;
      const desk = s.recent.find((r) => r.id === sold.id)!;
      expect(lamp.sellerFirstName).toBe("Maya");
      expect(desk.sellerFirstName).toBe("someone");
      expect(lamp.photoUrl).toContain(`/photos/${photoId}`);
      expect(desk.photoUrl).toBeNull();
      expect(desk.status).toBe("sold");
      expect(near(new Date(lamp.createdAt), new Date())).toBe(true);

      const json = JSON.stringify(s);
      expect(json).not.toContain('"phone"');
      expect(json).not.toContain(named.phone);
    });

    test("logEvent does not throw", async () => {
      const u = await newUser(db);
      await db.logEvent("user_created", { userId: u.id });
      await db.logEvent("custom", { payload: { a: 1 } });
      await db.logEvent("bare");
    });
  });
}
