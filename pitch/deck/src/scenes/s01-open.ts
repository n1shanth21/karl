import { Scene, text, textIn } from "../scene";
import { P } from "../props";
import { sampleLogo } from "../lib/logo";

// 1 · Cold open. Dust drifting in the dark assembles into the 3D Karl mark.
// Move: particles assemble.

export const LOGO_Y = 2.2;
export const LOGO_SCALE = 0.85;

export const open: Scene = {
  id: "open",
  title: "Cold open",
  move: "particles assemble",
  notes:
    "Let it breathe. Wait for the logo to land before talking.\n\n“This is Karl. The campus marketplace that lives in iMessage.”",
  texts: [],

  init(w) {
    const { logo, particles } = P;
    logo.group.position.set(0, LOGO_Y, 0);
    logo.group.scale.setScalar(LOGO_SCALE);
    // particle targets = the mark, placed where the 3D logo sits
    const { pos } = sampleLogo(particles.count, 0.72);
    for (let i = 0; i < pos.length; i += 3) {
      pos[i] *= LOGO_SCALE;
      pos[i + 1] = pos[i + 1] * LOGO_SCALE + LOGO_Y;
      pos[i + 2] *= LOGO_SCALE;
    }
    particles.setShape("logo", pos);

    this.texts = [
      text(w, "karl", { x: 960, y: 655, cls: "hero", align: "center" }),
      text(w, "the campus marketplace that lives in <span class='blue'>iMessage</span>", { x: 960, y: 820, cls: "line", align: "center" }),
    ];
  },

  build(_w, tl) {
    const { logo, particles } = P;
    tl.to(particles.w, { dust: 0, logo: 1, duration: 3.4, ease: "power2.inOut" }, 0);
    tl.to(particles.look, { size: 2.0, duration: 3.4 }, 0);
    tl.to(logo.fade, { opacity: 1, duration: 1.3, ease: "power1.inOut" }, 2.7);
    tl.to(particles.look, { opacity: 0.18, duration: 1.4 }, 2.9);
    textIn(tl, this.texts, 3.3, 0.35);
  },
};
