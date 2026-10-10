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
