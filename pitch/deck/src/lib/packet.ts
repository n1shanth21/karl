import * as THREE from "three";
import { canvasPlane, font, roundRect } from "./label";

// A message "packet" travelling between nodes: a chat bubble drawn on a canvas.
// Its look is a pure function of `mask` (0 = raw with phone number, 1 = Karl's label)
// and `tone` (normal / warn / blocked), so tweens can scrub it both ways.

export type PacketLook = { from?: string; label?: string; body: string; tone?: "normal" | "blocked" };

const W = 4.4, H = 1.5;
const DIGITS = "0123456789";

export function createPacket(raw: PacketLook, masked: PacketLook) {
  const plane = canvasPlane(W, H, () => {});
  const group = new THREE.Group();
  group.add(plane.mesh);
  group.visible = false;
  let lastKey = "";
  const state = { mask: 0, red: 0 };

  const paint = () => {
    // redraw only when what's visible actually changes
    const step = Math.round(state.mask * 12);
    const key = `${step}|${state.red > 0.5}`;
    if (key === lastKey) return;
    lastKey = key;
    plane.redraw((ctx, cw, ch) => {
      const red = state.red > 0.5;
      ctx.fillStyle = red ? "#FF6B6B" : "#4B9CD3";
      roundRect(ctx, 0, 0, cw, ch, 36);
      ctx.fill();
      ctx.fillStyle = "#fff";
      let top = raw.from ?? "";
      let bold = false;
      if (state.mask >= 1 && masked.label) { top = masked.label; bold = true; }
      else if (state.mask > 0 && raw.from) {
        // scramble the number while it passes through Karl, then drop it
        top = raw.from.replace(/\d/g, () => DIGITS[Math.floor(Math.random() * 10)]);
        ctx.globalAlpha = 1 - state.mask * 0.7;
      }
      ctx.font = bold ? font(700, 34) : font(500, 28);
      ctx.fillText(top, 30, 52);
      ctx.globalAlpha = 1;
      ctx.font = font(600, 40);
      ctx.fillText(state.mask >= 1 ? masked.body : raw.body, 30, 112);
    });
  };
  paint();
  return { group, state, paint };
}
