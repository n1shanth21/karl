import { Scene, text, textIn } from "../scene";
import { P } from "../props";
import { fader } from "../lib/label";
import * as THREE from "three";

// 2 · The problem. The mark dissolves back into dust and the camera pushes through a
// field of floating group-chat posts. Move: dissolve + camera fly-through.

let cardsFade: { opacity: number };

export const problem: Scene = {
  id: "problem",
  title: "The problem",
  move: "dissolve + fly-through",
  notes:
    "Buying and selling at UNC happens across scattered GroupMe, Instagram and Facebook posts.\n\nPosts get buried. Buyers scroll a dozen chats. You meet strangers you know nothing about.\n\nAnd nothing remembers what you're looking for.",
  texts: [],

  init(w) {
    for (const c of P.cards) c.mesh.visible = true;
    cardsFade = fader(P.cards.map((c) => c.mesh.material as THREE.Material), 0);
    this.texts = [
      text(w, "Where do I even post this?", { x: 140, y: 380, cls: "title" }),
      text(w, "Strangers. Scrolling. Buried posts.", { x: 140, y: 500, cls: "line" }),
    ];
  },

  build(w, tl) {
    const { logo, particles } = P;
    tl.to(logo.fade, { opacity: 0, duration: 0.7, ease: "power2.in" }, 0);
    tl.to(particles.w, { logo: 0, dust: 1, duration: 2.4, ease: "power2.out" }, 0);
    tl.to(particles.look, { opacity: 0.6, size: 2.6, duration: 1.2 }, 0);
    tl.to(cardsFade, { opacity: 0.95, duration: 1.6, ease: "power1.out" }, 0.5);
    tl.to(w.camera.position, { x: 1.2, y: -0.4, z: -62, duration: 5.2, ease: "power2.inOut" }, 0.2);
    tl.to(w.look, { x: 0, y: 0, z: -130, duration: 5.2, ease: "power2.inOut" }, 0.2);
    textIn(tl, this.texts[0], 1.6);
    textIn(tl, this.texts[1], 3.0);
  },
};
