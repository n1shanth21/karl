// Seed the database with demo listings.  Usage:
//   bun scripts/seed.ts                   -> the real database (public schema)
//   bun scripts/seed.ts --schema test_x   -> a throwaway schema
//   bun scripts/seed.ts --force           -> seed even if seed listings already exist
// Reads seed/seed-data.json (owned by Aayush) if present, else the fallback list.
// Seed sellers are opted out, so Karl never texts them. All embeddings go in ONE Gemini call.
// Prints counts only, never secrets.

import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { createPostgresDb } from "../src/db/postgres";
import type { Db } from "../src/db/types";
import { embedDocuments } from "../src/matching/embed";
import { type SeedListing, FALLBACK_LISTINGS } from "./seed-fallback";

const SEED_DIR = join(import.meta.dir, "../seed");
const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

function loadSeedListings(): { listings: SeedListing[]; source: string } {
  const file = join(SEED_DIR, "seed-data.json");
  if (!existsSync(file)) return { listings: FALLBACK_LISTINGS, source: "fallback list" };
  const data = JSON.parse(readFileSync(file, "utf8")) as SeedListing[];
  if (!Array.isArray(data) || data.length === 0) throw new Error("seed/seed-data.json must be a non-empty list");
  return { listings: data, source: "seed/seed-data.json" };
}

/** Returns how many listings were created (0 if it was already seeded). */
export async function seed(db: Db, opts: { force?: boolean } = {}): Promise<number> {
  const { listings, source } = loadSeedListings();
  const names = [...new Set(listings.map((l) => l.sellerFirstName))];

  // One seed user per first name. createUser is safe to call again for the same phone.
  const sellers = new Map<string, string>();
  for (const name of names) {
    const user = await db.createUser({ phone: `seed:${name.toLowerCase()}`, spaceId: "seed" });
    await db.updateUser(user.id, { firstName: name, optedOut: true });
    sellers.set(name, user.id);
  }

  if (!opts.force) {
    for (const id of sellers.values()) {
      if ((await db.listingsBySeller(id)).length > 0) {
        console.log("already seeded (use --force to add them again)");
        return 0;
      }
    }
  }

  const created = [];
  let withPhoto = 0;
  for (const l of listings) {
    let photoId: string | null = null;
    if (l.photo) {
      const path = join(SEED_DIR, "photos", l.photo);
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
    created.push(await db.updateListing(listing.id, { status: "active" }));
  }

  // Embed everything in one call to save Gemini quota (seed listings should not ping anyone).
  const vectors = await embedDocuments(created);
  for (let i = 0; i < created.length; i++) await db.setListingEmbedding(created[i]!.id, vectors[i]!);

  console.log(`seeded ${created.length} listings from ${source} (${sellers.size} sellers, ${withPhoto} photos, ${vectors.length} embeddings)`);
  return created.length;
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
