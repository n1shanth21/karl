import * as THREE from "three";
import { Scene, text, textIn } from "../scene";
import { HUB, P } from "../props";
import { bubble } from "./s03-oneline";
import { canvasPlane, fader, font, roundRect, textLabel } from "../lib/label";
import { drawableTube, param } from "../lib/motion";
import { playClip, videoTexture } from "../lib/phone";
import { COLORS } from "../world";
import { clipTime } from "../director";
import { createLamp, createPulse, flicker } from "../lib/lamp";

// 4 · The magic moment: want → match. A timeline draws itself, the want waits on it
// while a day passes, a listing drops in, a line snaps between them, and a phone
// buzzes with Karl's text. Move: lines drawing themselves.

const LINE_Y = HUB.y - 2.6;
const PIN = new THREE.Vector3(HUB.x - 10, HUB.y + 0.8, HUB.z);
const LISTING = new THREE.Vector3(HUB.x + 4.5, HUB.y + 0.6, HUB.z);
export const PHONE_AT = new THREE.Vector3(HUB.x + 8.6, HUB.y + 0.4, HUB.z + 9);
// the desk lamp stands on the top edge of the listing card (card is 2.3 tall)
const LAMP_AT = new THREE.Vector3(LISTING.x + 0.9, LISTING.y + 1.15, HUB.z + 0.35);

let timeline: ReturnType<typeof drawableTube>;
let snapLine: ReturnType<typeof drawableTube>;
let listing: THREE.Group;
let sun: THREE.Mesh;
let ticks: THREE.Group;
export let magicFade: { opacity: number }; // everything this scene added (not the phone)
const sky = { k: 0 };
let lamp: ReturnType<typeof createLamp>;
let pulse: ReturnType<typeof createPulse>;
let clockEl: HTMLElement;

// tue 9:12 pm → wed 11:03 am, shown while the sun crosses
function clockText(p: number) {
  const start = 21 * 60 + 12, total = 13 * 60 + 51;
  const m = Math.round(start + p * total);
  const day = m >= 24 * 60 ? "wed" : "tue";
  const h24 = Math.floor(m / 60) % 24, mm = m % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${day} ${h}:${String(mm).padStart(2, "0")} ${h24 < 12 ? "am" : "pm"}`;
}

export const magic: Scene = {
  id: "magic",
  title: "Want → match",
  move: "lines draw",
  notes:
    "Here's the part nobody else does.\n\nYou text “need a desk lamp under $20.” Nothing's listed. Karl saves it as a want.\n\nA day later someone lists a desk lamp for $15. Karl matches it and texts you first, without you checking anything.\n\nUnder the hood your want is a standing semantic search: it's stored as an embedding, and every new listing gets searched against the saved wants in reverse. It's event-driven, so you get pinged the moment it's listed.",
  texts: [],

  init(w) {
    const g = new THREE.Group();
    w.scene.add(g);
    timeline = drawableTube(new THREE.LineCurve3(new THREE.Vector3(HUB.x - 15, LINE_Y, HUB.z), new THREE.Vector3(HUB.x + 15, LINE_Y, HUB.z)), 0.045, COLORS.blue, 60);
    g.add(timeline.mesh);

    ticks = new THREE.Group();
    const tickLabels: [number, string][] = [[PIN.x, "tue night"], [HUB.x - 2.8, "overnight"], [LISTING.x, "wed morning"]];
    for (const [x, label] of tickLabels) {
      const l = textLabel([label], { size: 30, weight: 500, color: "rgba(255,255,255,0.55)", align: "center" });
      l.mesh.position.set(x, LINE_Y - 0.7, HUB.z);
      ticks.add(l.mesh);
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.12, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, toneMapped: false }));
      dot.position.set(x, LINE_Y, HUB.z + 0.06);
      ticks.add(dot);
    }
    g.add(ticks);

    sun = new THREE.Mesh(new THREE.SphereGeometry(0.55, 32, 16), new THREE.MeshBasicMaterial({ color: 0xfff4dc, transparent: true, toneMapped: false }));
    sun.visible = false;
    g.add(sun);

    // the listing card that drops in
    listing = new THREE.Group();
    const card = canvasPlane(4.2, 2.3, (ctx, cw, ch) => {
      ctx.fillStyle = "#ffffff";
      roundRect(ctx, 0, 0, cw, ch, 28);
      ctx.fill();
      ctx.fillStyle = "#4B9CD3";
      ctx.font = font(700, 22);
      ctx.fillText("JUST LISTED", 30, 52);
      ctx.fillStyle = "#0F1B2D";
      ctx.font = font(700, 50);
      ctx.fillText("desk lamp", 30, 122);
      ctx.font = font(600, 50);
      ctx.fillStyle = "#2F7DB5";
      ctx.fillText("$15", 30, 190);
    });
    listing.add(card.mesh);
    listing.position.set(LISTING.x, LISTING.y + 14, LISTING.z);
    g.add(listing);

    const arc = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(PIN.x + 2.4, PIN.y + 0.4, HUB.z),
      new THREE.Vector3((PIN.x + LISTING.x) / 2, HUB.y + 7, HUB.z),
      new THREE.Vector3(LISTING.x - 1.9, LISTING.y + 0.6, HUB.z),
    );
    snapLine = drawableTube(arc, 0.06, 0xffffff, 100);
    g.add(snapLine.mesh);

    // the lamp itself (hidden until the listing lands) and the pulse that runs to the phone
    lamp = createLamp(w);
    lamp.group.position.copy(LAMP_AT);
    lamp.group.scale.setScalar(1.2); // small enough that the shade stays clear of the title
    w.scene.add(lamp.group);
    const run = new THREE.QuadraticBezierCurve3(
      LAMP_AT.clone().add(new THREE.Vector3(-0.85, 1.6, 0)),
      new THREE.Vector3((LAMP_AT.x + PHONE_AT.x) / 2 + 0.5, LAMP_AT.y + 3.6, (LAMP_AT.z + PHONE_AT.z) / 2),
      new THREE.Vector3(PHONE_AT.x - 0.2, PHONE_AT.y + 3.1, PHONE_AT.z + 0.6),
    );
    pulse = createPulse(run, lamp);
    w.scene.add(pulse.group);

    const mats: THREE.Material[] = [];
    g.traverse((o) => { if (o instanceof THREE.Mesh && o !== timeline.mesh && o !== snapLine.mesh) mats.push(o.material as THREE.Material); });
    const cardFade = fader([...mats, timeline.mesh.material as THREE.Material, snapLine.mesh.material as THREE.Material], 1);
    // the lamp rides on magicFade, so the next scene's fade-out takes it away too (no extra call needed)
    magicFade = {
      get opacity() { return cardFade.opacity; },
      set opacity(v: number) { cardFade.opacity = v; lamp.setExit(v); },
    };
    for (const m of mats) (m as THREE.MeshBasicMaterial).transparent = true;
    ticksFade = fader(ticks.children.map((c) => (c as THREE.Mesh).material as THREE.Material), 0);

    // the hero phone (shows the clip; later scenes reuse it)
    P.phone.setScreen(videoTexture("MatchPing"));
    P.phone.group.position.set(PHONE_AT.x, PHONE_AT.y - 18, PHONE_AT.z);
    P.phone.group.scale.setScalar(0.85);

    // sky brightens toward "day" and back
    const night = COLORS.navy.clone(), day = new THREE.Color("#1d4469");
    w.tick(() => { (w.scene.background as THREE.Color).copy(night).lerp(day, sky.k); });

    clockEl = text(w, "tue 9:12 pm", { x: 146, y: 222, cls: "small mono" });
    this.texts = [
      text(w, "Ask once. Karl keeps looking.", { x: 140, y: 110, cls: "title" }),
      clockEl,
      text(w, "your want becomes a standing semantic search · every new listing is matched against it", { x: 142, y: 975, cls: "small" }),
    ];
  },

  build(w, tl) {
    const cam = w.camera.position;
    tl.to(cam, { x: 0, y: 0.6, z: HUB.z + 28, duration: 1.6 }, 0);
    tl.to(w.look, { x: 0, y: -0.2, z: HUB.z, duration: 1.6 }, 0);
    tl.to(bubble.position, { x: PIN.x, y: PIN.y, z: PIN.z, duration: 1.4 }, 0.2);
    tl.to(bubble.scale, { x: 0.62, y: 0.62, z: 0.62, duration: 1.4 }, 0.2);
    tl.to(timeline, { draw: 1, duration: 1.6, ease: "power2.inOut" }, 0.5);
    tl.to(ticksFade, { opacity: 1, duration: 0.6 }, 1.6);
    textIn(tl, this.texts[0], 1.2);

    // a day passes: the sun arcs over, the sky lifts, the clock runs
    textIn(tl, clockEl, 1.9);
    const sweep = param((p) => {
      const a = Math.PI * (1 - p);
      sun.position.set(HUB.x + Math.cos(a) * 13, LINE_Y + 1 + Math.sin(a) * 8, HUB.z - 6);
      sun.visible = p > 0.001 && p < 0.999;
      sky.k = Math.sin(p * Math.PI) * 0.85;
      clockEl.textContent = clockText(p);
    });
    tl.to(sweep, { t: 1, duration: 3.2, ease: "none" }, 2.0);

    // the listing lands and the match line snaps across
    tl.to(listing.position, { y: LISTING.y, duration: 1.0, ease: "bounce.out" }, 5.0);
    tl.to(snapLine, { draw: 1, duration: 0.7, ease: "power3.in" }, 6.5);
    tl.fromTo(bubble.scale, { x: 0.62, y: 0.62, z: 0.62 }, { x: 0.72, y: 0.72, z: 0.72, duration: 0.18, yoyo: true, repeat: 1, ease: "power1.out", immediateRender: false }, 7.2);

    // the lamp materializes as the card lands: base drops, arm draws, shade flies in, bulb flickers on
    const asm = param((p) => lamp.setAssemble(p));
    const glow = param((p) => lamp.setGlow(flicker(p)));
    tl.to(asm, { t: 1, duration: 0.95, ease: "none" }, 5.7);
    tl.to(glow, { t: 1, duration: 0.7, ease: "none" }, 6.45);
    // when the line snaps, a pulse runs from the lamp to the phone
    tl.to(pulse, { travel: 1, duration: 1.0, ease: "none" }, 7.2);
    textIn(tl, this.texts[2], 7.4);

    // the phone rises in and Karl's text arrives
    // (a jump past scene 8 and back leaves the safety clip on this phone: always show the match screen here)
    tl.call(() => P.phone.setScreen(videoTexture("MatchPing")), [], 7.05);
    tl.to(P.phone.group, { visible: true, duration: 0.01 }, 7.1);
    tl.to(P.phone.group.position, { y: PHONE_AT.y, duration: 1.3, ease: "power3.out" }, 7.1);
    tl.to(P.phone.group.rotation, { y: -0.32, duration: 1.3, ease: "power3.out" }, 7.1);
    tl.to(cam, { x: 3.2, z: HUB.z + 25, duration: 1.6 }, 7.0);
    tl.to(w.look, { x: 3.2, duration: 1.6 }, 7.0);
    tl.call(() => { if (!tl.reversed()) playClip("MatchPing"); }, [], 7.5);
    // buzz when the message lands (~2.7 s into the clip)
    tl.to(P.phone.group.rotation, { z: 0.04, duration: 0.05, yoyo: true, repeat: 9, ease: "none" }, 7.5 + clipTime(2.7));
    tl.to(pulse, { ping: 1, duration: 0.9, ease: "power2.out" }, 7.5 + clipTime(2.7));
  },

  settle() {
    P.phone.setScreen(videoTexture("MatchPing"));
    playClip("MatchPing", true);
  },
};

let ticksFade: { opacity: number };
