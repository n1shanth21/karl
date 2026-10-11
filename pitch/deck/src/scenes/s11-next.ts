import * as THREE from "three";
import { Scene, text, textIn } from "../scene";
import { HUB } from "../props";
import { drawableTube } from "../lib/motion";
import { pillarFade, pillars } from "./s10-traction";
import { COLORS } from "../world";

// 11 · What's next. A road of light draws itself into the distance and milestones
// light up one by one as the camera glides along it. Move: path extends + fly-along.

const ROAD = new THREE.CatmullRomCurve3(
  [0, -12, -30, -55, -85, -120, -160].map((dz, i) => new THREE.Vector3(HUB.x + 9 + Math.sin(i * 0.9) * 4, HUB.y - 4, HUB.z + 6 + dz)),
);
const STOPS = [0.16, 0.34, 0.55, 0.8];
export const MILESTONES = ["UNC email verification", "Move-out week launch", "Ratings", "More campuses"];

export let road: ReturnType<typeof drawableTube>;
export let markers: THREE.Mesh[];
let markerMats: THREE.MeshBasicMaterial[];
const dim = new THREE.Color("#22324a");

export const next: Scene = {
  id: "next",
  title: "What's next",
  move: "road draws + fly-along",
  notes:
    "Next: UNC email verification so everyone's a verified student.\n\nThen a move-out week launch, when everyone's selling at once.\n\nThen ratings, then more campuses.\n\nTickets only if UNC policy changes. Student-ticket resale is banned today.",
  texts: [],

  init(w) {
    road = drawableTube(ROAD, 0.09, COLORS.blue, 300);
    w.scene.add(road.mesh);
    markerMats = [];
    markers = STOPS.map((t) => {
      const mat = new THREE.MeshBasicMaterial({ color: dim.clone(), toneMapped: false, fog: false, transparent: true });
      markerMats.push(mat);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.12, 12, 64), mat);
      ring.position.copy(ROAD.getPoint(t)).add(new THREE.Vector3(0, 1.7, 0));
      ring.scale.setScalar(0.001);
      w.scene.add(ring);
      return ring;
    });

    const items = MILESTONES.map((m, i) =>
      text(w, `<span class="mono blue" style="font-size:32px;margin-right:22px">0${i + 1}</span>${m}`, { x: 140, y: 300 + i * 120, cls: "line" }),
    );
    this.texts = [
      text(w, "What's next", { x: 140, y: 110, cls: "title" }),
      ...items,
      text(w, "tickets only if UNC policy changes", { x: 142, y: 820, cls: "small" }),
    ];
  },

  build(w, tl) {
    tl.to(pillars.map((p) => p.scale), { y: 0.001, duration: 0.8, ease: "power2.in", stagger: 0.08 }, 0);
    tl.to(pillarFade, { opacity: 0, duration: 0.5 }, 0.5);
    // glide down to road level and along it
    const start = ROAD.getPoint(0.0), ahead = ROAD.getPoint(0.5);
    tl.to(w.camera.position, { x: start.x + 6, y: start.y + 5, z: start.z + 10, duration: 2.0 }, 0);
    tl.to(w.look, { x: ahead.x, y: ahead.y + 1, z: ahead.z, duration: 2.0 }, 0);
    tl.to(road, { draw: 1, duration: 3.6, ease: "power1.inOut" }, 0.8);
    textIn(tl, this.texts[0], 0.6);
    STOPS.forEach((t, i) => {
      const at = 0.8 + 3.6 * t; // light each stop as the road reaches it
      tl.to(markers[i].scale, { x: 1, y: 1, z: 1, duration: 0.6, ease: "back.out(2)" }, at);
      tl.to(markerMats[i].color, { r: COLORS.blue.r * 1.6, g: COLORS.blue.g * 1.4, b: COLORS.blue.b * 1.2, duration: 0.5 }, at + 0.1);
      textIn(tl, this.texts[1 + i], at);
    });
    const end = ROAD.getPoint(0.0);
    tl.to(w.camera.position, { x: end.x - 5, y: end.y + 6.5, z: end.z + 14, duration: 3.0, ease: "power1.inOut" }, 2.0);
    tl.to(w.look, { x: ahead.x - 4, y: ahead.y + 2, duration: 3.0, ease: "power1.inOut" }, 2.0);
    textIn(tl, this.texts[5], 4.4);
  },
};
