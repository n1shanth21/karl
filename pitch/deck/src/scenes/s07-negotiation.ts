import * as THREE from "three";
import { Scene, text, textIn } from "../scene";
import { HUB, P } from "../props";
import { along, param } from "../lib/motion";
import { createPacket } from "../lib/packet";
import { fader, textLabel } from "../lib/label";
import { playClip, videoTexture } from "../lib/phone";
import { hidePacket, NODE_SCALE, ROUTE_TO_SELLER, SELLER } from "./s06-privacy";

// 7 · Negotiation. Same buyer · Karl · seller layout as the relay scene: an offer travels to
// the seller, a counter comes back, and "deal · $40" lands at Karl. The seller's phone plays
// the Negotiation clip (offer -> "40" -> "Maya took $40!"). Move: ping-pong packets + deal pop.

const ROUTE_TO_BUYER = [...ROUTE_TO_SELLER].reverse();
const FOCUS_SCALE = 0.95; // seller phone size during the close-up (relay layout uses NODE_SCALE)
let offer: ReturnType<typeof createPacket>;
let counter: ReturnType<typeof createPacket>;
let deal: THREE.Mesh;
let dealFade: { opacity: number };
const offerTrip = param((u) => along(ROUTE_TO_SELLER, u, offer.group.position));
const counterTrip = param((u) => along(ROUTE_TO_BUYER, u, counter.group.position));

export const negotiation: Scene = {
  id: "negotiation",
  title: "Karl haggles for you",
  move: "ping-pong packets + deal pop",
  notes:
    "Karl doesn't just connect people. He negotiates between them.\n\nThe buyer says “ask him for $35.” The seller gets a real offer, and can say yes, no, or just reply with a number to counter. It goes back and forth until someone says yes, and the deal closes at that price.\n\nIt even works after a deal is agreed: “can you ask him for 55” renegotiates. Nothing changes until the other person taps yes.",
  texts: [],

  init(w) {
    offer = createPacket({ from: "Maya", body: "ask him for $35" }, { label: "Karl → seller", body: "Maya offers $35" });
    counter = createPacket({ from: "Sam", body: "40" }, { label: "Karl → buyer", body: "seller says $40" });
    for (const p of [offer, counter]) { p.group.scale.setScalar(1.5); w.scene.add(p.group); }

    const d = textLabel(["deal · $40"], { size: 72, weight: 700, color: "#7EE0A1", align: "center" });
    deal = d.mesh;
    deal.position.set(HUB.x, HUB.y + 3.4, HUB.z + 1);
    w.scene.add(deal);
    dealFade = fader([d.mat], 0);

    this.texts = [
      text(w, "Karl haggles for you.", { x: 140, y: 100, cls: "title" }),
      text(w, "offer → counter → deal · nothing changes until someone says yes", { x: 960, y: 930, cls: "small", align: "center" }),
    ];
  },

  build(w, tl) {
    hidePacket(tl, 0); // the relay scene's "omw" packet leaves first
    tl.to(w.camera.position, { x: HUB.x, y: HUB.y + 2.2, z: HUB.z + 24, duration: 1.6 }, 0);
    tl.to(w.look, { x: HUB.x, y: HUB.y + 0.8, z: HUB.z, duration: 1.6 }, 0);
    textIn(tl, this.texts[0], 0.6);

    // the seller's phone switches to the negotiation thread (back to the relay thread going backwards)
    tl.call(() => {
      const forward = !tl.reversed();
      P.seller.setScreen(videoTexture(forward ? "Negotiation" : "MaskedRelay"));
      if (forward) playClip("Negotiation"); else playClip("MaskedRelay", true);
    }, [], 0.8);

    // 1) buyer's ask becomes a real offer at Karl
    tl.to(offer.group, { visible: true, duration: 0.01 }, 1.0);
    tl.to(offerTrip, { t: 1, duration: 2.8, ease: "power1.inOut" }, 1.0);
    tl.to(offer.state, { mask: 1, duration: 0.5, ease: "none" }, 2.2);
    tl.to(offer.group.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.35 }, 3.9);

    // 2) the seller counters with just a number
    tl.to(counter.group, { visible: true, duration: 0.01 }, 4.2);
    tl.to(counterTrip, { t: 1, duration: 2.8, ease: "power1.inOut" }, 4.2);
    tl.to(counter.state, { mask: 1, duration: 0.5, ease: "none" }, 5.4);
    tl.to(counter.group.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.35 }, 7.1);

    // 3) buyer says yes: the deal lands at Karl
    tl.fromTo(deal.scale, { x: 0.4, y: 0.4, z: 0.4 }, { x: 1, y: 1, z: 1, duration: 0.7, ease: "back.out(2.4)", immediateRender: false }, 7.4);
    tl.to(dealFade, { opacity: 1, duration: 0.4 }, 7.4);
    textIn(tl, this.texts[1], 7.9);

    // 4) push in on the seller's phone so the negotiation thread is readable
    tl.to(P.seller.group.scale, { x: FOCUS_SCALE, y: FOCUS_SCALE, z: FOCUS_SCALE, duration: 1.6, ease: "power2.inOut" }, 8.6);
    tl.to(P.seller.group.rotation, { y: 0, duration: 1.6, ease: "power2.inOut" }, 8.6);
    tl.to(P.seller.group.position, { z: SELLER.z + 2.5, duration: 1.6, ease: "power2.inOut" }, 8.6); // in front of the relay wire
    tl.to(w.camera.position, { x: SELLER.x - 6, y: SELLER.y - 0.4, z: SELLER.z + 19, duration: 1.8, ease: "power3.inOut" }, 8.6);
    tl.to(w.look, { x: SELLER.x - 6, y: SELLER.y - 0.4, z: SELLER.z, duration: 1.8, ease: "power3.inOut" }, 8.6);
  },

  settle() {
    P.seller.setScreen(videoTexture("Negotiation"));
    playClip("Negotiation", true);
  },
};

/** The next scene clears the "deal · $40" label (it sits where safety's "blocked" appears). */
export function hideDeal(tl: gsap.core.Timeline, at: number) {
  tl.to(dealFade, { opacity: 0, duration: 0.4 }, at);
}

/** The next scene puts the seller's phone back into the buyer · Karl · seller layout. */
export function restoreSeller(tl: gsap.core.Timeline, at: number) {
  tl.to(P.seller.group.scale, { x: NODE_SCALE, y: NODE_SCALE, z: NODE_SCALE, duration: 1.2, ease: "power2.inOut" }, at);
  tl.to(P.seller.group.rotation, { y: -0.3, duration: 1.2, ease: "power2.inOut" }, at);
  tl.to(P.seller.group.position, { z: SELLER.z, duration: 1.2, ease: "power2.inOut" }, at);
}
