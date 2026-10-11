import { expect, test } from "bun:test";
import { db } from "../../src/db";
import { unseed } from "../../src/maintenance/unseed";
import { fakeUser, resetAll } from "./helpers";

test("unseed removes only seed users' listings and wants", async () => {
  await resetAll();
  const seedSeller = await db.createUser({ phone: "seed:jordan", spaceId: "seed" });
  const real = await fakeUser("Maya");
  const draft = { title: "Houndstooth bean bag chair", description: "", category: "chair", condition: "good" as const, priceCents: 3500, confidence: 1 };
  const fake = await db.updateListing((await db.createListing({ sellerId: seedSeller.id, draft, photoId: null })).id, { status: "active" });
  const mine = await db.updateListing((await db.createListing({ sellerId: real.id, draft: { ...draft, title: "Desk lamp" }, photoId: null })).id, { status: "active" });
  const seedWant = await db.createWant({ buyerId: seedSeller.id, queryText: "bike lock", maxPriceCents: 1500 });
  const realWant = await db.createWant({ buyerId: real.id, queryText: "monitor", maxPriceCents: 8000 });

  expect(await unseed()).toEqual({ listings: 1, wants: 1 });
  expect((await db.getListing(fake.id))?.status).toBe("removed");
  expect((await db.getListing(mine.id))?.status).toBe("active");
  expect((await db.getWant(seedWant.id))?.status).toBe("closed");
  expect((await db.getWant(realWant.id))?.status).toBe("open");
});
