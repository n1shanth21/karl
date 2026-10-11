import { Item } from "./Thread";

// Every clip's script. Karl's lines are copied from the real code where they exist
// (src/flows/sell.ts, src/flows/match.ts, src/agent/notifications.ts, src/safety/scan.ts).
// Names are made-up first names; no numbers, no last names.

const SAVED = "nothing like that right now, but i saved it. i'll text you the second one gets listed 👀";

export const THREADS: Record<string, Item[]> = {
  // Buyer asks, nothing matches, Karl remembers.
  WantSaved: [
    { kind: "divider", at: 0, text: "Today 9:12 PM" },
    { kind: "msg", at: 40, from: "me", text: "need a desk lamp under $20" },
    { kind: "msg", at: 100, from: "karl", text: SAVED },
  ],

  // Seller texts a photo, Karl drafts the listing, a heart posts it.
  SellDraft: [
    { kind: "divider", at: 0, text: "Today 2:40 PM" },
    { kind: "msg", at: 20, from: "me", image: "mini-fridge.jpg" },
    { kind: "msg", at: 90, from: "karl", text: "mini fridge, good condition, $45. post it? (❤️ or yes, or tell me a different price)", tapback: 160 },
    { kind: "msg", at: 210, from: "karl", text: "it's live! i'll text you when someone wants it" },
  ],

  // The magic moment: a day later Karl texts first.
  MatchPing: [
    { kind: "divider", at: -1, text: "Yesterday 9:12 PM" },
    { kind: "msg", at: -1, from: "me", text: "need a desk lamp under $20" },
    { kind: "msg", at: -1, from: "karl", text: SAVED },
    { kind: "divider", at: 40, text: "Today 11:03 AM" },
    { kind: "msg", at: 80, from: "karl", image: "desk-lamp.jpg", imageH: 300 },
    { kind: "msg", at: 130, from: "karl", text: "someone just listed a desk lamp, $15, good condition. want it? (❤️ or yes)", tapback: 210 },
  ],

  // Seller's phone: the buyer's "omw" arrives with a label, never a number.
  MaskedRelay: [
    { kind: "divider", at: -1, text: "Today 2:52 PM" },
    { kind: "msg", at: -1, from: "karl", text: "someone wants your mini fridge at $45. ok to hold it for them for 2 hours? (❤️ or yes)" },
    { kind: "msg", at: -1, from: "me", text: "yes" },
    { kind: "msg", at: 40, from: "karl", label: "Maya · mini fridge", text: "omw, 5 min" },
    { kind: "msg", at: 120, from: "me", text: "cool, i'm by the Pit" },
  ],

  // Buyer's phone: a pay-first message gets a heads up right after it.
  SafetyWarning: [
    { kind: "divider", at: -1, text: "Today 4:15 PM" },
    { kind: "msg", at: 30, from: "karl", label: "Jordan · desk lamp", text: "venmo me first pls" },
    { kind: "msg", at: 100, from: "karl", text: "heads up: only pay once you actually have the item in your hands. i'd skip paying ahead of time" },
  ],

  // Seller's phone: Karl haggles for you. An offer arrives, the seller counters, the deal closes at the new price.
  // Wording from src/flows/offers.ts and src/flows/match.ts.
  Negotiation: [
    { kind: "divider", at: 0, text: "Today 2:48 PM" },
    { kind: "msg", at: 30, from: "karl", text: "someone wants your mini fridge (listed $45) and offers $35. take it? (❤️/yes, no, or reply with a price to counter)" },
    { kind: "msg", at: 120, from: "me", text: "40" },
    { kind: "msg", at: 170, from: "karl", text: "sent your $40 to Maya, i'll let you know" },
    { kind: "msg", at: 270, from: "karl", text: "Maya took $40! the mini fridge is held for them. when are you free to meet in the next couple days?" },
  ],

  // Backup if the live demo stalls: the buyer's whole journey in one thread.
  DemoBackup: [
    { kind: "divider", at: 0, text: "Yesterday 9:12 PM" },
    { kind: "msg", at: 30, from: "me", text: "need a desk lamp under $20" },
    { kind: "msg", at: 90, from: "karl", text: SAVED },
    { kind: "divider", at: 170, text: "Today 11:03 AM" },
    { kind: "msg", at: 210, from: "karl", image: "desk-lamp.jpg", imageH: 300 },
    { kind: "msg", at: 260, from: "karl", text: "someone just listed a desk lamp, $15, good condition. want it? (❤️ or yes)" },
    { kind: "msg", at: 340, from: "me", text: "yes!" },
    { kind: "msg", at: 400, from: "karl", text: "asked the seller, i'll text you when they answer" },
    { kind: "msg", at: 500, from: "karl", text: "Jordan said yes, the desk lamp is held for you. when are you free to meet in the next couple days? (like 'tmr after 2' or 'sat 11-3')" },
    { kind: "msg", at: 590, from: "me", text: "tmr after 2" },
    { kind: "msg", at: 660, from: "karl", text: "you're both free tomorrow 2–5pm. Davis Library entrance tomorrow at 2pm? 👍 or 👎 for another option" },
    { kind: "msg", at: 750, from: "karl", label: "Jordan · desk lamp", text: "see you there" },
  ],
};

export const TAIL_FRAMES = 75; // hold the last state before the clip ends

export function durationOf(items: Item[]) {
  return Math.max(...items.map((it) => it.at)) + TAIL_FRAMES + 60; // + room for a tapback
}
