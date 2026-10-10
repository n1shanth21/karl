// Demo listings used by scripts/seed.ts when seed/seed-data.json does not exist.
// Same shape as seed-data.json. Owner: Himagna (data branch).

import type { Condition } from "../src/types";
import { CATALOG } from "../tests/data/fixtures/pairs";

export type SeedListing = {
  title: string;
  description: string;
  category: string;
  condition: Condition;
  priceCents: number;
  sellerFirstName: string;
  photo: string | null; // file name inside seed/photos/, or null for no photo
};

const SELLERS = ["Maya", "Jordan", "Ethan", "Priya", "Marcus", "Sofia"];
const CONDITIONS: Record<string, Condition> = {
  "mini-fridge": "good", "desk-lamp": "like_new", "lamp-oil": "new", "chem-101": "fair", "math-231": "good",
  "bike": "good", "bike-lock": "like_new", "microwave": "good", "monitor": "good", "hdmi-cable": "like_new",
  "rug": "good", "futon": "fair", "coffee-maker": "good", "keurig-pods": "new", "ti-84": "good",
  "hoodie": "like_new", "shower-caddy": "like_new", "desk-chair": "good", "standing-fan": "good",
  "air-purifier": "like_new", "string-lights": "good", "mattress-topper": "like_new",
};

// The 22 catalog items, spread across the sellers in turn.
const fromCatalog: SeedListing[] = CATALOG.map((item, i) => ({
  title: item.title,
  description: item.description,
  category: item.category,
  condition: CONDITIONS[item.key] ?? "good",
  priceCents: item.priceCents,
  sellerFirstName: SELLERS[i % SELLERS.length]!,
  photo: null,
}));

const extras: SeedListing[] = [
  { title: "ECON 101 textbook", category: "books", condition: "good", priceCents: 3500, sellerFirstName: "Marcus", photo: null,
    description: "Principles of Economics textbook used for ECON 101 at UNC. Light pencil notes in the margins. Pickup near Carroll Hall." },
  { title: "COMP 110 Python textbook", category: "books", condition: "like_new", priceCents: 3000, sellerFirstName: "Priya", photo: null,
    description: "Intro to programming book for COMP 110. Barely opened, no highlighting." },
  { title: "Dorm bedding set, twin XL", category: "dorm essentials", condition: "good", priceCents: 2500, sellerFirstName: "Sofia", photo: null,
    description: "Navy twin XL sheet set with comforter and two pillowcases. Washed and ready for move-in." },
  { title: "Over-door mirror", category: "dorm essentials", condition: "good", priceCents: 1200, sellerFirstName: "Jordan", photo: null,
    description: "Full-length mirror that hangs over a door, no drilling needed. No cracks." },
  { title: "Bluetooth speaker", category: "electronics", condition: "like_new", priceCents: 2200, sellerFirstName: "Ethan", photo: null,
    description: "Small waterproof Bluetooth speaker, loud enough for a dorm room. Charger cable included." },
];

export const FALLBACK_LISTINGS: SeedListing[] = [...fromCatalog, ...extras];
