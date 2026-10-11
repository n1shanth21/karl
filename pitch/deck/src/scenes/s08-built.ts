import * as THREE from "three";
import { Scene, text, textIn } from "../scene";
import { HUB, P } from "../props";
import { fader, textLabel } from "../lib/label";
import { drawableTube, param } from "../lib/motion";
import { nodesFade, wires } from "./s06-privacy";
import { blockedFade, headsUpFade } from "./s07-safety";
import { COLORS } from "../world";

// 8 · How it's built. The stack separates into layers like an exploded diagram:
// iPhone → Photon Spectrum → Karl server (modules orbiting) → Gemini + Tiger Data.
// Then one real event is traced through it: a seller ❤️s their draft, and a buyer who
// asked days ago gets a text. A glowing packet walks the route, each layer it reaches
// lights up, and the matching step appears in the list on the right.
// Move: exploded view + packet trace.

type Layer = { name: string; sub: string[]; y: number; x: number; w: number; labelSide: "left" | "below" };
const LAYERS: Layer[] = [
  { name: "iPhone", sub: ["iMessage is the whole UI · ❤️ = yes"], y: 6.4, x: 0, w: 12, labelSide: "left" },
  { name: "Photon Spectrum", sub: ["real iMessage in and out · 1:1 lines"], y: 3.2, x: 0, w: 12, labelSide: "left" },
  { name: "Karl server", sub: ["Bun · TypeScript · Hono · Railway"], y: 0, x: 0, w: 12, labelSide: "left" },
  { name: "Gemini", sub: ["vision → JSON", "tool calls · embeddings"], y: -3.6, x: -3.4, w: 5.8, labelSide: "below" },
  { name: "Tiger Data", sub: ["pgvector + DiskANN", "Timescale hypertable"], y: -3.6, x: 3.4, w: 5.8, labelSide: "below" },
];
const DEPTH = 5;
const TILT = 0.32;
export const STACK_AT = new THREE.Vector3(HUB.x + 3, HUB.y + 2.3, HUB.z);

// The traced route, in exploded stack coordinates: down to Karl, out to Gemini (embed),
// across to Tiger Data (search the saved wants), back up to the buyer's iPhone.
const HOVER = 0.45;
const STOPS = {
  phone: new THREE.Vector3(0, 6.4 + HOVER, 0),
  photon: new THREE.Vector3(0, 3.2 + HOVER, 0),
  karl: new THREE.Vector3(0, HOVER, 0),
  gemini: new THREE.Vector3(-3.4, -3.6 + HOVER, 0),
  tiger: new THREE.Vector3(3.4, -3.6 + HOVER, 0),
};
const ROUTE = [STOPS.phone, STOPS.photon, STOPS.karl, STOPS.gemini, STOPS.tiger, STOPS.karl, STOPS.photon, STOPS.phone];

let stack: THREE.Group;
let layerGroups: THREE.Group[];
let slabMats: THREE.MeshStandardMaterial[];
export let stackFade: { opacity: number };
export let chipsFade: { opacity: number }; // orbiting chips + the trace (the next scene fades both)
function applyExplode(e: number) {
  LAYERS.forEach((l, i) => layerGroups[i].position.set(l.x * (0.3 + 0.7 * e), l.y * e, 0));
}
const explode = param(applyExplode);

let packet: THREE.Group;
let trail: ReturnType<typeof drawableTube>;
let routeCurve: THREE.CurvePath<THREE.Vector3>;
let stopU: number[]; // route progress (0..1) at each point of ROUTE
const trace = param((u) => {
  routeCurve.getPointAt(Math.min(1, Math.max(0, u)), packet.position);
  trail.draw = u;
});

export const built: Scene = {
  id: "built",
  title: "How it's built",
  move: "exploded view + packet trace",
  notes:
    "Here's one real event going through the stack. A seller hearts their draft.\n\nThe tapback comes in through Photon. We dedupe by message id, then look that id up: Karl remembers what every message he sent was about, so a ❤️ on a draft means \"publish it.\" No LLM call. Tapbacks are our buttons.\n\nThe listing goes live, Gemini embeds it into a 768-dimension vector, and we run the search backwards: not \"what listings match this query\" but \"which saved wants does this listing satisfy,\" with a DiskANN index in Tiger Data.\n\nA hit goes onto an event bus, and Karl texts that buyer first.\n\nThe rule behind all of it: the LLM interprets, deterministic code commits. Gemini picks from 18 typed tools. It never writes SQL and never touches money. If Gemini goes down, keyword matching keeps Karl answering.",
  texts: [],

  init(w) {
    stack = new THREE.Group();
    stack.position.copy(STACK_AT);
    stack.rotation.x = TILT;
    stack.scale.setScalar(0.86);
    w.scene.add(stack);
    const mats: THREE.Material[] = [];

    slabMats = [];
    layerGroups = LAYERS.map((l) => {
      const g = new THREE.Group();
      const slabMat = new THREE.MeshStandardMaterial({ color: COLORS.deep, emissive: COLORS.blue, emissiveIntensity: 0.35, roughness: 0.4, transparent: true, opacity: 0.38, depthWrite: false });
      const slab = new THREE.Mesh(new THREE.BoxGeometry(l.w, 0.24, DEPTH), slabMat);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(slab.geometry), new THREE.LineBasicMaterial({ color: 0x9fd2ff, transparent: true, toneMapped: false }));
      g.add(slab, edges);
      slabMats.push(slabMat);
      mats.push(slabMat, edges.material as THREE.Material);

      const below = l.labelSide === "below";
      const label = textLabel([l.name, ...l.sub], { size: below ? 62 : 76, weight: 500, bold: 1, color: "#fff", align: below ? "center" : "left" });
      label.mesh.rotation.x = -TILT; // face the audience
      if (below) label.mesh.position.set(0, -0.55 - label.height / 2, DEPTH / 2);
      else label.mesh.position.set(-(l.w / 2 + 0.6 + label.width / 2), 0.1, DEPTH / 2);
      g.add(label.mesh);
      mats.push(label.mat);
      stack.add(g);
      return g;
    });
    stackFade = fader(mats, 0);
    applyExplode(0);

    // the server's modules orbit it
    const chips = ["intent router", "deal state machine", "masked relay", "safety scan", "event bus"].map((name) => {
      const c = textLabel([name], { size: 60, weight: 600, bg: "#4B9CD3", pad: 20 });
      layerGroups[2].add(c.mesh);
      c.mesh.userData.ambient = true; // orbits on its own clock
      return c;
    });
    w.tick((t) => {
      chips.forEach((c, i) => {
        const a = t * 0.3 + (i / chips.length) * Math.PI * 2;
        c.mesh.position.set(Math.cos(a) * 5.6, 0.9, Math.sin(a) * 2.9);
        c.mesh.rotation.x = -TILT;
        c.mesh.renderOrder = Math.sin(a) > 0 ? 3 : 1;
      });
    });

    // the trace: a straight-segment route, a trail that draws itself behind a glowing packet
    routeCurve = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 1; i < ROUTE.length; i++) routeCurve.add(new THREE.LineCurve3(ROUTE[i - 1], ROUTE[i]));
    const lengths = routeCurve.getCurveLengths(); // cumulative
    stopU = [0, ...lengths.map((d) => d / lengths[lengths.length - 1])];
    trail = drawableTube(routeCurve, 0.07, COLORS.ok, 400);
    (trail.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85;
    stack.add(trail.mesh);

    packet = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.32, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: COLORS.ok, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    halo.scale.setScalar(2.6);
    const heart = textLabel(["❤️"], { size: 80 });
    heart.mesh.position.set(0, 0.9, 0);
    heart.mesh.rotation.x = -TILT;
    packet.add(halo, core, heart.mesh);
    packet.scale.setScalar(0.001);
    stack.add(packet);
    routeCurve.getPointAt(0, packet.position);
    chipsFade = fader([...chips.map((c) => c.mat), trail.mesh.material as THREE.Material, core.material, halo.material, heart.mat], 0);

    const step = (n: number, head: string, detail: string) =>
      `<span class="mono blue">0${n}</span>&nbsp; <b>${head}</b><br><span class="detail">${detail}</span>`;
    const X = 1160;
    this.texts = [
      text(w, "How it's built", { x: 140, y: 80, cls: "title" }),
      text(w, "The LLM interprets. Deterministic code commits.", { x: 140, y: 905, cls: "line" }),
      text(w, "18 typed tools · Gemini never writes SQL or moves money · keyword fallback if Gemini is down", { x: 142, y: 980, cls: "small" }),
      text(w, "trace: a seller ❤️s their draft", { x: X, y: 120, cls: "small mono" }),
      text(w, step(1, "❤️ arrives over Photon", "deduped by message id"), { x: X, y: 200, cls: "step" }),
      text(w, step(2, "message id → intent: publish", "tapbacks are buttons · no LLM call"), { x: X, y: 320, cls: "step" }),
      text(w, step(3, "Gemini embeds the listing", "768-d vector, stored in Tiger Data"), { x: X, y: 440, cls: "step" }),
      text(w, step(4, "search runs in reverse", "listing → every saved want · DiskANN"), { x: X, y: 560, cls: "step" }),
      text(w, step(5, "match_found on the event bus", "Karl texts the buyer first"), { x: X, y: 680, cls: "step" }),
    ];
  },

  build(w, tl) {
    const { phone, seller, logo } = P;
    const [title, rule, ruleSmall, traceHead, ...steps] = this.texts;
    // clear the relay scene
    tl.to(wires, { draw: 0, duration: 0.6, ease: "power2.in" }, 0);
    tl.to([nodesFade, headsUpFade, blockedFade], { opacity: 0, duration: 0.5 }, 0);
    tl.to([phone.group.scale, seller.group.scale], { x: 0.001, y: 0.001, z: 0.001, duration: 0.8, ease: "power2.in" }, 0);
    tl.to(logo.fade, { opacity: 0, duration: 0.6 }, 0.1);

    // the stack sits left of center so the trace list fits on the right
    tl.to(w.camera.position, { x: HUB.x + 1.4, y: HUB.y + 3.6, z: HUB.z + 36, duration: 2.2 }, 0);
    tl.to(w.look, { x: HUB.x + 5.4, y: HUB.y + 1.2, z: HUB.z, duration: 2.2 }, 0);
    tl.to(stackFade, { opacity: 1, duration: 0.8 }, 0.6);
    tl.to(explode, { t: 1, duration: 2.0, ease: "power3.inOut" }, 1.0);
    tl.to(chipsFade, { opacity: 1, duration: 0.6 }, 2.6);
    textIn(tl, title, 0.8);
    textIn(tl, traceHead, 2.6);

    // the trace: the packet pops in at the seller's phone, then walks the route stop by stop
    const T0 = 3.2;
    tl.to(packet.scale, { x: 1, y: 1, z: 1, duration: 0.4, ease: "back.out(2)" }, T0);
    const legs: { to: number; layer: number; step?: number; dur: number }[] = [
      { to: 1, layer: 1, step: 0, dur: 0.6 }, // → Photon
      { to: 2, layer: 2, step: 1, dur: 0.6 }, // → Karl
      { to: 3, layer: 3, step: 2, dur: 0.7 }, // → Gemini
      { to: 4, layer: 4, step: 3, dur: 0.7 }, // → Tiger Data
      { to: 5, layer: 2, dur: 0.6 }, // → back to Karl
      { to: 7, layer: 0, step: 4, dur: 1.0 }, // → up to the buyer's iPhone
    ];
    let at = T0 + 0.4;
    for (const leg of legs) {
      tl.to(trace, { t: stopU[leg.to], duration: leg.dur, ease: "power2.inOut" }, at);
      at += leg.dur;
      flash(tl, slabMats[leg.layer], at);
      if (leg.step !== undefined) textIn(tl, steps[leg.step], at - 0.1);
      at += leg.step !== undefined ? 0.45 : 0.1;
    }
    tl.to(packet.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.4, ease: "power2.in" }, at + 0.3);
    textIn(tl, [rule, ruleSmall], at + 0.2, 0.3);
  },
};

// A layer lights up as the packet reaches it.
function flash(tl: gsap.core.Timeline, mat: THREE.MeshStandardMaterial, at: number) {
  tl.fromTo(mat, { emissiveIntensity: 0.35 }, { emissiveIntensity: 1.6, duration: 0.18, yoyo: true, repeat: 1, ease: "power2.out", immediateRender: false }, at - 0.05);
}

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

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
