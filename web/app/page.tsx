"use client";
import { useEffect, useState } from "react";
import ActivityPanel from "../components/ActivityPanel";
import Counter from "../components/Counter";
import Feed from "../components/Feed";
import Sparkline from "../components/Sparkline";
import TextKarl from "../components/TextKarl";
import { dollars } from "../lib/format";
import { useActivity } from "../lib/useActivity";
import { useStats } from "../lib/useStats";

export default function Home() {
  const { stats, live } = useStats();
  const { run, simulated } = useActivity();
  // null on the server; set in the browser so "5m ago" never causes a hydration mismatch.
  const [now, setNow] = useState<number | null>(null);

  // Re-render every 30s so relative times stay fresh.
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <main className="page">
      <header className="top">
        <h1>
          Karl <span className="accent">· UNC marketplace</span>
        </h1>
        <span className={`status ${live ? "live" : "demo"}`}>
          <span className="dot" /> {live ? "live" : "demo data"}
        </span>
      </header>

      <section className="counters">
        <Counter value={stats.listedTotal} label="listed" />
        <Counter value={stats.soldTotal} label="sold" />
        <Counter value={stats.tradedCents} format={dollars} label="traded" />
        <Counter value={stats.usersTotal} label="students" />
      </section>

      <ActivityPanel run={run} simulated={simulated} />

      <section className="grid">
        <div className="card">
          <h2>Just listed</h2>
          <Feed items={stats.recent} now={now} />
        </div>
        <div className="side">
          <div className="card">
            <h2>Listings per hour</h2>
            <Sparkline data={stats.listingsPerHour} />
          </div>
          <div className="card">
            <TextKarl />
          </div>
        </div>
      </section>
    </main>
  );
}
