import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT, IM, PT_H, PT_W, SCALE, TEXT_SIZE } from "./theme";

// One thread item. `at` is the frame it appears (negative = already on screen at frame 0).
export type Item =
  | { kind: "divider"; at: number; text: string }
  | {
      kind: "msg";
      at: number;
      from: "me" | "karl";
      text?: string;
      label?: string; // bold relay label, e.g. "Maya · mini fridge"
      image?: string; // file in public/
      imageH?: number; // displayed photo height in points (default 186); the scroll math uses it
      tapback?: number; // frame when "me" hearts this message
    };

const TYPING_FRAMES = 26; // Karl's "..." bubble before each Karl message

export const Thread: React.FC<{ items: Item[] }> = ({ items }) => {
  const frame = useCurrentFrame();
  const visible = items.filter((it) => frame >= it.at);
  const nextKarl = items.find((it) => it.kind === "msg" && it.from === "karl" && frame >= it.at - TYPING_FRAMES && frame < it.at);
  const nextMe = items.find((it) => it.kind === "msg" && it.from === "me" && it.text && frame < it.at && frame >= it.at - typeFrames(it.text));

  return (
    <AbsoluteFill style={{ background: IM.bg }}>
      <div style={{ width: PT_W, height: PT_H, transform: `scale(${SCALE})`, transformOrigin: "0 0", fontFamily: FONT, color: IM.text, position: "relative" }}>
        <StatusBar />
        <Header />
        <div style={{ position: "absolute", top: LIST_TOP, height: LIST_H, left: 0, right: 0, overflow: "hidden" }}>
          <div style={{ padding: "10px 14px 0", display: "flex", flexDirection: "column", gap: 6, transform: `translateY(${-scrollFor(items, frame)}px)` }}>
            {visible.map((it, i) => {
              const next = visible[i + 1];
              const lastInGroup = !(next && next.kind === "msg" && it.kind === "msg" && next.from === it.from);
              return it.kind === "divider" ? <Divider key={i} item={it} /> : <Bubble key={i} item={it} tail={lastInGroup && !nextKarl} />;
            })}
            {nextKarl ? <Typing start={nextKarl.at - TYPING_FRAMES} /> : null}
          </div>
        </div>
        <InputBar typing={nextMe && nextMe.kind === "msg" && nextMe.text ? partial(nextMe.text, frame - (nextMe.at - typeFrames(nextMe.text)), typeFrames(nextMe.text)) : ""} />
      </div>
    </AbsoluteFill>
  );
};

const LIST_TOP = 136;
const LIST_H = PT_H - LIST_TOP - 90; // space between the header and the input bar

const IMAGE_H = 186; // default photo height (landscape photos like the mini fridge)

// Estimated height of an item in points (no DOM measuring in a render).
function heightOf(it: Item) {
  if (it.kind === "divider") return 40;
  if (it.image) return (it.imageH ?? IMAGE_H) + 6;
  const charsPerLine = 25;
  const lines = Math.ceil((it.text ?? "").length / charsPerLine) + (it.label ? 1 : 0);
  return lines * 27 + 16 + 6 + (it.tapback !== undefined ? 14 : 0);
}

// Scroll so the newest message stays above the input bar. Each item's height eases in
// with time so the scroll glides instead of jumping.
function scrollFor(items: Item[], frame: number) {
  let total = 10;
  for (const it of items) {
    const ease = interpolate(frame, [it.at - (it.kind === "msg" && it.from === "karl" ? TYPING_FRAMES : 0), it.at + 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    total += heightOf(it) * ease;
  }
  return Math.max(0, total - LIST_H + 20);
}

function typeFrames(text: string) {
  return Math.min(36, Math.max(14, Math.round(text.length * 1.3)));
}

function partial(text: string, elapsed: number, total: number) {
  return text.slice(0, Math.ceil((elapsed / total) * text.length));
}

const usePop = (at: number) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - at, fps, config: { damping: 16, stiffness: 180, mass: 0.7 } });
};

const Bubble: React.FC<{ item: Extract<Item, { kind: "msg" }>; tail: boolean }> = ({ item, tail }) => {
  const frame = useCurrentFrame();
  const pop = usePop(item.at);
  const mine = item.from === "me";
  const color = mine ? IM.sent : IM.received;
  const heart = item.tapback !== undefined ? popAt(frame, item.tapback) : 0;

  return (
    <div style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", marginTop: heart > 0 ? 14 : 0 }}>
      <div
        style={{
          position: "relative",
          maxWidth: "78%",
          transform: `scale(${interpolate(pop, [0, 1], [0.7, 1])}) translateY(${interpolate(pop, [0, 1], [12, 0])}px)`,
          transformOrigin: mine ? "100% 100%" : "0% 100%",
          opacity: Math.min(1, pop * 1.6),
        }}
      >
        {item.image ? (
          <Img src={staticFile(item.image)} style={{ width: 250, height: item.imageH ?? IMAGE_H, objectFit: "cover", borderRadius: 18, display: "block" }} />
        ) : (
          <div style={{ background: color, borderRadius: 20, padding: "8px 14px", fontSize: TEXT_SIZE, lineHeight: 1.3, letterSpacing: -0.2 }}>
            {item.label ? <div style={{ fontWeight: 700 }}>{item.label}</div> : null}
            {item.text}
          </div>
        )}
        {tail && !item.image ? <Tail mine={mine} color={color} /> : null}
        {heart > 0 ? <Tapback scale={heart} /> : null}
      </div>
    </div>
  );
};

function popAt(frame: number, at: number) {
  if (frame < at) return 0;
  return spring({ frame: frame - at, fps: 30, config: { damping: 9, stiffness: 220, mass: 0.6 } });
}

const Tail: React.FC<{ mine: boolean; color: string }> = ({ mine, color }) => (
  <svg width="16" height="20" viewBox="0 0 16 20" style={{ position: "absolute", bottom: 0, [mine ? "right" : "left"]: -5, transform: mine ? undefined : "scaleX(-1)" }}>
    <path d="M0 0 V20 C6 20 11 19 16 16 C9 14 6 8 6 0 Z" fill={color} />
  </svg>
);

const Tapback: React.FC<{ scale: number }> = ({ scale }) => (
  <div style={{ position: "absolute", top: -22, right: -12, width: 36, height: 36, borderRadius: 18, background: IM.sent, border: `3px solid ${IM.bg}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, transform: `scale(${scale})` }}>
    ❤️
  </div>
);

const Typing: React.FC<{ start: number }> = ({ start }) => {
  const frame = useCurrentFrame();
  const pop = usePop(start);
  return (
    <div style={{ display: "flex", opacity: pop, transform: `scale(${interpolate(pop, [0, 1], [0.7, 1])})`, transformOrigin: "0 100%" }}>
      <div style={{ background: IM.received, borderRadius: 20, padding: "13px 16px", display: "flex", gap: 5 }}>
        {[0, 1, 2].map((d) => (
          <div key={d} style={{ width: 9, height: 9, borderRadius: 5, background: IM.meta, opacity: 0.4 + 0.6 * Math.max(0, Math.sin((frame - start) / 4 - d * 0.9)) }} />
        ))}
      </div>
    </div>
  );
};

const Divider: React.FC<{ item: Extract<Item, { kind: "divider" }> }> = ({ item }) => {
  const pop = usePop(item.at);
  const [day, ...rest] = item.text.split(" ");
  return (
    <div style={{ textAlign: "center", color: IM.meta, fontSize: 13, margin: "14px 0 6px", opacity: pop }}>
      <b>{day}</b> {rest.join(" ")}
    </div>
  );
};

const StatusBar = () => (
  <div style={{ position: "absolute", top: 16, left: 0, right: 0, padding: "0 34px", display: "flex", justifyContent: "space-between", fontSize: 17, fontWeight: 600 }}>
    <span>9:41</span>
    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <span style={{ display: "flex", gap: 2, alignItems: "end" }}>
        {[5, 8, 11, 14].map((h) => (
          <span key={h} style={{ width: 3.5, height: h, background: IM.text, borderRadius: 1 }} />
        ))}
      </span>
      <span style={{ width: 26, height: 12, border: `1.5px solid ${IM.meta}`, borderRadius: 4, padding: 1.5, display: "flex" }}>
        <span style={{ flex: 1, background: IM.text, borderRadius: 2 }} />
      </span>
    </span>
  </div>
);

const Header = () => (
  <div style={{ position: "absolute", top: 52, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
    <Img src={staticFile("karl-mark.svg")} style={{ width: 56, height: 56, borderRadius: 28 }} />
    <div style={{ fontSize: 12, color: IM.text }}>Karl ›</div>
  </div>
);

const InputBar: React.FC<{ typing: string }> = ({ typing }) => (
  <div style={{ position: "absolute", bottom: 34, left: 14, right: 14, display: "flex", gap: 10, alignItems: "center" }}>
    <div style={{ width: 34, height: 34, borderRadius: 17, background: IM.bar, color: IM.meta, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>+</div>
    <div style={{ flex: 1, minHeight: 36, borderRadius: 18, border: `1px solid #3A3A3C`, padding: "6px 14px", fontSize: TEXT_SIZE - 2, color: typing ? IM.text : IM.meta }}>
      {typing || "iMessage"}
    </div>
  </div>
);
