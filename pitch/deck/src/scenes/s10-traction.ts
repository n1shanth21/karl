import * as THREE from "three";
import { Scene, text, textIn } from "../scene";
import { HUB, P } from "../props";
import { fader } from "../lib/label";
import { param } from "../lib/motion";
import { meaningFade } from "./s09-meaning";
import { STATS } from "../stats";
import { COLORS } from "../world";

// 10 · Traction. The camera cranes up out of the embedding cloud while three light
// beams of light rise between live counters from the dashboard. Move: crane up + beams rise.

export const PILLARS_AT = new THREE.Vector3(HUB.x, HUB.y - 7, HUB.z - 14);
const XS = [-20, -6.2, 6.2, 21.5]; // light beams in the gaps between the numbers
const HEIGHTS = [9, 13, 11, 8];
export let pillars: THREE.Mesh[];
export let pillarFade: { opacity: number };
let numberEls: HTMLElement[];

export const traction: Scene = {
  id: "traction",
  title: "Traction",
  move: "crane up + pillars rise",
  notes:
    "These are live numbers from our dashboard, pulled from Tiger Data just now.\n\n(Numbers come from /api/stats at load; if offline, from the snapshot saved with `npm run stats`.)",
  texts: [],

  init(w) {
    const geo = new THREE.CylinderGeometry(0.7, 0.7, 1, 48, 1, true);
    geo.translate(0, 0.5, 0); // grow from the floor up
    const mat = new THREE.MeshBasicMaterial({ color: COLORS.blue, transparent: true, opacity: 0.5, toneMapped: false, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    pillars = XS.map((x) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(PILLARS_AT).add(new THREE.Vector3(x, 0, 0));
      m.scale.set(1, 0.001, 1);
      w.scene.add(m);
      return m;
    });
    pillarFade = fader([mat], 0);

    const cols = [480, 960, 1440];
    const labels = ["listed", "sold", "people texting Karl"];
    numberEls = cols.map((x) => text(w, "0", { x, y: 360, cls: "hero big", align: "center" }));
    const labelEls = cols.map((x, i) => text(w, labels[i], { x, y: 560, cls: "line", align: "center" }));
    this.texts = [
      text(w, "Live at UNC right now", { x: 960, y: 110, cls: "title", align: "center" }),
      ...numberEls,
      ...labelEls,
      text(w, "straight from our dashboard · Timescale continuous aggregate in Tiger Data", { x: 960, y: 960, cls: "small", align: "center" }),
    ];
  },

  build(w, tl) {
    const { particles } = P;
    const values = [STATS.listedTotal, STATS.soldTotal, STATS.usersTotal];

    tl.to(meaningFade, { opacity: 0, duration: 0.5 }, 0);
    tl.to(particles.w, { cloud: 0, dust: 1, duration: 2.4, ease: "power2.inOut" }, 0);
    tl.to(particles.look, { dof: 0, focus: 30, opacity: 0.45, size: 2.6, duration: 1.6 }, 0);
    // crane: rise and tilt down onto the pillars
    tl.to(w.camera.position, { x: HUB.x, y: HUB.y + 7, z: HUB.z + 24, duration: 2.6, ease: "power2.inOut" }, 0);
    tl.to(w.look, { x: HUB.x, y: HUB.y - 0.5, z: PILLARS_AT.z, duration: 2.6, ease: "power2.inOut" }, 0);
    tl.to(pillarFade, { opacity: 0.32, duration: 0.6 }, 1.2);
    pillars.forEach((p, i) => {
      tl.to(p.scale, { y: HEIGHTS[i], duration: 1.8, ease: "power3.out" }, 1.4 + i * 0.12);
    });

    textIn(tl, this.texts[0], 1.0);
    textIn(tl, this.texts.slice(1, 7), 1.6, 0.08);
    numberEls.forEach((el, i) => {
      const c = param((v) => { el.textContent = String(Math.round(v)); });
      tl.to(c, { t: values[i], duration: 1.8, ease: "power2.out" }, 1.6 + i * 0.15);
    });
    textIn(tl, this.texts[7], 2.6);
  },
};
