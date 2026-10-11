import * as THREE from "three";
import { COLORS } from "../world";

// The monoline Karl mark in 3D: a Carolina blue rounded tile with the white bubble + k
// drawn as tubes on its face. Geometry comes from the same 1024-grid path as
// pitch/brand/karl-mark.svg, so the 3D mark matches the flat logo exactly.

export const LOGO_SIZE = 10; // world units across
const S = LOGO_SIZE / 1024;
const STROKE_R = 30 * S; // stroke-width 60 → radius 30
const TILE_DEPTH = 70 * S;
const FACE_Z = TILE_DEPTH / 2 + STROKE_R * 0.6;

// SVG coords (y down) → world (centered, y up).
const v = (x: number, y: number) => new THREE.Vector3((x - 512) * S, -(y - 512) * S, FACE_Z);

function arc(cx: number, cy: number, r: number, a0: number, a1: number, out: THREE.Vector3[]) {
  for (let i = 0; i <= 12; i++) {
    const a = THREE.MathUtils.degToRad(a0 + ((a1 - a0) * i) / 12);
    out.push(v(cx + r * Math.cos(a), cy + r * Math.sin(a)));
  }
}

function line(x0: number, y0: number, x1: number, y1: number, out: THREE.Vector3[], steps = 8) {
  for (let i = 0; i <= steps; i++) out.push(v(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps));
}

// Bubble outline: M408 256 H616 A168 … Q308 728 240 808 V424 A168 … Z
export function bubblePoints(): THREE.Vector3[] {
  const p: THREE.Vector3[] = [];
  line(408, 256, 616, 256, p);
  arc(616, 424, 168, -90, 0, p);
  line(784, 424, 784, 560, p, 4);
  arc(616, 560, 168, 0, 90, p);
  line(616, 728, 392, 728, p);
  for (let i = 0; i <= 10; i++) {
    const t = i / 10; // quadratic (392,728) ctrl (308,728) → (240,808)
    const x = (1 - t) * (1 - t) * 392 + 2 * (1 - t) * t * 308 + t * t * 240;
    const y = (1 - t) * (1 - t) * 728 + 2 * (1 - t) * t * 728 + t * t * 808;
    p.push(v(x, y));
  }
  line(240, 808, 240, 424, p);
  arc(408, 424, 168, 180, 270, p);
  // drop duplicate neighbours so the curve stays smooth
  return p.filter((pt, i) => i === 0 || pt.distanceTo(p[i - 1]) > 1e-4);
}

export const K_STROKES: [number, number, number, number][] = [
  [440, 368, 440, 616],
  [440, 556, 576, 420],
  [506, 490, 588, 616],
];

export type Logo = {
  group: THREE.Group; // position/scale this
  spin: THREE.Group; // ambient rotation lives here
  materials: THREE.MeshStandardMaterial[]; // tween .opacity to fade the whole mark
  fade: { opacity: number }; // tween this; it drives every material
};

export function createLogo(): Logo {
  const tileMat = new THREE.MeshStandardMaterial({ color: COLORS.blue, roughness: 0.35, metalness: 0.1, emissive: COLORS.blue, emissiveIntensity: 0.18, transparent: true });
  const strokeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, emissive: 0xffffff, emissiveIntensity: 0.35, transparent: true });

  const spin = new THREE.Group();
  const tile = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedSquare(), { depth: TILE_DEPTH, bevelEnabled: true, bevelSize: 12 * S, bevelThickness: 12 * S, bevelSegments: 4, curveSegments: 24 }), tileMat);
  tile.geometry.translate(0, 0, -TILE_DEPTH / 2);
  spin.add(tile);

  const bubble = new THREE.CatmullRomCurve3(bubblePoints(), true, "centripetal");
  spin.add(new THREE.Mesh(new THREE.TubeGeometry(bubble, 360, STROKE_R, 16, true), strokeMat));
  const cap = new THREE.SphereGeometry(STROKE_R, 16, 12);
  for (const [x0, y0, x1, y1] of K_STROKES) {
    const a = v(x0, y0), b = v(x1, y1);
    spin.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 8, STROKE_R, 16, false), strokeMat));
    for (const end of [a, b]) {
      const s = new THREE.Mesh(cap, strokeMat);
      s.position.copy(end);
      spin.add(s);
    }
  }

  const group = new THREE.Group();
  group.add(spin);
  const materials = [tileMat, strokeMat];
  // gsap tweens fade.opacity; the setter keeps every material in sync and hides the
  // mark completely at 0 so it never sorts in front of other transparent things.
  let o = 0;
  const fade = {
    get opacity() { return o; },
    set opacity(value: number) {
      o = value;
      for (const m of materials) { m.opacity = value; m.depthWrite = value > 0.98; }
      group.visible = value > 0.001;
    },
  };
  fade.opacity = 0;
  return { group, spin, materials, fade };
}

function roundedSquare() {
  const r = 228 * S, h = LOGO_SIZE / 2;
  const s = new THREE.Shape();
  s.moveTo(-h + r, -h);
  s.lineTo(h - r, -h);
  s.quadraticCurveTo(h, -h, h, -h + r);
  s.lineTo(h, h - r);
  s.quadraticCurveTo(h, h, h - r, h);
  s.lineTo(-h + r, h);
  s.quadraticCurveTo(-h, h, -h, h - r);
  s.lineTo(-h, -h + r);
  s.quadraticCurveTo(-h, -h, -h + r, -h);
  return s;
}

// Points spread over the mark, for particles to assemble into. White ones land on the
// strokes, blue ones on the tile face. Returns positions + whether each is a stroke point.
export function sampleLogo(n: number, strokeShare: number): { pos: Float32Array; stroke: boolean[] } {
  const bubble = bubblePoints();
  const segs: [THREE.Vector3, THREE.Vector3][] = [];
  for (let i = 0; i < bubble.length; i++) segs.push([bubble[i], bubble[(i + 1) % bubble.length]]);
  for (const [x0, y0, x1, y1] of K_STROKES) segs.push([v(x0, y0), v(x1, y1)]);
  const lengths = segs.map(([a, b]) => a.distanceTo(b));
  const total = lengths.reduce((s, l) => s + l, 0);

  const pos = new Float32Array(n * 3);
  const stroke: boolean[] = [];
  const tmp = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    if (i < n * strokeShare) {
      let r = Math.random() * total, k = 0;
      while (r > lengths[k] && k < segs.length - 1) r -= lengths[k++];
      tmp.lerpVectors(segs[k][0], segs[k][1], r / lengths[k]);
      const a = Math.random() * Math.PI * 2, rr = STROKE_R * Math.sqrt(Math.random());
      tmp.x += Math.cos(a) * rr;
      tmp.y += Math.sin(a) * rr;
      tmp.z = FACE_Z + (Math.random() - 0.5) * STROKE_R;
      stroke.push(true);
    } else {
      const h = LOGO_SIZE / 2 - 0.15;
      tmp.set((Math.random() * 2 - 1) * h, (Math.random() * 2 - 1) * h, TILE_DEPTH / 2 + 0.02);
      stroke.push(false);
    }
    tmp.toArray(pos, i * 3);
  }
  return { pos, stroke };
}
