// Mirrors src/types.ts in the repo root (web/ deploys alone, so no cross-import).
// Keep in sync with the server's Stats type.
export type ListingStatus = "active" | "held" | "sold";

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
  listingsPerHour: { hour: string; count: number }[];
  updatedAt: string; // ISO
};

// Mirrors the proposed ActivityStep / ActivityRun addition to src/types.ts.
// GET /api/activity returns a bare ActivityRun[], newest first, up to 5.
export type ActivityStep = {
  key: string;
  label: string;
  status: "pending" | "active" | "done" | "failed";
  at: string | null; // ISO time the step finished (or started), null while pending
};

export type ActivityRun = {
  id: string;
  kind: "sell" | "buy";
  firstName: string; // first name only
  itemTitle: string | null;
  startedAt: string; // ISO
  steps: ActivityStep[];
};
