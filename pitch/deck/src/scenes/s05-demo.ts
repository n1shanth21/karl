import * as THREE from "three";
import { Scene, text, textIn } from "../scene";
import { P } from "../props";
import { magicFade, PHONE_AT } from "./s04-magic";
import { bubble } from "./s03-oneline";
import { canvasPlane, font, roundRect } from "../lib/label";
import { playClip, SCREEN_H, SCREEN_W, videoTexture } from "../lib/phone";

// 5 · Live demo handoff. The camera flies into the phone; its screen turns into the
// QR code to text Karl. Then the deck goes quiet for the ~90 s live demo.
// D plays a recorded backup of the demo on the same screen if the live one stalls.
// Move: fly into the screen.

let qrTex: THREE.Texture;
let backupTex: THREE.Texture;
let backupOn = false;
const base = import.meta.env.BASE_URL;

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.src = src;
  });
}

export const demo: Scene = {
  id: "demo",
  title: "Live demo",
  move: "fly into screen",
  notes:
    "LIVE DEMO (~90 s). Hand off to the demo phone.\n\n1. Text a photo → Karl drafts the listing → ❤️ to post.\n2. From the second phone: “need a …” → matches arrive.\n3. Show a relayed message with the bold label.\n\nIf it stalls: press D to play the recorded backup on this screen. Press D again to go back to the QR.",
  texts: [],

  init(w) {
    const screen = canvasPlane(SCREEN_W, SCREEN_H, () => {});
    qrTex = screen.mat.map!;
    const draw = (mark?: HTMLImageElement, qr?: HTMLImageElement) =>
      screen.redraw((ctx, cw, ch) => {
        ctx.fillStyle = "#0F1B2D";
        ctx.fillRect(0, 0, cw, ch);
        if (mark) ctx.drawImage(mark, cw / 2 - 48, 70, 96, 96);
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.font = font(700, 50);
        ctx.fillText("text karl", cw / 2, 238);
        const q = cw - 90;
        ctx.fillStyle = "#fff";
        roundRect(ctx, 45, 290, q, q, 30);
        ctx.fill();
        if (qr) ctx.drawImage(qr, 63, 308, q - 36, q - 36);
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.font = font(500, 26);
        ctx.fillText("scan to sign up,", cw / 2, 290 + q + 60);
        ctx.fillText("then just text it", cw / 2, 290 + q + 96);
      });
    draw();
    void Promise.all([loadImage(`${base}karl-mark.svg`), loadImage(`${base}signup-qr.png`)]).then(([m, q]) => draw(m, q));
    backupTex = videoTexture("DemoBackup");
    P.phone.setOverlay(qrTex);

    this.texts = [
      text(w, "Let's try it.", { x: 140, y: 400, cls: "hero" }),
      text(w, "live demo", { x: 146, y: 545, cls: "small mono" }),
    ];
  },

  build(w, tl) {
    const z = PHONE_AT.z + 13.2; // screen fills ~88% of the frame height at this distance
    tl.to(magicFade, { opacity: 0, duration: 1.0 }, 0);
    tl.to(bubble.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.8, ease: "power2.in" }, 0);
    tl.to(P.phone.group.rotation, { y: 0, z: 0, duration: 1.6 }, 0);
    tl.to(w.camera.position, { x: PHONE_AT.x - 2.2, y: PHONE_AT.y, z, duration: 2.2, ease: "power3.inOut" }, 0);
    tl.to(w.look, { x: PHONE_AT.x - 2.2, y: PHONE_AT.y, z: PHONE_AT.z, duration: 2.2, ease: "power3.inOut" }, 0);
    tl.to(P.particles.look, { opacity: 0.2, duration: 1.5 }, 0);
    tl.to(P.phone.overlayFade, { opacity: 1, duration: 0.9 }, 1.4);
    textIn(tl, this.texts, 2.0, 0.2);
  },
};

// D key: swap the QR for the recorded demo (and back).
export function toggleDemoBackup(onDemoScene: boolean) {
  if (!onDemoScene && !backupOn) return;
  backupOn = !backupOn;
  P.phone.setOverlay(backupOn ? backupTex : qrTex);
  if (backupOn) playClip("DemoBackup");
}

// Leaving the demo scene always puts the QR back.
export function resetDemoBackup() {
  if (backupOn) toggleDemoBackup(true);
}
