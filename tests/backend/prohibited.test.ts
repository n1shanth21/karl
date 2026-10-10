// Tests for checkProhibited: banned items get blocked, normal dorm stuff always passes.
import { describe, expect, test } from "bun:test";
import { checkProhibited } from "../../src/safety";
import type { ListingDraft } from "../../src/types";

function draft(title: string, category = "misc", description = ""): ListingDraft {
  return { title, category, description, condition: "good", priceCents: 2000, confidence: 0.9 };
}

const BLOCKED: ListingDraft[] = [
  draft("Tito's vodka, unopened", "alcohol"),
  draft("12 pack of beer"),
  draft("White Claw variety pack", "drinks"),
  draft("Weed grinder and bong", "misc"),
  draft("THC edibles"),
  draft("Elf Bar vape, barely used"),
  draft("Zyn pouches", "nicotine"),
  draft("Leftover Adderall pills"),
  draft("Xanax", "meds"),
  draft("Glock 19 pistol"),
  draft("Taser for self defense"),
  draft("UNC vs Duke basketball tickets", "tickets"),
  draft("Student football ticket"),
  draft("Netflix account, 1 year"),
  draft("Windows 11 product key", "software"),
  draft("Fake ID, very legit"),
  draft("Replica Air Jordans", "shoes"),
  draft("Vibrator, new in box"),
  draft("Adult magazines collection"),
  draft("Item", "misc", "comes with free nudes"),
];

const NORMAL: ListingDraft[] = [
  draft("Mini fridge", "mini fridge", "works great, a little scratched"),
  draft("Ticket to Ride board game", "games"),
  draft("Set of 4 wine glasses", "kitchen"),
  draft("Beer pong table", "furniture"),
  draft("Shot glasses with UNC logo", "kitchen"),
  draft("Kitchen knife set", "kitchen"),
  draft("Pots and pans", "kitchen"),
  draft("Coffee grinder", "kitchen"),
  draft("Pharmacology textbook", "textbook"),
  draft("Hot glue gun", "crafts"),
  draft("Nerf gun", "toys"),
  draft("Massage gun", "fitness"),
  draft("Pill organizer", "health"),
  draft("Desk lamp", "furniture"),
  draft("TI-84 calculator", "electronics"),
  draft("Nude color heels", "shoes", "size 8"),
  draft("Root beer float glasses", "kitchen"),
  draft("Diet Coke 12 pack", "drinks"),
  draft("Dorm rug", "decor", "5x7, gray"),
  draft("Rubbing alcohol and first aid kit", "health"),
];

describe("checkProhibited", () => {
  for (const item of BLOCKED) {
    test(`blocks: ${item.title} / ${item.category} / ${item.description}`, () => {
      const verdict = checkProhibited(item);
      expect(verdict.action).toBe("block");
      expect(verdict.reason?.length).toBeGreaterThan(0);
    });
  }

  for (const item of NORMAL) {
    test(`allows: ${item.title}`, () => {
      expect(checkProhibited(item).action).toBe("allow");
    });
  }
});
