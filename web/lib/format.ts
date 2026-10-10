export function dollars(cents: number): string {
  return "$" + Math.round(cents / 100).toLocaleString("en-US");
}

export function price(cents: number): string {
  const d = cents / 100;
  return "$" + (Number.isInteger(d) ? d.toString() : d.toFixed(2));
}

export function timeAgo(iso: string, now: number = Date.now()): string {
  const sec = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

// The server may send "/photos/abc" (relative to the API host) or a full URL.
export function photoSrc(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("/")) {
    const api = process.env.NEXT_PUBLIC_API_URL;
    return api ? api.replace(/\/$/, "") + url : null;
  }
  return url.startsWith("http://") || url.startsWith("https://") ? url : null;
}
