"use client";
import { useState } from "react";
import type { Stats } from "../lib/types";
import { photoSrc, price, timeAgo } from "../lib/format";

// Photo thumbnail; falls back to the "K" tile if there's no photo or it fails to load.
function Thumb({ url, alt }: { url: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  const src = photoSrc(url);
  if (!src || failed) {
    return (
      <div className="thumb placeholder" aria-hidden="true">
        K
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="thumb" src={src} alt={alt} onError={() => setFailed(true)} />;
}

// `now` is null during the server render, so relative times only appear in the browser
// (avoids a hydration mismatch).
export default function Feed({ items, now }: { items: Stats["recent"]; now: number | null }) {
  if (items.length === 0) return <p className="muted">No listings yet. Text Karl a photo!</p>;
  return (
    <ul className="feed">
      {items.map((item) => (
        <li key={item.id} className="feed-item">
          <Thumb url={item.photoUrl} alt={item.title} />
          <div className="feed-body">
            <div className="feed-title">{item.title}</div>
            <div className="muted">
              {item.sellerFirstName}
              {now !== null && ` · ${timeAgo(item.createdAt, now)}`}
            </div>
          </div>
          <div className="feed-right">
            <div className="feed-price">{price(item.priceCents)}</div>
            <span className={`badge ${item.status}`}>{item.status}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
