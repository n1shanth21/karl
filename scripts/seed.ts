// Seed the database with demo listings.  Usage:
//   bun scripts/seed.ts                   -> the real database (public schema)
//   bun scripts/seed.ts --schema test_x   -> a throwaway schema
//   bun scripts/seed.ts --force           -> seed even if seed listings already exist
// Reads seed/seed-data.json (owned by Aayush) if present, else the fallback list. Its shape:
//   { listings: [ListingDraft + sellerFirstName + photo ("photos/x.jpg", relative to seed/)],
//     wants:    [{ buyerFirstName, queryText, maxPriceCents }] }
// Seed people get phone "seed:<name>", spaceId "seed" and optedOut, so Karl never texts them.
// Listings are embedded in ONE Gemini call; wants are added after listings.
// Prints counts only, never secrets.

import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { createPostgresDb } from "../src/db/postgres";
import type { Db } from "../src/db/types";
import { embedDocuments, embedQuery } from "../src/matching/embed";
import { type SeedListing, FALLBACK_LISTINGS } from "./seed-fallback";

// KARL_SEED_DIR lets us test against a copy of the seed folder before it is merged into this branch.
const SEED_DIR = process.env.KARL_SEED_DIR ?? join(import.meta.dir, "../seed");
const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

type SeedWant = { buyerFirstName: string; queryText: string; maxPriceCents: number | null };

function loadSeedData(): { listings: SeedListing[]; wants: SeedWant[]; source: string } {
  const file = join(SEED_DIR, "seed-data.json");
  if (!existsSync(file)) return { listings: FALLBACK_LISTINGS, wants: [], source: "fallback list" };
  const data = JSON.parse(readFileSync(file, "utf8"));
  // Accept both { listings, wants } and a bare list of listings.
  const listings: SeedListing[] = Array.isArray(data) ? data : (data.listings ?? []);
  const wants: SeedWant[] = Array.isArray(data) ? [] : (data.wants ?? []);
  if (listings.length === 0) throw new Error("seed/seed-data.json has no listings");
  return { listings, wants, source: "seed/seed-data.json" };
}

/** "photos/x.jpg" (relative to seed/) or "x.jpg" (inside seed/photos/). */
function photoPath(photo: string): string {
  return photo.includes("/") ? join(SEED_DIR, photo) : join(SEED_DIR, "photos", photo);
}

/** One unreachable seed user per first name. createUser is safe to call again for the same phone. */
async function seedUser(db: Db, name: string): Promise<string> {
  const user = await db.createUser({ phone: `seed:${name.toLowerCase()}`, spaceId: "seed" });
  await db.updateUser(user.id, { firstName: name, optedOut: true });
  return user.id;
}

/** Returns how many listings were created (0 if it was already seeded). */
export async function seed(db: Db, opts: { force?: boolean } = {}): Promise<number> {
  const { listings, wants, source } = loadSeedData();
  const sellers = new Map<string, string>();
  for (const name of new Set(listings.map((l) => l.sellerFirstName))) sellers.set(name, await seedUser(db, name));

  if (!opts.force) {
    for (const id of sellers.values()) {
      if ((await db.listingsBySeller(id)).length > 0) {
        console.log("already seeded (use --force to add them again)");
        return 0;
      }
    }
  }

  // Embed everything first, in one call (saves Gemini quota). If Gemini fails here, nothing has been
  // written yet, so re-running is safe. Seed listings never ping anyone (no onListingActivated).
  const vectors = await embedDocuments(listings);

  let created = 0;
  let withPhoto = 0;
  for (const l of listings) {
    let photoId: string | null = null;
    if (l.photo) {
      const path = photoPath(l.photo);
      const mime = MIME[extname(l.photo).toLowerCase()];
      if (existsSync(path) && mime) {
        photoId = await db.savePhoto(new Uint8Array(readFileSync(path)), mime);
        withPhoto++;
      } else {
        console.warn(`photo skipped (missing file or unknown type): ${l.photo}`);
      }
    }
    const draft = { title: l.title, description: l.description, category: l.category, condition: l.condition, priceCents: l.priceCents, confidence: 1 };
    const listing = await db.createListing({ sellerId: sellers.get(l.sellerFirstName)!, draft, photoId });
    await db.setListingEmbedding(listing.id, vectors[created]!); // embedding before it goes live
    await db.updateListing(listing.id, { status: "active" });
    created++;
  }

  // Wants go in after listings (none of Aayush's seed wants is satisfied by a seed listing, on purpose).
  for (const w of wants) {
    const want = await db.createWant({ buyerId: await seedUser(db, w.buyerFirstName), queryText: w.queryText, maxPriceCents: w.maxPriceCents });
    await db.setWantEmbedding(want.id, await embedQuery(want.queryText));
  }

  console.log(
    `seeded ${created} listings + ${wants.length} wants from ${source} (${sellers.size} sellers, ${withPhoto} photos, ${vectors.length} listing embeddings)`,
  );
  return created;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = args.indexOf("--schema");
  const schema = flag > -1 ? args[flag + 1] : undefined;
  if (flag > -1 && !schema) throw new Error("--schema needs a name, e.g. --schema test_smoke");
  if (schema && !/^test_[a-z0-9_]+$/.test(schema)) throw new Error("--schema must look like test_something");

  const db = createPostgresDb({ schema });
  try {
    await seed(db, { force: args.includes("--force") });
  } finally {
    await db.end();
  }
}
