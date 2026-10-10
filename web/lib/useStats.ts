"use client";
import { useEffect, useState } from "react";
import mock from "../mock-stats.json";
import type { Stats } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL;
const POLL_MS = 5000;
const TIMEOUT_MS = 4000;

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const isDate = (s: unknown) => typeof s === "string" && !Number.isNaN(Date.parse(s));

// Checks the payload and drops any bad rows, so a weird response can't crash the page.
// Returns null if the top-level shape is wrong.
function cleanStats(x: unknown): Stats | null {
  const s = x as Stats;
  if (
    !s ||
    !isNum(s.listedTotal) ||
    !isNum(s.soldTotal) ||
    !isNum(s.usersTotal) ||
    !isNum(s.tradedCents) ||
    !Array.isArray(s.recent) ||
    !Array.isArray(s.listingsPerHour)
  ) {
    return null;
  }
  const recent = s.recent.filter(
    (r) =>
      !!r &&
      typeof r.id === "string" &&
      typeof r.title === "string" &&
      typeof r.sellerFirstName === "string" &&
      isNum(r.priceCents) &&
      isDate(r.createdAt) &&
      (r.photoUrl === null || typeof r.photoUrl === "string") &&
      ["active", "held", "sold"].includes(r.status),
  );
  const listingsPerHour = s.listingsPerHour.filter((h) => !!h && isNum(h.count) && isDate(h.hour));
  return { ...s, recent, listingsPerHour };
}

// Polls /api/stats. Shows the bundled mock until the first good response.
// After that, a failed poll keeps the last live data instead of flashing fake numbers.
export function useStats(): { stats: Stats; live: boolean } {
  const [state, setState] = useState<{ stats: Stats; live: boolean }>({
    stats: mock as Stats,
    live: false,
  });

  useEffect(() => {
    if (!API_URL) return; // no server configured: stay on demo data
    let stopped = false;
    let inFlight = false;

    async function load() {
      if (inFlight) return; // don't pile up requests
      inFlight = true;
      try {
        const res = await fetch(`${API_URL}/api/stats`, {
          cache: "no-store",
          signal: AbortSignal.timeout(TIMEOUT_MS), // a hung request must not block polling forever
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = cleanStats(await res.json());
        if (!data) throw new Error("bad shape");
        if (!stopped) setState({ stats: data, live: true });
      } catch {
        // keep whatever we were showing (mock before first success, last live data after)
      } finally {
        inFlight = false;
      }
    }

    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  return state;
}
