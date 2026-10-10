import type { Stats } from "../lib/types";

const W = 400;
const H = 100;
const PAD = 8;

export default function Sparkline({ data }: { data: Stats["listingsPerHour"] }) {
  if (data.length < 2) return <p className="muted">Not enough data yet.</p>;
  const max = Math.max(1, ...data.map((d) => d.count));
  const points = data.map((d, i) => {
    const x = PAD + (i / (data.length - 1)) * (W - PAD * 2);
    const y = H - PAD - (d.count / max) * (H - PAD * 2);
    return [x, y] as const;
  });
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${PAD},${H - PAD} ${line} ${W - PAD},${H - PAD}`;
  const last = points[points.length - 1];

  return (
    <svg className="sparkline" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Listings per hour">
      <polygon points={area} fill="#4B9CD3" fillOpacity="0.18" />
      <polyline points={line} fill="none" stroke="#4B9CD3" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="5" fill="#4B9CD3" />
    </svg>
  );
}
