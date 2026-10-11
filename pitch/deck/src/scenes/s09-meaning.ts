import * as THREE from "three";
import { Scene, text, textIn } from "../scene";
import { HUB, P } from "../props";
import { cloudShape } from "../lib/particles";
import { textLabel } from "../lib/label";
import { billboard, drawableTube, param } from "../lib/motion";
import { COLORS } from "../world";
import { Item, createBooks, createFridge, createFuton, createMonitor, createWheel } from "../lib/items";
import { chipsFade, sampleStack, stackFade } from "./s08-built";

// 9 · Semantic matching. The stack dissolves into particles that regroup into an
// embedding space; focus racks onto one cluster where "need a cheap fridge" sits right
// next to "mini fridge, $40". Move: particles regroup + depth-of-field pull.

export const FRIDGE = new THREE.Vector3(HUB.x + 2, HUB.y + 0.5, HUB.z + 6);
const OTHERS: [string, THREE.Vector3][] = [
  ["calc textbook", new THREE.Vector3(-10, 1, -5)],
  ["bike wheel", new THREE.Vector3(12, -7, -6)],
  ["futon", new THREE.Vector3(-7.5, -3.6, 1)],
  ["monitor", new THREE.Vector3(10, 5, -3)],
  ["", new THREE.Vector3(-13, 0, -12)],
  ["", new THREE.Vector3(4, 8, -13)],
  ["", new THREE.Vector3(-2, -8, -9)],
];

let link: ReturnType<typeof drawableTube>;
let fx: Record<"orb" | "q" | "tag" | "beam" | "ring" | "pulse" | "pick", { t: number }>;
const CAM_AT = FRIDGE.clone().add(new THREE.Vector3(0.6, 0.4, 15));

// Scene 9 is driven by one master fade (`meaningFade`, also faded out by scene 10) plus a few
// own values. sync() turns them into every object's state, so any rewind or jump lands right.
//   m     master: 0..0.45 the items pop in, 0.45..1 the labels / beam fade in
//   orb   the query orb's flight along its path (0 = off-screen, 1 = hovering by the fridge)
//   q     the query label's own fade   tag  the "mini fridge" tag's own fade
//   pick  nearest-neighbor emphasis: others dim, fridge cluster brightens
const S = { m: 0, orb: 0, q: 0, tag: 0, pick: 0 };
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const backOut = (x: number) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);
let sync: () => void = () => {};
export const meaningFade = {
  get opacity() { return S.m; },
  set opacity(v: number) { S.m = v; sync(); },
};

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.5)");
  grad.addColorStop(0.7, "rgba(255,255,255,0.12)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const setOp = (m: THREE.Material, o: number) => { m.opacity = o; m.visible = o > 0.003; };

export const meaning: Scene = {
  id: "meaning",
  title: "Semantic matching",
  move: "particles regroup + focus pull",
  notes:
    "How does “something to keep drinks cold” find “mini fridge, $40”? They share zero words. Keyword search would miss it.\n\nGemini embeds every listing and every want into a 768-dimension vector, so things that mean the same thing land close together. Tiger Data runs cosine nearest-neighbor search over them with pgvector and a DiskANN index.\n\nAnd price is part of the match: wants are bids, listings are asks. If they're close, Karl tells both sides so they can meet in the middle.",
  texts: [],

  init(w) {
    const { particles } = P;
    const centers = [FRIDGE.clone(), ...OTHERS.map(([, v]) => v.clone().add(HUB))];
    particles.setShape("cloud", cloudShape(particles.count, centers, 1.6));

    // --- the things floating in the cloud: the fridge, plus one item per other named cluster
    const at = (i: number) => OTHERS[i][1].clone().add(HUB);
    const fridge = createFridge(FRIDGE);
    const others: Item[] = [createBooks(at(0)), createWheel(at(1)), createFuton(at(2)), createMonitor(at(3))];
    const items = [fridge, ...others];
    for (const it of items) w.scene.add(it.root);
    w.tick((t) => { for (const it of items) it.tick(t); });

    // --- glow behind the fridge, dimmers over the other clusters, a pulse ring
    const glowTex = glowTexture();
    const fridgeGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: COLORS.blue, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    fridgeGlow.position.copy(FRIDGE).add(new THREE.Vector3(0, 0, -1));
    fridgeGlow.scale.setScalar(6);
    w.scene.add(fridgeGlow);

    // navy sprites in front of the other clusters, drawn after the particles: they darken what is behind
    const dimMat = new THREE.SpriteMaterial({ map: glowTex, color: COLORS.navy, transparent: true, opacity: 0, depthWrite: false, fog: false });
    const dimmers = OTHERS.map(([, v]) => {
      const sp = new THREE.Sprite(dimMat);
      sp.position.copy(v).add(HUB).add(new THREE.Vector3(0, 0, 2.5));
      sp.scale.setScalar(9);
      sp.renderOrder = 6;
      w.scene.add(sp);
      return sp;
    });

    const ringMat = new THREE.MeshBasicMaterial({ color: COLORS.blue, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 48), ringMat);
    ring.position.copy(FRIDGE).add(new THREE.Vector3(0, 0, 0.9));
    ring.visible = false;
    w.scene.add(ring);
    billboard(w, ring);

    // --- the query orb: flies in along a curve and hovers up-left of the fridge
    const ORB = FRIDGE.clone().add(new THREE.Vector3(-3.0, 1.9, 0.6));
    const flight = new THREE.CatmullRomCurve3([
      ORB.clone().add(new THREE.Vector3(-9, 4.5, 5)),
      ORB.clone().add(new THREE.Vector3(-5, 0.6, 3)),
      ORB.clone().add(new THREE.Vector3(-1.6, 0.5, 1)),
      ORB.clone(),
    ]);
    const orb = new THREE.Group();
    const orbMat = new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, toneMapped: false });
    orb.add(new THREE.Mesh(new THREE.SphereGeometry(0.24, 20, 14), orbMat));
    const haloMat = new THREE.SpriteMaterial({ map: glowTex, color: 0x7fc0ee, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const halo = new THREE.Sprite(haloMat);
    halo.scale.setScalar(2.4);
    orb.add(halo);
    const trail = [0.9, 0.7, 0.5, 0.35].map((s) => {
      const sp = new THREE.Sprite(haloMat);
      sp.scale.setScalar(s * 1.4);
      sp.visible = false;
      w.scene.add(sp);
      return sp;
    });
    orb.visible = false;
    w.scene.add(orb);

    const query = textLabel(["something to keep drinks cold"], { size: 38, weight: 600, bg: "#4B9CD3", pad: 18 });
    query.mesh.position.copy(ORB).add(new THREE.Vector3(0.2, 0.95, 0));
    const listing = textLabel(["mini fridge, $40"], { size: 38, weight: 600, bg: "#ffffff", color: "#0F1B2D", pad: 18 });
    listing.mesh.position.copy(FRIDGE).add(new THREE.Vector3(3.3, -0.85, 0.4));
    for (const l of [query, listing]) { w.scene.add(l.mesh); billboard(w, l.mesh); }

    // the beam: a curved tube from the orb to the fridge's left face, with a bright head
    const END = FRIDGE.clone().add(new THREE.Vector3(-0.78, 0.35, 0.4));
    const arc = new THREE.QuadraticBezierCurve3(ORB.clone().add(new THREE.Vector3(0.25, -0.05, 0)), ORB.clone().lerp(END, 0.5).add(new THREE.Vector3(0, 0.9, 0.7)), END);
    link = drawableTube(arc, 0.04, 0x9fd4f5, 40);
    w.scene.add(link.mesh);
    const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    head.scale.setScalar(0.9);
    head.visible = false;
    w.scene.add(head);

    const dimLabels = OTHERS.filter(([name]) => name).map(([name, v]) => {
      const l = textLabel([name], { size: 72, weight: 500, color: "rgba(255,255,255,0.5)", align: "center" });
      l.mesh.position.copy(v).add(HUB).add(new THREE.Vector3(0, 2.4, 0));
      w.scene.add(l.mesh);
      billboard(w, l.mesh);
      return l.mat;
    });

    // --- the one place that derives every object's state from S (see above)
    const tmp = new THREE.Vector3();
    let beamT = 0, ringT = 0;
    sync = () => {
      const mi = clamp01(S.m / 0.45), ml = clamp01((S.m - 0.45) / 0.55);
      items.forEach((it, i) => it.setPresence(backOut(clamp01(mi * 1.7 - i * 0.2))));
      const fly = clamp01(S.orb * 5) * ml;
      orb.visible = fly > 0.003;
      setOp(orbMat, fly); setOp(haloMat, fly * 0.8);
      for (const t of trail) t.visible = orb.visible && S.orb < 0.97;
      setOp(query.mat, ml * S.q);
      setOp(listing.mat, ml * S.tag);
      for (const m of dimLabels) setOp(m, ml * (1 - 0.6 * S.pick));
      setOp(link.mesh.material as THREE.Material, ml);
      head.visible = ml > 0.01 && beamT > 0.01 && beamT < 0.985;
      setOp(fridgeGlow.material, 0.36 * S.pick * ml);
      setOp(dimMat, 0.72 * S.pick * ml);
      for (const d of dimmers) d.visible = dimMat.visible;
      setOp(ringMat, 0.55 * (1 - ringT) * ml);
      ring.visible = ringT > 0.001 && ringT < 0.999 && ml > 0.01;
    };
    fx = {
      orb: param((v) => {
        S.orb = v;
        flight.getPoint(v, orb.position);
        // a short comet tail that closes up as the orb settles
        trail.forEach((t, k) => flight.getPoint(Math.max(0, v - (k + 1) * 0.06 * (1 - v)), t.position));
        sync();
      }),
      q: param((v) => { S.q = v; sync(); }),
      tag: param((v) => { S.tag = v; sync(); }),
      beam: param((v) => {
        beamT = v;
        link.draw = v;
        arc.getPoint(v, head.position);
        sync();
      }),
      ring: param((v) => { ringT = v; ring.scale.setScalar(1.5 + v * 1.6); sync(); }),
      // 0 -> 1 -> 0 twice: the fridge pulses
      pulse: param((v) => fridge.setGlow(0.5 - 0.5 * Math.cos(v * Math.PI * 4))),
      pick: param((v) => { S.pick = v; others.forEach((it) => it.setDim(v)); sync(); }),
    };
    void tmp;

    this.texts = [
      text(w, "Semantic search, not keyword search.", { x: 140, y: 90, cls: "title" }),
      text(w, "768-d Gemini embeddings · cosine nearest-neighbor via pgvector + DiskANN in Tiger Data", { x: 142, y: 975, cls: "small" }),
    ];
    sync();
  },

  build(w, tl) {
    const { particles } = P;
    particles.setShape("layers", sampleStack(particles.count));
    // the slabs turn to particles…
    tl.to(particles.w, { dust: 0, layers: 1, duration: 1.3, ease: "power2.inOut" }, 0);
    tl.to(particles.look, { opacity: 0.9, size: 2.2, duration: 1.0 }, 0);
    tl.to([stackFade, chipsFade], { opacity: 0, duration: 0.9 }, 0.7);
    // …which regroup into clusters of meaning
    tl.to(particles.w, { layers: 0, cloud: 1, duration: 2.6, ease: "power2.inOut" }, 1.5);
    tl.to(w.camera.position, { x: CAM_AT.x, y: CAM_AT.y, z: CAM_AT.z, duration: 3.4, ease: "power2.inOut" }, 1.3);
    tl.to(w.look, { x: FRIDGE.x, y: FRIDGE.y, z: FRIDGE.z, duration: 3.4, ease: "power2.inOut" }, 1.3);
    // rack focus onto the fridge cluster
    tl.to(particles.look, { focus: CAM_AT.distanceTo(FRIDGE), dof: 0.11, duration: 1.6, ease: "power2.inOut" }, 3.4);
    // the things pop into the cloud as it forms, then the query orb arrives and finds its neighbor
    tl.to(meaningFade, { opacity: 1, duration: 1.7, ease: "none" }, 2.4);
    tl.to(fx.orb, { t: 1, duration: 1.0, ease: "power3.out" }, 3.7);
    tl.to(fx.q, { t: 1, duration: 0.5 }, 4.3);
    tl.to(fx.beam, { t: 1, duration: 0.8, ease: "power2.inOut" }, 4.9);
    tl.to(fx.tag, { t: 1, duration: 0.5 }, 5.5);
    tl.to(fx.ring, { t: 1, duration: 0.9, ease: "power2.out" }, 5.6);
    tl.to(fx.pulse, { t: 1, duration: 1.0, ease: "none" }, 5.6);
    tl.to(fx.pick, { t: 1, duration: 0.9 }, 5.6);
    textIn(tl, this.texts[0], 1.2);
    textIn(tl, this.texts[1], 5.0);
  },
};
