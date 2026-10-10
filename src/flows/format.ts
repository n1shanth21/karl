// The ONE place user-facing money, item names and conditions are formatted. Owner: Nishanth.

import type { Listing } from "../types";

/** 4500 -> "$45", 4550 -> "$45.50". */
export const dollars = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;

/** Listing title as Karl says it mid-sentence: "Mini Fridge (Galanz)" -> "mini fridge (galanz)". */
export const itemName = (listing: Pick<Listing, "title">) => listing.title.toLowerCase();

/** "like_new" -> "like new". */
export const conditionText = (condition: Listing["condition"]) => condition.replace("_", " ");
