import gsap from "gsap";
import { World } from "./world";

// A "slide". Every scene lives in the same world.
//  - init() runs once at startup: create this scene's objects and text, all hidden.
//  - build() adds the transition INTO this scene to `tl`, starting from the previous
//    scene's end state. Use gsap .to()/.fromTo() so the timeline can run backwards.
//    Avoid tl.set() at time 0; put instant changes at 0.01 so reversing restores them.
//    fromTo() on 3D objects needs immediateRender: false, or it jumps them at build time.
export interface Scene {
  id: string;
  title: string; // shown in the presenter view
  notes: string; // speaker notes
  move: string; // the kind of transition, so we never repeat one twice in a row
  speed?: number; // multiplies SPEED for this scene only (below 1 = slower)
  texts: HTMLElement[]; // this scene's overlay text; faded out when the next scene starts
  init(w: World): void;
  build(w: World, tl: gsap.core.Timeline): void;
  // Optional: put videos etc. into this scene's end state (used after jumps and skips).
  settle?(w: World): void;
}

// Make a text block on the 1920x1080 stage. `cls` is one of: hero, title, line, small (+ mono).
// x/y are stage pixels; align "center" centers the block on x.
export function text(
  w: World,
  html: string,
  opts: { x: number; y: number; cls: string; align?: "left" | "center" | "right" },
): HTMLElement {
  const el = document.createElement("div");
  el.className = `t ${opts.cls}`;
  el.innerHTML = html;
  el.style.left = `${opts.x}px`;
  el.style.top = `${opts.y}px`;
  const align = opts.align ?? "left";
  el.style.textAlign = align;
  // Let gsap own the transform so later y-tweens keep the horizontal alignment.
  gsap.set(el, { xPercent: align === "center" ? -50 : align === "right" ? -100 : 0 });
  w.stage.appendChild(el);
  return el;
}

// Fade-and-rise for overlay text. xPercent keeps centered blocks centered while y moves.
export function textIn(tl: gsap.core.Timeline, els: HTMLElement | HTMLElement[], at: number | string, stagger = 0.12) {
  tl.fromTo(els, { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.8, ease: "power3.out", stagger }, at);
}
