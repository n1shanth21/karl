// Contract tests: users, messages, photos, listings, reset. Same cases for memory and postgres.
import { afterAll, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Db } from "../../src/db/types";
import type { ConversationState } from "../../src/types";
import { backends, draft, hasDatabase, makeTestDb, near, newUser } from "./helpers";

setDefaultTimeout(30_000);

for (const kind of backends) {
  describe.skipIf(kind === "postgres" && !hasDatabase)(`${kind}: users, messages, photos, listings`, () => {
    let db: Db;
    let cleanup: () => Promise<void>;
    beforeAll(async () => ({ db, cleanup } = await makeTestDb(kind)));
    afterAll(async () => cleanup());
    beforeEach(async () => db.reset());

    test("createUser defaults and lookups", async () => {
      const u = await db.createUser({ phone: "+15551230000", spaceId: "sp" });
      expect(u.firstName).toBeNull();
      expect(u.optedOut).toBe(false);
      expect(u.state).toEqual({ kind: "onboarding" });
      expect(u.spaceId).toBe("sp");
      expect(u.createdAt).toBeInstanceOf(Date);
      expect((await db.getUserByPhone("+15551230000"))?.id).toBe(u.id);
      expect(await db.getUserByPhone("+19999999999")).toBeNull();
      expect((await db.getUser(u.id))?.phone).toBe("+15551230000");
    });

    test("getUser returns null for malformed or unknown ids", async () => {
      expect(await db.getUser("nope")).toBeNull();
      expect(await db.getUser(crypto.randomUUID())).toBeNull();
    });

    test("updateUser applies a partial patch and round-trips state", async () => {
      const u = await db.createUser({ phone: "+15551230001", spaceId: "sp" });
      const a = await db.updateUser(u.id, { firstName: "Maya" });
      expect(a.firstName).toBe("Maya");
      expect(a.optedOut).toBe(false);
      expect(a.state).toEqual({ kind: "onboarding" });

      const state: ConversationState = { kind: "choosing_result", listingIds: ["a", "b"] };
      const b = await db.updateUser(u.id, { state, optedOut: true });
      expect(b.state).toEqual(state);
      expect(b.optedOut).toBe(true);
      expect(b.firstName).toBe("Maya");

      const fresh = await db.getUser(u.id);
      expect(fresh?.state).toEqual(state);
      expect(fresh?.firstName).toBe("Maya");
      expect((await db.updateUser(u.id, { firstName: null })).firstName).toBeNull();
    });

    test("updateUser on a missing user throws not found", async () => {
      await expect(db.updateUser(crypto.randomUUID(), { firstName: "x" })).rejects.toThrow(/not found/);
    });

    test("saveInbound dedupes by platformMessageId", async () => {
      const u = await newUser(db);
      expect(await db.saveInbound({ userId: u.id, text: "hi", platformMessageId: "m1" })).toBe(true);
      expect(await db.saveInbound({ userId: u.id, text: "hi", platformMessageId: "m1" })).toBe(false);
      expect(await db.recentMessages(u.id, 10)).toHaveLength(1);
    });

    test("recentMessages returns the last N oldest-first, including outbound", async () => {
      const u = await newUser(db);
      const other = await newUser(db);
      await db.saveInbound({ userId: u.id, text: "one", platformMessageId: "a1" });
      await db.saveOutbound({ userId: u.id, text: "two" });
      await db.saveInbound({ userId: u.id, text: "three", platformMessageId: "a2" });
      await db.saveOutbound({ userId: u.id, text: "four" });
      await db.saveInbound({ userId: other.id, text: "not mine", platformMessageId: "b1" });

      const last3 = await db.recentMessages(u.id, 3);
      expect(last3.map((m) => m.text)).toEqual(["two", "three", "four"]);
      expect(last3.map((m) => m.direction)).toEqual(["out", "in", "out"]);
      expect(last3[1]?.platformMessageId).toBe("a2");
      expect(last3[0]?.platformMessageId).toBeNull();
      expect(last3[0]?.userId).toBe(u.id);
      expect(near(last3[0]!.createdAt, new Date())).toBe(true);
      expect(await db.recentMessages(u.id, 50)).toHaveLength(4);
    });

    test("photos round-trip bytes and mime type", async () => {
      const bytes = new Uint8Array([0, 1, 2, 250, 251, 255, 128, 7]);
      const id = await db.savePhoto(bytes, "image/jpeg");
      const got = await db.getPhoto(id);
      expect(got?.mimeType).toBe("image/jpeg");
      expect(Array.from(got!.bytes)).toEqual(Array.from(bytes));
      expect(got!.bytes).toBeInstanceOf(Uint8Array);
      expect(await db.getPhoto(crypto.randomUUID())).toBeNull();
    });

    test("createListing makes a draft without confidence; updateListing patches", async () => {
      const seller = await newUser(db);
      const photoId = await db.savePhoto(new Uint8Array([1, 2, 3]), "image/jpeg");
      const l = await db.createListing({ sellerId: seller.id, draft, photoId });
      expect(l.status).toBe("draft");
      expect(l).not.toHaveProperty("confidence");
      expect(l.title).toBe("Mini fridge");
      expect(l.priceCents).toBe(4500);
      expect(l.condition).toBe("good");
      expect(l.photoId).toBe(photoId);
      expect(near(l.createdAt, new Date())).toBe(true);

      const u = await db.updateListing(l.id, { priceCents: 4000, status: "active" });
      expect(u.priceCents).toBe(4000);
      expect(u.status).toBe("active");
      expect(u.title).toBe("Mini fridge");
      expect((await db.getListing(l.id))?.status).toBe("active");
      expect(await db.getListing(crypto.randomUUID())).toBeNull();
      await expect(db.updateListing(crypto.randomUUID(), { title: "x" })).rejects.toThrow(/not found/);

      const noPhoto = await db.createListing({ sellerId: seller.id, draft, photoId: null });
      expect(noPhoto.photoId).toBeNull();
    });

    test("listingsBySeller filters by status", async () => {
      const seller = await newUser(db);
      const other = await newUser(db);
      const a = await db.createListing({ sellerId: seller.id, draft, photoId: null });
      const b = await db.createListing({ sellerId: seller.id, draft, photoId: null });
      await db.updateListing(b.id, { status: "active" });
      await db.createListing({ sellerId: other.id, draft, photoId: null });

      const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
      expect(ids(await db.listingsBySeller(seller.id))).toEqual(ids([a, b]));
      expect(ids(await db.listingsBySeller(seller.id, undefined))).toEqual(ids([a, b]));
      expect(ids(await db.listingsBySeller(seller.id, ["active"]))).toEqual([b.id]);
      expect(await db.listingsBySeller(seller.id, [])).toEqual([]);
    });

    test("reset empties everything", async () => {
      const u = await newUser(db, "Maya");
      const l = await db.createListing({ sellerId: u.id, draft, photoId: null });
      const w = await db.createWant({ buyerId: u.id, queryText: "desk", maxPriceCents: null });
      const buyer = await newUser(db);
      const m = await db.createMatch({ listingId: l.id, buyerId: buyer.id, sellerId: u.id });
      const p = await db.savePhoto(new Uint8Array([1]), "image/jpeg");
      await db.saveInbound({ userId: u.id, text: "hi", platformMessageId: "r1" });
      await db.reset();

      expect(await db.getUser(u.id)).toBeNull();
      expect(await db.getUserByPhone(u.phone)).toBeNull();
      expect(await db.getListing(l.id)).toBeNull();
      expect(await db.getWant(w.id)).toBeNull();
      expect(await db.getMatch(m.id)).toBeNull();
      expect(await db.getPhoto(p)).toBeNull();
      expect(await db.recentMessages(u.id, 10)).toEqual([]);
      const stats = await db.getStats();
      expect([stats.usersTotal, stats.listedTotal, stats.openWants]).toEqual([0, 0, 0]);
      // the same platform message id is accepted again after a reset
      const again = await newUser(db);
      expect(await db.saveInbound({ userId: again.id, text: "hi", platformMessageId: "r1" })).toBe(true);
    });
  });
}
