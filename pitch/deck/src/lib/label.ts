import * as THREE from "three";

// Text and simple cards drawn on a canvas and shown on a plane in 3D.
// Big headline text lives in the HTML overlay; these are for things that must sit in
// the world (pins, packets, layer names). Drawn at 4x so they stay sharp up close.

const FONT = '"Inter Variable", -apple-system, sans-serif';
const PX = 4; // canvas pixels per CSS-ish pixel
export const UNIT = 100; // canvas px (before PX) per world unit

export type Label = { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; redraw: (draw: Draw) => void };
export type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

// A plane of w x h world units, painted by `draw` (coords in "CSS" px: w*UNIT by h*UNIT).
export function canvasPlane(w: number, h: number, draw: Draw): Label {
  const cw = Math.round(w * UNIT), ch = Math.round(h * UNIT);
  const canvas = document.createElement("canvas");
  canvas.width = cw * PX;
  canvas.height = ch * PX;
  const ctx = canvas.getContext("2d")!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  // a touch under full white so labels stay crisp instead of blooming
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xd2d2d2, transparent: true, depthWrite: false, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  const redraw = (fn: Draw) => {
    ctx.setTransform(PX, 0, 0, PX, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    fn(ctx, cw, ch);
    tex.needsUpdate = true;
  };
  redraw(draw);
  return { mesh, mat, redraw };
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function font(weight: number, size: number) {
  return `${weight} ${size}px ${FONT}`;
}

// A single line (or a few lines) of text, auto-sized plane. Returns the label + its size.
export function textLabel(
  lines: string[],
  opts: { size?: number; weight?: number; color?: string; bg?: string; pad?: number; radius?: number; align?: CanvasTextAlign; bold?: number } = {},
) {
  const size = opts.size ?? 40, weight = opts.weight ?? 600, pad = opts.pad ?? 0;
  const measure = document.createElement("canvas").getContext("2d")!;
  const widths = lines.map((l, i) => {
    measure.font = font(i < (opts.bold ?? 0) ? 700 : weight, size);
    return measure.measureText(l).width;
  });
  const cw = Math.ceil(Math.max(...widths) + pad * 2 + 4);
  const lh = size * 1.25;
  const ch = Math.ceil(lines.length * lh + pad * 2 - (lh - size) + 8);
  const label = canvasPlane(cw / UNIT, ch / UNIT, (ctx, w, h) => {
    if (opts.bg) {
      ctx.fillStyle = opts.bg;
      roundRect(ctx, 0, 0, w, h, opts.radius ?? Math.min(h / 2, 28));
      ctx.fill();
    }
    ctx.fillStyle = opts.color ?? "#fff";
    ctx.textBaseline = "top";
    ctx.textAlign = opts.align ?? "left";
    const x = opts.align === "center" ? w / 2 : pad + 2;
    lines.forEach((l, i) => {
      ctx.font = font(i < (opts.bold ?? 0) ? 700 : weight, size);
      ctx.fillText(l, x, pad + 4 + i * lh);
    });
  });
  return { ...label, width: cw / UNIT, height: ch / UNIT };
}

// Fade helper: tween `{opacity}` on a group of materials at once.
export function fader(mats: THREE.Material[], start = 0) {
  let o = start;
  const apply = () => mats.forEach((m) => { m.opacity = o; m.visible = o > 0.001; });
  apply();
  return {
    get opacity() { return o; },
    set opacity(v: number) { o = v; apply(); },
  };
}
