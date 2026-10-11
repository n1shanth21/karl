import snapshot from "./stats.json";

// Traction numbers for scene 10. At startup we try the live dashboard API (through the
// Vite proxy, see vite.config.ts) for 2.5 s; if the Wi-Fi is down we use the snapshot in
// stats.json. Refresh the snapshot right before presenting: `npm run stats`.

export type Traction = { listedTotal: number; soldTotal: number; usersTotal: number; live: boolean };

export const STATS: Traction = { ...snapshot, live: false };

export async function loadStats() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch("/karl-api/api/stats", { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return;
    const d = await res.json();
    if (typeof d.listedTotal !== "number") return;
    Object.assign(STATS, { listedTotal: d.listedTotal, soldTotal: d.soldTotal, usersTotal: d.usersTotal, live: true });
  } catch {
    // offline: keep the snapshot
  }
}
