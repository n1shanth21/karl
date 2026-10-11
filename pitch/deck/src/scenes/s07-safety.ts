import * as THREE from "three";
import { Scene, text, textIn } from "../scene";
import { HUB, P } from "../props";
import { along, param } from "../lib/motion";
import { createPacket } from "../lib/packet";
import { fader, textLabel } from "../lib/label";
import { playClip, videoTexture } from "../lib/phone";
import { BUYER, ROUTE_TO_SELLER } from "./s06-privacy";
import { hideDeal } from "./s07-negotiation";
import { COLORS } from "../world";

// 8 · Safety. A "venmo me first pls" packet hits Karl's scan rings, turns red, and the
// buyer gets a heads up. A message with a phone number shatters on the spot.
// Move: camera push-in + pulse rings + shatter.

const ROUTE_TO_BUYER = [...ROUTE_TO_SELLER].reverse();
let rings: THREE.Mesh[];
let ringMat: THREE.MeshBasicMaterial;
let warnPacket: ReturnType<typeof createPacket>;
let blockPacket: ReturnType<typeof createPacket>;
let shards: THREE.Points;
let headsUp: THREE.Mesh;
export let headsUpFade: { opacity: number };
export let blockedFade: { opacity: number };
const warnTrip = param((u) => along(ROUTE_TO_BUYER, u, warnPacket.group.position));
const blockTrip = param((u) => along(ROUTE_TO_BUYER, u, blockPacket.group.position));
const burst = param((k) => applyBurst(k));
let shardDirs: Float32Array;

export const safety: Scene = {
  id: "safety",
  title: "Safety",
  move: "push-in + pulse rings + shatter",
  notes:
    "Every relayed message is scanned before it's forwarded.\n\nPay-first, deposit and pressure messages go through with a warning to the other person.\n\nPhone numbers, emails, social handles, links, gift cards and wire or crypto asks are blocked outright. Prohibited items get refused, every inbound photo is checked, and stop/help always work. Karl never touches money.",
  texts: [],

  init(w) {
    ringMat = new THREE.MeshBasicMaterial({ color: COLORS.blue, transparent: true, opacity: 0, toneMapped: false, depthWrite: false });
    rings = [0, 1, 2].map(() => {
      const r = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.05, 8, 96), ringMat);
      r.position.copy(HUB).setZ(HUB.z + 0.6);
      r.scale.setScalar(0.4);
      w.scene.add(r);
      return r;
    });

    warnPacket = createPacket({ from: "from (984) 555-0199", body: "venmo me first pls" }, { label: "Jordan · desk lamp", body: "venmo me first pls" });
    blockPacket = createPacket({ from: "from (984) 555-0199", body: "text me at 984-555-0199" }, { label: "Jordan · desk lamp", body: "text me at 984-555-0199" });
    for (const p of [warnPacket, blockPacket]) { p.group.scale.setScalar(1.5); w.scene.add(p.group); }

    const hu = textLabel(["heads up: only pay once you", "actually have the item"], { size: 34, weight: 500, bg: "#26252A", pad: 26, radius: 34 });
    headsUp = hu.mesh;
    headsUp.position.set(BUYER.x + 2.6, HUB.y + 3.9, HUB.z + 1.2);
    headsUp.scale.setScalar(1.45);
    w.scene.add(headsUp);
    headsUpFade = fader([hu.mat], 0);

    const blocked = textLabel(["blocked"], { size: 72, weight: 700, color: "#FF6B6B", align: "center" });
    blocked.mesh.position.set(HUB.x, HUB.y + 3.4, HUB.z + 1);
    w.scene.add(blocked.mesh);
    blockedFade = fader([blocked.mat], 0);

    // shards for the blocked message
    const n = 90;
    shardDirs = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) new THREE.Vector3().randomDirection().multiplyScalar(2 + Math.random() * 4).toArray(shardDirs, i * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    shards = new THREE.Points(geo, new THREE.PointsMaterial({ color: COLORS.block, size: 0.22, transparent: true, opacity: 0, toneMapped: false, depthWrite: false }));
    shards.frustumCulled = false;
    w.scene.add(shards);

    this.texts = [
      text(w, "Every message gets scanned.", { x: 140, y: 100, cls: "title" }),
      text(w, "pay first · deposits · pressure → <b>Karl warns</b>", { x: 140, y: 850, cls: "line" }),
      text(w, "numbers · links · gift cards · crypto → <span class='red'>blocked</span>", { x: 140, y: 930, cls: "line" }),
    ];
  },

  build(w, tl) {
    hideDeal(tl, 0);
    tl.to(w.camera.position, { x: HUB.x - 1, y: HUB.y + 1.2, z: HUB.z + 23, duration: 2.0 }, 0);
    tl.to(w.look, { x: HUB.x - 1, y: HUB.y + 1, z: HUB.z, duration: 2.0 }, 0);
    textIn(tl, this.texts[0], 0.8);

    // 1) pay-first message: scanned, turns red, buyer gets a heads up
    tl.to(warnPacket.group, { visible: true, duration: 0.01 }, 1.2);
    tl.to(warnTrip, { t: 1, duration: 3.4, ease: "power1.inOut" }, 1.2);
    pulse(tl, 2.4);
    tl.to(warnPacket.state, { mask: 1, red: 1, duration: 0.5, ease: "none" }, 2.6);
    tl.call(() => {
      // swap the buyer's screen to the warning clip going forward, back to the match clip going back
      const forward = !tl.reversed();
      P.phone.setScreen(videoTexture(forward ? "SafetyWarning" : "MatchPing"));
      if (forward) playClip("SafetyWarning"); else playClip("MatchPing", true);
    }, [], 3.6);
    tl.to(headsUpFade, { opacity: 1, duration: 0.6 }, 5.1);
    textIn(tl, this.texts[1], 4.6);
    tl.to(warnPacket.group.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.4 }, 5.0);

    // 2) a phone number: shattered at Karl
    tl.to(blockPacket.group, { visible: true, duration: 0.01 }, 5.6);
    tl.to(blockTrip, { t: 0.5, duration: 1.6, ease: "power1.in" }, 5.6);
    tl.to(ringMat.color, { r: COLORS.block.r, g: COLORS.block.g, b: COLORS.block.b, duration: 0.2 }, 6.6);
    pulse(tl, 6.8);
    tl.to(blockPacket.state, { red: 1, duration: 0.1 }, 7.0);
    tl.to(blockPacket.group.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.15, ease: "power2.in" }, 7.2);
    tl.to(burst, { t: 1, duration: 1.4, ease: "power2.out" }, 7.25);
    tl.to(blockedFade, { opacity: 1, duration: 0.3 }, 7.3);
    textIn(tl, this.texts[2], 7.5);
  },

  settle() {
    P.phone.setScreen(videoTexture("SafetyWarning"));
    playClip("SafetyWarning", true);
  },
};

function pulse(tl: gsap.core.Timeline, at: number) {
  rings.forEach((r, i) => {
    tl.fromTo(r.scale, { x: 0.4, y: 0.4, z: 0.4 }, { x: 2.2, y: 2.2, z: 2.2, duration: 1.1, ease: "power2.out", immediateRender: false }, at + i * 0.18);
  });
  tl.fromTo(ringMat, { opacity: 0.9 }, { opacity: 0, duration: 1.4, ease: "power1.in", immediateRender: false }, at);
}

function applyBurst(k: number) {
  const pos = shards.geometry.getAttribute("position") as THREE.BufferAttribute;
  const start = along(ROUTE_TO_SELLER, 0.5);
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, start.x + shardDirs[i * 3] * k, start.y + shardDirs[i * 3 + 1] * k - k * k * 1.5, start.z + shardDirs[i * 3 + 2] * k);
  }
  pos.needsUpdate = true;
  (shards.material as THREE.PointsMaterial).opacity = k > 0 && k < 1 ? 1 - k : 0;
}
