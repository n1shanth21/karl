// Price hint from sold comps: what did the same kind of thing actually sell for on Karl?
// The agent uses this to suggest "$45?" when a seller has not named a price, and falls back to
// Gemini's own estimate when this returns null. Owner: Himagna (data branch).
import { db } from "../db";

/** How many recent sold listings to look at. */
const COMP_LIMIT = 25;
/** Fewer comps than this is too thin to trust, so we return null instead of guessing. */
const MIN_COMPS = 3;

/**
 * Median sold price (cents) for a category, rounded to the nearest whole dollar (students price in
 * whole dollars, so $44.60 becomes $45.00). Returns null when there are fewer than 3 sold comps.
 * `_title` is reserved for a future title-aware version; today only the category is used.
 */
export async function suggestPriceCents(category: string, _title?: string): Promise<number | null> {
  const prices = await db.soldPricesForCategory(category, COMP_LIMIT);
  if (prices.length < MIN_COMPS) return null;

  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  // Odd count: the middle value. Even count: the mean of the two middle values.
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(median / 100) * 100;
}
