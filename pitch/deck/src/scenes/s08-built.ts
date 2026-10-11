import * as THREE from "three";
import { Scene, text, textIn } from "../scene";
import { HUB, P } from "../props";
import { fader, textLabel } from "../lib/label";
import { param } from "../lib/motion";
import { nodesFade, wires } from "./s06-privacy";
import { blockedFade, headsUpFade } from "./s07-safety";
import { COLORS } from "../world";

// 8 · How it's built. The stack separates into layers like an exploded diagram:
// iPhone → Photon Spectrum → Karl server (modules orbiting) → Gemini + Tiger Data.
// Move: exploded view.

type Layer = { name: string; sub: string; y: number; x: number; w: number; labelSide: "left" | "right" };
const LAYERS: Layer[] = [
  { name: "iPhone", sub: "iMessage, no app", y: 6.4, x: 0, w: 12, labelSide: "left" },
  { name: "Photon Spectrum", sub: "real iMessage in and out", y: 3.2, x: 0, w: 12, labelSide: "left" },
  { name: "Karl server", sub: "Bun + TypeScript + Hono · Railway", y: 0, x: 0, w: 12, labelSide: "left" },
  { name: "Gemini", sub: "vision · tool calls · embeddings", y: -3.6, x: -3.1, w: 5.8, labelSide: "left" },
  { name: "Tiger Data", sub: "Postgres · pgvector · Timescale", y: -3.6, x: 3.1, w: 5.8, labelSide: "right" },
];
const DEPTH = 5;
const TILT = 0.32;
export const STACK_AT = new THREE.Vector3(HUB.x + 3, HUB.y + 2.3, HUB.z);

let stack: THREE.Group;
let layerGroups: THREE.Group[];
export let stackFade: { opacity: number };
export let chipsFade: { opacity: number };
function applyExplode(e: number) {
  LAYERS.forEach((l, i) => layerGroups[i].position.set(l.x * (0.3 + 0.7 * e), l.y * e, 0));
}
const explode = param(applyExplode);

export const built: Scene = {
  id: "built",
  title: "How it's built",
  move: "exploded view",
  notes:
    "Photon Spectrum gives us real iMessage in and out.\n\nGemini does three jobs: reads item photos, decides what you want and calls our tools, and makes embeddings.\n\nTiger Data holds listings, wants and matches: Postgres + pgvector, plus a Timescale hypertable and continuous aggregate for live stats.\n\nDesign rule: Gemini only picks the tool. It never writes SQL, never sends messages, never routes relays.\n\nFour of us on four branches, built against shared contracts so nobody was blocked.",
  texts: [],

  init(w) {
    stack = new THREE.Group();
    stack.position.copy(STACK_AT);
    stack.rotation.x = TILT;
    stack.scale.setScalar(0.86);
    w.scene.add(stack);
    const mats: THREE.Material[] = [];

    layerGroups = LAYERS.map((l) => {
      const g = new THREE.Group();
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(l.w, 0.24, DEPTH),
        new THREE.MeshStandardMaterial({ color: COLORS.deep, emissive: COLORS.blue, emissiveIntensity: 0.35, roughness: 0.4, transparent: true, opacity: 0.38, depthWrite: false }),
      );
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(slab.geometry), new THREE.LineBasicMaterial({ color: 0x9fd2ff, transparent: true, toneMapped: false }));
      g.add(slab, edges);
      mats.push(slab.material as THREE.Material, edges.material as THREE.Material);

      const label = textLabel([l.name, l.sub], { size: 76, weight: 500, bold: 1, color: "#fff" });
      label.mesh.rotation.x = -TILT; // face the audience
      const side = l.labelSide === "left" ? -1 : 1;
      label.mesh.position.set(side * (l.w / 2 + 0.6 + label.width / 2), 0.1, DEPTH / 2);
      g.add(label.mesh);
      mats.push(label.mat);
      stack.add(g);
      return g;
    });
    stackFade = fader(mats, 0);
    applyExplode(0);

    // the server's modules orbit it
    const chips = ["agent", "flows", "safety", "matching", "jobs"].map((name) => {
      const c = textLabel([name], { size: 60, weight: 600, bg: "#4B9CD3", pad: 20 });
      layerGroups[2].add(c.mesh);
      c.mesh.userData.ambient = true; // orbits on its own clock
      return c;
    });
    chipsFade = fader(chips.map((c) => c.mat), 0);
    w.tick((t) => {
      chips.forEach((c, i) => {
        const a = t * 0.35 + (i / chips.length) * Math.PI * 2;
        c.mesh.position.set(Math.cos(a) * 5.4, 0.9, Math.sin(a) * 2.9);
        c.mesh.rotation.x = -TILT;
        c.mesh.renderOrder = Math.sin(a) > 0 ? 3 : 1;
      });
    });

    this.texts = [
      text(w, "How it's built", { x: 140, y: 80, cls: "title" }),
      text(w, "Gemini picks the tool. Plain code does the rest.", { x: 140, y: 905, cls: "line" }),
      text(w, "the AI never writes SQL, never sends texts, never routes relays", { x: 142, y: 980, cls: "small" }),
    ];
  },

  build(w, tl) {
    const { phone, seller, logo } = P;
    // clear the relay scene
    tl.to(wires, { draw: 0, duration: 0.6, ease: "power2.in" }, 0);
    tl.to([nodesFade, headsUpFade, blockedFade], { opacity: 0, duration: 0.5 }, 0);
    tl.to([phone.group.scale, seller.group.scale], { x: 0.001, y: 0.001, z: 0.001, duration: 0.8, ease: "power2.in" }, 0);
    tl.to(logo.fade, { opacity: 0, duration: 0.6 }, 0.1);

    tl.to(w.camera.position, { x: HUB.x - 3, y: HUB.y + 4, z: HUB.z + 31, duration: 2.2 }, 0);
    tl.to(w.look, { x: HUB.x + 0.4, y: HUB.y + 1.6, z: HUB.z, duration: 2.2 }, 0);
    tl.to(stackFade, { opacity: 1, duration: 0.8 }, 0.6);
    tl.to(explode, { t: 1, duration: 2.0, ease: "power3.inOut" }, 1.0);
    tl.to(chipsFade, { opacity: 1, duration: 0.6 }, 2.6);
    textIn(tl, this.texts[0], 0.8);
    textIn(tl, this.texts.slice(1), 3.0, 0.3);
  },
};

// Points spread over the exploded slabs (world space), for particles to dissolve from.
export function sampleStack(n: number) {
  stack.updateMatrixWorld(true);
  const pos = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const l = LAYERS[i % LAYERS.length];
    v.set(l.x + (Math.random() - 0.5) * l.w, l.y + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * DEPTH);
    v.applyMatrix4(stack.matrixWorld);
    v.toArray(pos, i * 3);
  }
  return pos;
}
