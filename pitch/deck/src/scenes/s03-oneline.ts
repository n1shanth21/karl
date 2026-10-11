import * as THREE from "three";
import { Scene, text, textIn } from "../scene";
import { HUB, P } from "../props";
import { createBubble } from "../lib/bubble";
import { fader } from "../lib/label";
import { param } from "../lib/motion";

const well = param(applyWell);

// 3 · Karl in one line. A gravity well pulls every scattered post into one point,
// and a single iMessage bubble pops out of it. Move: gravity-well pull.

// well.t: 0 = cards float free, 1 = all swallowed
let core: THREE.Mesh;
export let bubble: THREE.Group;
let coreFade: { opacity: number };

function applyWell(p: number) {
  const n = P.cards.length;
  for (let i = 0; i < n; i++) {
    const c = P.cards[i];
    const delay = (i / n) * 0.45 + c.seed * 0.1;
    const e = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp((p - delay) / 0.45, 0, 1), 0, 1);
    c.mesh.userData.free = e === 0;
    if (e === 0) { c.mesh.position.copy(c.home); c.mesh.scale.setScalar(1); continue; }
    const rel = c.home.clone().sub(HUB);
    const r = Math.hypot(rel.x, rel.y) * (1 - e);
    const a = Math.atan2(rel.y, rel.x) + e * e * 5;
    c.mesh.position.set(HUB.x + Math.cos(a) * r, HUB.y + Math.sin(a) * r, HUB.z + rel.z * (1 - e) * (1 - e));
    c.mesh.scale.setScalar(Math.max(0.001, 1 - e));
  }
}

export const oneLine: Scene = {
  id: "one-line",
  title: "Karl in one line",
  move: "gravity well",
  notes:
    "So we built Karl. You text him what you're selling or what you want, once.\n\nThen he does the work: he remembers it, finds the other person, negotiates, and sets up the meetup.\n\nFacebook Marketplace makes you search. Karl texts you when the thing you want shows up.",
  texts: [],

  init(w) {
    core = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial({ color: 0x9fd2ff, transparent: true, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false }));
    core.position.copy(HUB);
    core.scale.setScalar(0.001);
    coreFade = fader([core.material as THREE.Material], 0);
    w.scene.add(core);

    bubble = createBubble(["need a desk lamp", "under $20"]);
    bubble.position.copy(HUB);
    bubble.scale.setScalar(0.001);
    w.scene.add(bubble);
    w.tick((t) => { bubble.rotation.y = Math.sin(t * 0.6) * 0.12; });

    this.texts = [
      text(w, "Tell Karl once. He does the looking.", { x: 960, y: 120, cls: "title", align: "center" }),
      text(w, "Karl texts <i>you</i> when the thing you want shows up.", { x: 960, y: 900, cls: "line", align: "center" }),
    ];
  },

  build(w, tl) {
    tl.to(w.camera.position, { x: 0, y: 0, z: HUB.z + 24, duration: 3.2, ease: "power2.inOut" }, 0);
    tl.to(w.look, { x: HUB.x, y: HUB.y, z: HUB.z, duration: 2.4, ease: "power2.inOut" }, 0);
    tl.to(well, { t: 1, duration: 3.2, ease: "power2.in" }, 0.1);
    tl.to(P.particles.look, { opacity: 0.35, duration: 2 }, 0.5);
    // the swallowed posts flash in the core, then one bubble pops out
    tl.to(coreFade, { opacity: 0.9, duration: 0.6 }, 2.4);
    tl.to(core.scale, { x: 1.4, y: 1.4, z: 1.4, duration: 0.8, ease: "power2.in" }, 2.4);
    tl.to(core.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.35, ease: "power2.in" }, 3.25);
    tl.to(coreFade, { opacity: 0, duration: 0.35 }, 3.25);
    tl.to(bubble.scale, { x: 1.25, y: 1.25, z: 1.25, duration: 1.1, ease: "back.out(2.2)" }, 3.3);
    textIn(tl, this.texts[0], 3.6);
    textIn(tl, this.texts[1], 4.6);
  },
};
