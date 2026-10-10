// The data layer logs 5 events itself; a flow that ALSO calls db.logEvent for them must not double-count.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Db } from "../../src/db/types";
import { DB_OWNED_EVENTS } from "../../src/db/types";
import { hasDatabase, makeTestDb } from "./helpers";

setDefaultTimeout(30_000);

for (const kind of ["memory", "postgres"] as const) {
  describe.skipIf(kind === "postgres" && !hasDatabase)(`${kind}: db-owned events`, () => {
    let db: Db;
    let cleanup: (() => Promise<void>) | undefined;
    beforeAll(async () => {
      ({ db, cleanup } = await makeTestDb(kind));
    });
    afterAll(async () => {
      await cleanup?.();
    });

    test("an extra db.logEvent for a db-owned type is ignored; other types still log", async () => {
      await db.reset();
      const user = await db.createUser({ phone: "+15550300001", spaceId: "s" });
      const since = new Date(0);
      for (const type of DB_OWNED_EVENTS) await db.logEvent(type, { userId: user.id });
      await db.logEvent("match_pinged", { userId: user.id });

      expect(await db.countEventsSince("user_created", { userId: user.id, since })).toBe(1); // from createUser only
      expect(await db.countEventsSince("listing_activated", { userId: user.id, since })).toBe(0);
      expect(await db.countEventsSince("match_pinged", { userId: user.id, since })).toBe(1);
    });
  });
}
