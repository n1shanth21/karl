// SHARED CONTRACT. Every branch builds against these types.
// Owner: Nishanth (agent branch). Others: request changes in your team/<name>.md file.
// Rule: only ADD fields/types. Never rename or remove (that breaks other branches).

// Money is always integer cents. Times are always Date (stored as timestamptz).

export type ConversationState =
  | { kind: "onboarding" } // asked for first name, waiting
  | { kind: "idle" }
  | { kind: "drafting_listing"; listingId: string } // draft exists, waiting for confirm/edits
  | { kind: "choosing_result"; listingIds: string[] } // showed search results OR a proactive offer, waiting for a pick
  | { kind: "in_handoff" }; // at least one active match (relay may apply)

export type User = {
  id: string;
  phone: string; // NEVER show to another user. Log only the last 4 digits.
  spaceId: string; // Spectrum space id of this user's DM with Karl (used to message them later)
  firstName: string | null;
  optedOut: boolean; // texted "stop"
  state: ConversationState;
  createdAt: Date;
};

export type ListingStatus = "draft" | "active" | "held" | "sold" | "removed";

export type Condition = "new" | "like_new" | "good" | "fair" | "poor";

export type Listing = {
  id: string;
  sellerId: string;
  title: string;
  description: string;
  category: string; // free text, e.g. "mini fridge", "textbook", "furniture"
  condition: Condition;
  priceCents: number;
  photoId: string | null; // id from db.savePhoto(); served at /photos/:id
  status: ListingStatus;
  createdAt: Date;
};

// What Gemini vision produces from a photo, before the seller confirms.
export type ListingDraft = {
  title: string;
  description: string;
  category: string;
  condition: Condition;
  priceCents: number; // suggested price
  confidence: number; // 0..1, how sure vision is about what the item is
};

export type WantStatus = "open" | "matched" | "closed";

export type Want = {
  id: string;
  buyerId: string;
  queryText: string; // "mini fridge for my dorm"
  maxPriceCents: number | null;
  status: WantStatus;
  expiresAt: Date;
  createdAt: Date;
};

export type MatchStatus =
  | "proposed" // buyer picked, waiting for seller
  | "accepted" // seller said yes, item held
  | "meetup_set"
  | "completed"
  | "cancelled"
  | "expired";

export type Match = {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  status: MatchStatus;
  holdExpiresAt: Date | null;
  meetupSpot: string | null;
  meetupAt: Date | null;
  buyerConfirmed: boolean;
  sellerConfirmed: boolean;
  createdAt: Date;
};

export type SearchResult = { listing: Listing; score: number }; // score 0..1, higher = closer

export type StoredMessage = {
  userId: string;
  direction: "in" | "out";
  text: string;
  platformMessageId: string | null; // inbound Spectrum message id (idempotency)
  createdAt: Date;
};

export type SafetyAction = "allow" | "warn" | "block";
export type SafetyVerdict = { action: SafetyAction; reason?: string };

// Shape of GET /api/stats (dashboard). Aggregates only, no personal data.
export type Stats = {
  listedTotal: number;
  soldTotal: number;
  activeListings: number;
  openWants: number;
  usersTotal: number;
  tradedCents: number; // sum of sold listing prices
  recent: {
    id: string;
    title: string;
    priceCents: number;
    sellerFirstName: string; // first name only
    photoUrl: string | null;
    status: ListingStatus;
    createdAt: string; // ISO
  }[];
  listingsPerHour: { hour: string; count: number }[]; // from Tiger continuous aggregate
  updatedAt: string; // ISO
};
