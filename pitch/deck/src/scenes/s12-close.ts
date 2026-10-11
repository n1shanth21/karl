import { Scene, text, textIn } from "../scene";
import { P } from "../props";
import { markers, road } from "./s11-next";
import { LOGO_SCALE, LOGO_Y } from "./s01-open";

// 12 · Close. The road and its milestones collapse, the camera flies all the way back
// to where we started, and the dust implodes into the Karl mark next to the sign-up QR.
// Move: collapse + fly-back implosion.

const SHIFT = -5.4; // logo moves left to make room for the QR

export const close: Scene = {
  id: "close",
  title: "Close",
  move: "collapse + fly back",
  notes:
    "Karl: the campus marketplace that lives in iMessage.\n\nScan the code and text it. Try “need a mini fridge under $60”.\n\nThank you!",
  texts: [],

  init(w) {
    const base = import.meta.env.BASE_URL;
    this.texts = [
      text(w, "Text Karl.", { x: 660, y: 690, cls: "hero", align: "center" }),
      text(w, "the campus marketplace that lives in <span class='blue'>iMessage</span>", { x: 660, y: 845, cls: "small", align: "center" }),
      text(w, `<div class="qr"><img src="${base}signup-qr.png" alt="QR code to sign up for Karl"></div>`, { x: 1370, y: 270, cls: "line", align: "center" }),
      text(w, "scan to sign up", { x: 1370, y: 760, cls: "small", align: "center" }),
    ];
  },

  build(w, tl) {
    const { logo, particles } = P;
    // collapse what's on screen
    tl.to(road, { draw: 0, duration: 1.0, ease: "power2.in" }, 0);
    tl.to(markers.map((m) => m.scale), { x: 0.001, y: 0.001, z: 0.001, duration: 0.6, ease: "back.in(2)", stagger: -0.08 }, 0);

    // fly all the way home through the dust
    tl.to(w.camera.position, { x: 0, y: 0, z: 30, duration: 3.4, ease: "power3.inOut" }, 0.4);
    tl.to(w.look, { x: 0, y: 0, z: 0, duration: 3.4, ease: "power3.inOut" }, 0.4);

    // implode into the mark, shifted left of center
    tl.to(logo.group.position, { x: SHIFT, y: LOGO_Y, z: 0, duration: 0.01 }, 0.2);
    tl.to(logo.group.scale, { x: LOGO_SCALE, y: LOGO_SCALE, z: LOGO_SCALE, duration: 0.01 }, 0.2);
    tl.to(particles.points.position, { x: SHIFT, duration: 2.6, ease: "power2.inOut" }, 1.4);
    tl.to(particles.w, { dust: 0, logo: 1, duration: 2.8, ease: "power2.inOut" }, 1.4);
    tl.to(particles.look, { opacity: 0.75, size: 2.0, duration: 1.0 }, 1.0);
    tl.to(logo.fade, { opacity: 1, duration: 1.2 }, 3.6);
    tl.to(particles.look, { opacity: 0.18, duration: 1.2 }, 3.8);
    textIn(tl, this.texts.slice(0, 2), 4.0, 0.25);
    textIn(tl, this.texts.slice(2), 4.4, 0.2);
  },
};
