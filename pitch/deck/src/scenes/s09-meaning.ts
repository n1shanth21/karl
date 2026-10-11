import * as THREE from "three";
import { Scene, text, textIn } from "../scene";
import { HUB, P } from "../props";
import { cloudShape } from "../lib/particles";
import { fader, textLabel } from "../lib/label";
import { billboard, drawableTube } from "../lib/motion";
import { chipsFade, sampleStack, stackFade } from "./s08-built";

// 9 · Semantic matching. The stack dissolves into particles that regroup into an
// embedding space; focus racks onto one cluster where "need a cheap fridge" sits right
// next to "mini fridge, $40". Move: particles regroup + depth-of-field pull.

export const FRIDGE = new THREE.Vector3(HUB.x + 2, HUB.y + 0.5, HUB.z + 6);
const OTHERS: [string, THREE.Vector3][] = [
  ["calc textbook", new THREE.Vector3(-10, 1, -5)],
  ["bike lock", new THREE.Vector3(9, -4, -7)],
  ["futon", new THREE.Vector3(-7, -5, 1)],
  ["desk lamp", new THREE.Vector3(10, 5, -3)],
  ["", new THREE.Vector3(-13, 0, -12)],
  ["", new THREE.Vector3(4, 8, -13)],
  ["", new THREE.Vector3(-2, -8, -9)],
];

let link: ReturnType<typeof drawableTube>;
export let meaningFade: { opacity: number };
const CAM_AT = FRIDGE.clone().add(new THREE.Vector3(0.6, 0.4, 15));

export const meaning: Scene = {
  id: "meaning",
  title: "Semantic matching",
  move: "particles regroup + focus pull",
  notes:
    "How does “need a cheap fridge” find “mini fridge, $40” when they share almost no words?\n\nGemini turns every listing and every want into a 768-dimension embedding. pgvector in Tiger Data finds the nearest ones.\n\nSo matching is about meaning, not keywords. Wants are bids, listings are asks, so Karl can also flag a counterpart who's close on price.",
  texts: [],

  init(w) {
    const { particles } = P;
    const centers = [FRIDGE.clone(), ...OTHERS.map(([, v]) => v.clone().add(HUB))];
    particles.setShape("cloud", cloudShape(particles.count, centers, 1.6));

    const query = textLabel(["need a cheap fridge"], { size: 44, weight: 600, bg: "#4B9CD3", pad: 22 });
    query.mesh.position.copy(FRIDGE).add(new THREE.Vector3(-2.4, 1.4, 0.6));
    const listing = textLabel(["mini fridge, $40"], { size: 44, weight: 600, bg: "#ffffff", color: "#0F1B2D", pad: 22 });
    listing.mesh.position.copy(FRIDGE).add(new THREE.Vector3(2.2, -1.2, 0.2));
    for (const l of [query, listing]) { w.scene.add(l.mesh); billboard(w, l.mesh); }

    link = drawableTube(new THREE.LineCurve3(query.mesh.position.clone().add(new THREE.Vector3(0.6, -0.45, 0)), listing.mesh.position.clone().add(new THREE.Vector3(-0.8, 0.4, 0))), 0.035, 0xffffff, 20);
    w.scene.add(link.mesh);

    const dim = OTHERS.filter(([name]) => name).map(([name, v]) => {
      const l = textLabel([name], { size: 72, weight: 500, color: "rgba(255,255,255,0.5)", align: "center" });
      l.mesh.position.copy(v).add(HUB).add(new THREE.Vector3(0, 2.4, 0));
      w.scene.add(l.mesh);
      billboard(w, l.mesh);
      return l.mat;
    });
    meaningFade = fader([query.mat, listing.mat, ...dim, link.mesh.material as THREE.Material], 0);

    this.texts = [
      text(w, "Meaning, not keywords.", { x: 140, y: 90, cls: "title" }),
      text(w, "Gemini embeddings (768 dims) · nearest-neighbor search with pgvector", { x: 142, y: 975, cls: "small" }),
    ];
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
    tl.to(meaningFade, { opacity: 1, duration: 0.8 }, 3.8);
    tl.to(link, { draw: 1, duration: 0.7, ease: "power2.out" }, 4.5);
    textIn(tl, this.texts[0], 1.2);
    textIn(tl, this.texts[1], 4.6);
  },
};
