// Save the live dashboard numbers into src/stats.json (the offline fallback).
// Run right before presenting: npm run stats
import { writeFileSync } from "node:fs";

const res = await fetch("https://karl-production.up.railway.app/api/stats");
const d = await res.json();
const keep = { listedTotal: d.listedTotal, soldTotal: d.soldTotal, usersTotal: d.usersTotal, activeListings: d.activeListings, openWants: d.openWants };
writeFileSync(new URL("../src/stats.json", import.meta.url), JSON.stringify(keep, null, 2) + "\n");
console.log("saved", keep);
