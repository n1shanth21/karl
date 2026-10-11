import * as THREE from "three";

// Small low-poly "things people trade" that float inside the embedding cloud of scene 9.
// Each item is a Group of a few boxes / a torus, lit by the world lights, with a thin
// glowing edge outline. Materials are created per item (a handful each) so an item can be
// dimmed or pulsed on its own; geometries are tiny and shared by shape.
//
// Everything is driven by plain setters (presence / dim / glow / tick) so a gsap timeline
// can run them forwards and backwards. Nothing is allocated per frame.

const NAVY = new THREE.Color("#0F1B2D");
const BLUE = 0x4b9cd3;

export type Item = {
  root: THREE.Group; // positioned by the caller; scaled by presence
  anchor: THREE.Vector3; // resting position the bob is added to
  setPresence(p: number): void; // 0 = gone, 1 = fully popped in
  setDim(d: number): void; // 0 = normal, 1 = dimmed into the background
  setGlow(g: number): void; // 0..1 extra emissive + slight scale-up (the "pulse")
  tick(t: number): void; // ambient bob + sway, call every frame
  mats: THREE.Material[];
};

type Tracked = { mat: THREE.MeshStandardMaterial; color: THREE.Color; ei: number } | { line: THREE.LineBasicMaterial; color: THREE.Color };

// Builds an item: registers materials so dim/glow can restyle them all.
class Kit {
  root = new THREE.Group();
  body = new THREE.Group(); // inner group the pulse scales
  tracked: Tracked[] = [];
  mats: THREE.Material[] = [];
  constructor() { this.root.add(this.body); }

  std(color: number | string, o: { emissive?: number; ei?: number; rough?: number; metal?: number } = {}) {
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: o.rough ?? 0.55,
      metalness: o.metal ?? 0.1,
      flatShading: true,
      emissive: o.emissive ?? 0x000000,
      emissiveIntensity: o.ei ?? 0,
    });
    this.tracked.push({ mat, color: mat.color.clone(), ei: o.ei ?? 0 });
    this.mats.push(mat);
    return mat;
  }
  line(color: number | string = BLUE, opacity = 0.9) {
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity, toneMapped: false });
    this.tracked.push({ line: mat, color: mat.color.clone() });
    this.mats.push(mat);
    return mat;
  }
  // A box with an optional edge outline.
  box(parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, pos: [number, number, number], edge?: THREE.LineBasicMaterial) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    parent.add(m);
    if (edge) {
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edge);
      e.position.copy(m.position);
      parent.add(e);
    }
    return m;
  }

  finish(anchor: THREE.Vector3, motion: { bob: number; sway: number; spin?: number; speed?: number; phase: number; scale?: number }): Item {
    const { root, body, tracked } = this;
    const base = motion.scale ?? 1;
    const dark = new THREE.Color();
    let dim = 0, glow = 0;
    const restyle = () => {
      for (const t of tracked) {
        if ("mat" in t) {
          t.mat.color.copy(t.color).lerp(dark.copy(NAVY), 0.6 * dim);
          t.mat.emissiveIntensity = t.ei * (1 - dim) + glow * 0.5;
        } else {
          t.line.color.copy(t.color).lerp(dark.copy(NAVY), 0.8 * dim);
          t.line.opacity = 0.9 * (1 - 0.55 * dim);
        }
      }
    };
    root.visible = false;
    root.scale.setScalar(0.0001);
    const item: Item = {
      root, anchor: anchor.clone(), mats: this.mats,
      setPresence(p) {
        root.visible = p > 0.001;
        root.scale.setScalar(Math.max(p, 0.0001) * base);
      },
      setDim(d) { dim = d; restyle(); },
      setGlow(g) {
        glow = g;
        body.scale.setScalar(1 + 0.09 * g);
        restyle();
      },
      tick(t) {
        if (!root.visible) return;
        const s = (motion.speed ?? 1) * t;
        root.position.set(this.anchor.x, this.anchor.y + Math.sin(s * 0.9 + motion.phase) * motion.bob, this.anchor.z);
        root.rotation.y = Math.sin(s * 0.45 + motion.phase) * motion.sway + (motion.spin ?? 0) * s;
        root.rotation.x = Math.sin(s * 0.6 + motion.phase * 2) * 0.05;
      },
    };
    root.position.copy(anchor);
    return item;
  }
}

const W = 0xdfeaf5;

// A mini fridge: dark carcass, freezer door + main door with a seam, a handle, little feet.
export function createFridge(anchor: THREE.Vector3): Item {
  const k = new Kit();
  const carcass = k.std("#1a3150", { rough: 0.7 });
  const door = k.std(W, { rough: 0.35, metal: 0.25, emissive: 0xcfe6f7, ei: 0.22 });
  const handle = k.std(BLUE, { emissive: BLUE, ei: 0.9, rough: 0.3 });
  const edge = k.line(BLUE);
  const b = k.body;
  k.box(b, 1.4, 2.1, 1.2, carcass, [0, 0, 0], edge);
  // doors sit proud of the carcass; the 0.05 gap between them is the seam
  k.box(b, 1.32, 0.6, 0.07, door, [0, 0.72, 0.63], edge);
  k.box(b, 1.32, 1.3, 0.07, door, [0, -0.28, 0.63], edge);
  k.box(b, 0.07, 0.34, 0.1, handle, [0.5, 0.58, 0.72]); // freezer pull
  k.box(b, 0.07, 0.7, 0.1, handle, [0.5, -0.1, 0.72]); // main pull
  k.box(b, 0.14, 0.1, 0.14, carcass, [-0.55, -1.1, 0.4]);
  k.box(b, 0.14, 0.1, 0.14, carcass, [0.55, -1.1, 0.4]);
  k.box(b, 0.14, 0.1, 0.14, carcass, [-0.55, -1.1, -0.4]);
  k.box(b, 0.14, 0.1, 0.14, carcass, [0.55, -1.1, -0.4]);
  return k.finish(anchor, { bob: 0.12, sway: 0.34, phase: 0.4, scale: 1.3 });
}

// Three textbooks, stacked and slightly skewed.
export function createBooks(anchor: THREE.Vector3): Item {
  const k = new Kit();
  const pages = k.std("#e9eef4", { rough: 0.9 });
  const edge = k.line(0xffffff, 0.55);
  const covers = [k.std("#2f7db5", { emissive: BLUE, ei: 0.12 }), k.std("#e8edf3", { emissive: 0x888888, ei: 0.06 }), k.std("#4b9cd3", { emissive: BLUE, ei: 0.2 })];
  const dims: [number, number][] = [[1.9, 1.3], [1.7, 1.2], [1.5, 1.05]];
  let y = -0.4;
  covers.forEach((cover, i) => {
    const [w, d] = dims[i];
    const g = new THREE.Group();
    const h = 0.34 - i * 0.04;
    k.box(g, w, 0.05, d, cover, [0, -h / 2 + 0.025, 0], edge); // bottom board
    k.box(g, w, 0.05, d, cover, [0, h / 2 - 0.025, 0], edge); // top board
    k.box(g, 0.07, h, d, cover, [-w / 2 + 0.035, 0, 0]); // spine
    k.box(g, w - 0.12, h - 0.1, d - 0.06, pages, [0.04, 0, 0]); // page block
    g.position.y = y + h / 2;
    g.rotation.y = (i - 1) * 0.28 + 0.1;
    k.body.add(g);
    y += h + 0.005;
  });
  return k.finish(anchor, { bob: 0.14, sway: 0.5, phase: 1.9, scale: 1 });
}

// A bike wheel: tire torus, rim, a hub and spokes (spokes are one LineSegments).
export function createWheel(anchor: THREE.Vector3): Item {
  const k = new Kit();
  const tire = k.std("#16263f", { rough: 0.8, emissive: BLUE, ei: 0.1 });
  const rim = k.std(W, { rough: 0.3, metal: 0.5, emissive: 0x9fc9e8, ei: 0.2 });
  const spoke = k.line(0xffffff, 0.7);
  const wheel = new THREE.Group();
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.16, 6, 28), tire));
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(1.03, 0.045, 5, 28), rim));
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.2, 8), rim);
  hub.rotation.x = Math.PI / 2;
  wheel.add(hub);
  const pts: number[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    pts.push(0, 0, 0.03 * (i % 2 ? 1 : -1), Math.cos(a) * 1.03, Math.sin(a) * 1.03, 0);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  wheel.add(new THREE.LineSegments(sg, spoke));
  wheel.rotation.y = 0.5; // a three-quarter view, not edge-on or flat
  k.body.add(wheel);
  const item = k.finish(anchor, { bob: 0.16, sway: 0.25, phase: 3.1 });
  const base = item.tick;
  item.tick = (t) => { base.call(item, t); wheel.rotation.z = t * 0.5; };
  return item;
}

let screenTex: THREE.CanvasTexture | undefined;
function screenTexture() {
  if (screenTex) return screenTex;
  const c = document.createElement("canvas");
  c.width = 128; c.height = 80;
  const g = c.getContext("2d")!;
  g.fillStyle = "#12304f"; g.fillRect(0, 0, 128, 80);
  g.fillStyle = "#4B9CD3";
  [[10, 12, 54], [10, 24, 80], [10, 36, 36], [10, 48, 64], [10, 60, 44]].forEach(([x, y, w]) => g.fillRect(x, y, w, 5));
  g.fillStyle = "rgba(255,255,255,0.8)"; g.fillRect(92, 12, 26, 26);
  screenTex = new THREE.CanvasTexture(c);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  return screenTex;
}

// A monitor on a stand.
export function createMonitor(anchor: THREE.Vector3): Item {
  const k = new Kit();
  const bezel = k.std("#1a2b45", { rough: 0.4, metal: 0.3 });
  const stand = k.std("#9fb8d0", { rough: 0.35, metal: 0.6 });
  const edge = k.line(BLUE);
  const screen = new THREE.MeshStandardMaterial({ map: screenTexture(), emissive: 0xffffff, emissiveMap: screenTexture(), emissiveIntensity: 0.6, roughness: 0.4 });
  k.mats.push(screen);
  const b = k.body;
  k.box(b, 2.3, 1.45, 0.1, bezel, [0, 0.35, 0], edge);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.25), screen);
  face.position.set(0, 0.35, 0.056);
  b.add(face);
  k.box(b, 0.14, 0.55, 0.1, stand, [0, -0.65, -0.04]);
  k.box(b, 0.8, 0.07, 0.5, stand, [0, -0.95, 0], edge);
  const item = k.finish(anchor, { bob: 0.1, sway: 0.4, phase: 4.6 });
  // the screen is not a tracked material: dim it through its emissive too
  const setDim = item.setDim;
  item.setDim = (d) => { setDim(d); screen.emissiveIntensity = 0.6 * (1 - 0.85 * d); screen.color.setScalar(1 - 0.7 * d); };
  return item;
}

// A futon: seat cushion, tilted back, two stubby frame legs.
export function createFuton(anchor: THREE.Vector3): Item {
  const k = new Kit();
  const cushion = k.std("#2f7db5", { rough: 0.9, emissive: BLUE, ei: 0.08 });
  const frame = k.std("#c9d6e3", { rough: 0.5 });
  const edge = k.line(0xffffff, 0.5);
  const b = k.body;
  k.box(b, 2.3, 0.34, 1.2, cushion, [0, -0.2, 0.1], edge);
  const back = k.box(b, 2.3, 0.85, 0.28, cushion, [0, 0.2, -0.5], edge);
  back.rotation.x = -0.22;
  k.box(b, 0.14, 0.4, 1.2, frame, [-1.1, -0.55, 0.1]);
  k.box(b, 0.14, 0.4, 1.2, frame, [1.1, -0.55, 0.1]);
  return k.finish(anchor, { bob: 0.12, sway: 0.4, phase: 5.7, scale: 0.9 });
}
