"use client";
import { useEffect, useRef, useState } from "react";

// Tweens from the previously shown number to the new value.
export default function Counter({
  value,
  format = (n: number) => Math.round(n).toLocaleString("en-US"),
  label,
}: {
  value: number;
  format?: (n: number) => string;
  label: string;
}) {
  const [shown, setShown] = useState(0);
  const shownRef = useRef(0);

  useEffect(() => {
    const from = shownRef.current;
    const start = performance.now();
    const duration = 900;
    let frame = 0;
    function step(now: number) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      shownRef.current = from + (value - from) * eased;
      setShown(shownRef.current);
      if (t < 1) frame = requestAnimationFrame(step);
    }
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <div className="counter">
      <div className="counter-value">{format(shown)}</div>
      <div className="counter-label">{label}</div>
    </div>
  );
}
