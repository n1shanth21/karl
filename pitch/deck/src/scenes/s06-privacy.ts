import * as THREE from "three";
import { Scene, text, textIn } from "../scene";
import { HUB, P } from "../props";
import { cameraArc, along, drawableTube, param } from "../lib/motion";
import { createPacket } from "../lib/packet";
import { fader, textLabel } from "../lib/label";
import { playClip, videoTexture } from "../lib/phone";
import { COLORS } from "../world";

// 6 · Privacy. Buyer, Karl and seller as three nodes. A message travels across; as it
// passes through Karl the phone number scrambles away and the bold label appears.
// Move: camera orbit + paths travelling.

export const BUYER = new THREE.Vector3(HUB.x - 11, HUB.y, HUB.z);
export const SELLER = new THREE.Vector3(HUB.x + 11, HUB.y, HUB.z);
export const NODE_SCALE = 0.4;
export const ROUTE_TO_SELLER = [new THREE.Vector3(BUYER.x + 3.2, 3.6, HUB.z + 0.8), new THREE.Vector3(HUB.x, 5.0, HUB.z + 0.8), new THREE.Vector3(SELLER.x - 3.2, 3.6, HUB.z + 0.8)].map((v) => v.setY(v.y + HUB.y));

export let wires: ReturnType<typeof drawableTube>[];
export let nodesFade: { opacity: number }; // node labels
let packet: ReturnType<typeof createPacket>;
const trip = param((u) => along(ROUTE_TO_SELLER, u, packet.group.position));

export const privacy: Scene = {
  id: "privacy",
  title: "Masked relay",
  move: "orbit + travelling paths",
  notes:
    "When you match, buyer and seller never get each other's number.\n\nEach person only ever texts Karl. Karl forwards the message with a bold label, like “Maya · mini fridge”.\n\nThis started as a constraint (our iMessage provider can't make group chats) and became a feature: numbers stay private. Routing is rules-first: plain code handles the predictable messages, and Gemini only steps in when it's unclear whether a message is for Karl or the other person.",
  texts: [],

  init(w) {
    P.seller.setScreen(videoTexture("MaskedRelay"));
    P.seller.group.position.copy(SELLER);
    P.seller.group.rotation.y = -0.3;
    P.seller.group.scale.setScalar(0.001);

    wires = [
      drawableTube(new THREE.LineCurve3(new THREE.Vector3(BUYER.x + 1.6, HUB.y, HUB.z), new THREE.Vector3(HUB.x - 2.4, HUB.y, HUB.z)), 0.05, COLORS.blue, 40),
      drawableTube(new THREE.LineCurve3(new THREE.Vector3(HUB.x + 2.4, HUB.y, HUB.z), new THREE.Vector3(SELLER.x - 1.6, HUB.y, HUB.z)), 0.05, COLORS.blue, 40),
    ];
    for (const wire of wires) w.scene.add(wire.mesh);

    const labels = (["buyer", "Karl", "seller"] as const).map((name, i) => {
      const l = textLabel([name], { size: 64, weight: 600, color: "rgba(255,255,255,0.85)", align: "center" });
      l.mesh.position.set([BUYER.x, HUB.x, SELLER.x][i], HUB.y - 3.0, HUB.z);
      w.scene.add(l.mesh);
      return l.mat;
    });
    nodesFade = fader(labels, 0);

    packet = createPacket({ from: "from (919) 555-0142", body: "omw, 5 min" }, { label: "Maya · mini fridge", body: "omw, 5 min" });
    packet.group.scale.setScalar(1.5);
    w.scene.add(packet.group);

    this.texts = [
      text(w, "Nobody's number gets shared.", { x: 960, y: 110, cls: "title", align: "center" }),
      text(w, "buyer and seller each text Karl · Karl passes the messages along", { x: 960, y: 930, cls: "small", align: "center" }),
    ];
  },

  build(w, tl) {
    const { phone, seller, logo } = P;
    cameraArc(w, tl, HUB, new THREE.Vector3(HUB.x, HUB.y + 2.5, HUB.z + 25), 0, 2.4, 0.5);
    tl.to(w.look, { x: HUB.x, y: HUB.y + 0.6, z: HUB.z, duration: 2.4 }, 0);
    tl.to(phone.overlayFade, { opacity: 0, duration: 0.6 }, 0.2);
    tl.to(phone.group.position, { x: BUYER.x, y: BUYER.y, z: BUYER.z, duration: 2.2 }, 0);
    tl.to(phone.group.scale, { x: NODE_SCALE, y: NODE_SCALE, z: NODE_SCALE, duration: 2.2 }, 0);
    tl.to(phone.group.rotation, { y: 0.3, duration: 2.2 }, 0);
    tl.to(seller.group, { visible: true, duration: 0.01 }, 0.6);
    tl.to(seller.group.scale, { x: NODE_SCALE, y: NODE_SCALE, z: NODE_SCALE, duration: 1.4, ease: "back.out(1.6)" }, 0.8);
    tl.to(logo.group.position, { x: HUB.x, y: HUB.y, z: HUB.z, duration: 0.01 }, 0.5);
    tl.to(logo.group.scale, { x: NODE_SCALE, y: NODE_SCALE, z: NODE_SCALE, duration: 0.01 }, 0.5);
    tl.to(logo.fade, { opacity: 1, duration: 1.0 }, 0.9);
    tl.to(wires, { draw: 1, duration: 0.9, stagger: 0.3, ease: "power2.inOut" }, 1.6);
    tl.to(nodesFade, { opacity: 1, duration: 0.6 }, 1.8);
    textIn(tl, this.texts[0], 2.0);

    // the message travels buyer → Karl → seller; the number dissolves at Karl
    tl.to(packet.group, { visible: true, duration: 0.01 }, 2.9);
    tl.to(trip, { t: 1, duration: 3.4, ease: "power1.inOut" }, 2.9);
    tl.to(packet.state, { mask: 1, duration: 0.8, ease: "none" }, 4.2);
    tl.fromTo(logo.group.scale, { x: NODE_SCALE, y: NODE_SCALE, z: NODE_SCALE }, { x: NODE_SCALE * 1.15, y: NODE_SCALE * 1.15, z: NODE_SCALE * 1.15, duration: 0.25, yoyo: true, repeat: 1, immediateRender: false }, 4.3);
    tl.call(() => { if (!tl.reversed()) playClip("MaskedRelay"); }, [], 5.4);
    textIn(tl, this.texts[1], 5.0);
  },

  settle() {
    playClip("MaskedRelay", true);
  },
};

export function hidePacket(tl: gsap.core.Timeline, at: number) {
  tl.fromTo(packet.group.scale, { x: 1.5, y: 1.5, z: 1.5 }, { x: 0.001, y: 0.001, z: 0.001, duration: 0.4, ease: "power2.in", immediateRender: false }, at);
}
