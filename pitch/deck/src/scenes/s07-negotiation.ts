import * as THREE from "three";
import { Scene, text, textIn } from "../scene";
import { HUB, P } from "../props";
import { along, param } from "../lib/motion";
import { createPacket } from "../lib/packet";
import { fader, textLabel } from "../lib/label";
import { createDealBurst, createPriceTag, tagMaterials } from "../lib/tags";
import { playClip, videoTexture } from "../lib/phone";
import { hidePacket, NODE_SCALE, ROUTE_TO_SELLER, SELLER } from "./s06-privacy";

// 7 · Negotiation (price tags + coin burst: src/lib/tags.ts). Same buyer · Karl · seller layout as the relay scene: an offer travels to
// the seller, a counter comes back, and "deal · $40" lands at Karl. The seller's phone plays
// the Negotiation clip (offer -> "40" -> "Maya took $40!"). Move: ping-pong packets + deal pop.

// The packets ride a touch higher than the relay scene's route; the price tags hang from the
// packets' outer corners so they swing past Karl's mark instead of across it.
const LIFT = 0.3;
const ROUTE_TO_SELLER_HI = ROUTE_TO_SELLER.map((v) => v.clone().setY(v.y + LIFT));
const ROUTE_TO_BUYER = [...ROUTE_TO_SELLER_HI].reverse();
const FOCUS_SCALE = 0.95; // seller phone size during the close-up (relay layout uses NODE_SCALE)
let offer: ReturnType<typeof createPacket>;
let counter: ReturnType<typeof createPacket>;
let offerTag: ReturnType<typeof createPriceTag>;
let counterTag: ReturnType<typeof createPriceTag>;
let burst: ReturnType<typeof createDealBurst>;
let deal: THREE.Mesh;
let dealFade: { opacity: number };
let tagFade: { opacity: number };

// Each price tag swings behind its packet: it leans away from the direction of travel while
// the packet is moving and hangs straight while it waits at Karl.
function lean(tag: ReturnType<typeof createPriceTag>, u: number, dir: number) {
  const q = (u * 2) % 1 || (u >= 1 ? 1 : 0); // progress along the current leg
  const speed = Math.sin(Math.PI * q);
  tag.sway = -dir * (0.3 * speed + 0.05 * Math.sin(u * 46) * speed);
}
const offerTrip = param((u) => { along(ROUTE_TO_SELLER_HI, u, offer.group.position); lean(offerTag, u, 1); });
const counterTrip = param((u) => { along(ROUTE_TO_BUYER, u, counter.group.position); lean(counterTag, u, -1); });
const offerFlip = param((f) => { offerTag.flip = f; });
const counterFlip = param((f) => { counterTag.flip = f; });
const sellerScreen = param((v) => P.seller.setScreen(videoTexture(v > 0.5 ? "Negotiation" : "MaskedRelay")));
const dealBurst = param((t) => { burst.t = t; });

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

    // price tags hang from the packets' lower-left corner; each flips at Karl to the other side
    offerTag = createPriceTag(
      { caption: "ASK", price: "$35", bg: "#EAF3FA", fg: "#0F1B2D", accent: "#4B9CD3" },
      { caption: "OFFER", price: "$35", bg: "#4B9CD3", fg: "#FFFFFF", accent: "#2F7DB5" },
    );
    counterTag = createPriceTag(
      { caption: "WAS", price: "$35", bg: "#EAF3FA", fg: "#0F1B2D", accent: "#8AA4BA", strike: true },
      { caption: "COUNTER", price: "$40", bg: "#7EE0A1", fg: "#0F1B2D", accent: "#3DB874" },
    );
    offerTag.group.position.set(-2.05, -0.75, 0.08);
    counterTag.group.position.set(2.05, -0.75, 0.08); // trailing end: it travels right to left
    offerTag.group.scale.setScalar(1.2);
    counterTag.group.scale.setScalar(1.2);
    offer.group.add(offerTag.group);
    counter.group.add(counterTag.group);
    tagFade = fader(tagMaterials(), 1);
    burst = createDealBurst(new THREE.Vector3(HUB.x, HUB.y + 0.4, HUB.z + 0.6));
    w.scene.add(burst.root);

    const d = textLabel(["deal · $40"], { size: 72, weight: 700, color: "#7EE0A1", align: "center" });
    deal = d.mesh;
    d.mat.depthTest = false; // coins fly past it, never in front of it
    deal.renderOrder = 10;
    deal.position.set(HUB.x, HUB.y + 3.4, HUB.z + 1);
    w.scene.add(deal);
    dealFade = fader([d.mat], 0);

    this.texts = [
      text(w, "Karl haggles for you.", { x: 140, y: 100, cls: "title" }),
      text(w, "offer → counter → deal · a deal state machine: nothing commits until both sides say yes", { x: 140, y: 930, cls: "small" }),
    ];
  },

  build(w, tl) {
    hidePacket(tl, 0); // the relay scene's "omw" packet leaves first
    tl.to(w.camera.position, { x: HUB.x, y: HUB.y + 2.2, z: HUB.z + 24, duration: 1.6 }, 0);
    tl.to(w.look, { x: HUB.x, y: HUB.y + 0.8, z: HUB.z, duration: 1.6 }, 0);
    textIn(tl, this.texts[0], 0.6);

    // the seller's phone switches to the negotiation thread (back to the relay thread going backwards)
    // (the screen swap is a tweened value, so seeks and jumps in either direction always land on the right clip)
    tl.to(sellerScreen, { t: 1, duration: 0.01 }, 0.8);
    tl.call(() => { if (!tl.reversed()) playClip("Negotiation"); else playClip("MaskedRelay", true); }, [], 0.8);

    // 1) buyer's ask becomes a real offer at Karl: it pauses there while its tag flips $35 ask -> offer
    tl.to(offer.group, { visible: true, duration: 0.01 }, 1.0);
    tl.fromTo(offerTrip, { t: 0 }, { t: 0.5, duration: 1.2, ease: "power2.inOut", immediateRender: false }, 1.0);
    tl.to(offer.state, { mask: 1, duration: 0.5, ease: "none" }, 2.3);
    tl.to(offerFlip, { t: 1, duration: 0.8, ease: "none" }, 2.15);
    tl.fromTo(offerTrip, { t: 0.5 }, { t: 1, duration: 1.2, ease: "power2.inOut", immediateRender: false }, 2.8);
    tl.to(offer.group.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.35 }, 4.1);

    // 2) the seller counters with just a number: the tag leaves showing the old $35 struck out and flips to $40 at Karl
    tl.to(counter.group, { visible: true, duration: 0.01 }, 4.4);
    tl.fromTo(counterTrip, { t: 0 }, { t: 0.5, duration: 1.2, ease: "power2.inOut", immediateRender: false }, 4.4);
    tl.to(counter.state, { mask: 1, duration: 0.5, ease: "none" }, 5.7);
    tl.to(counterFlip, { t: 1, duration: 0.8, ease: "none" }, 5.55);
    tl.fromTo(counterTrip, { t: 0.5 }, { t: 1, duration: 1.2, ease: "power2.inOut", immediateRender: false }, 6.2);
    tl.to(counter.group.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.35 }, 7.5);

    // 3) buyer says yes: the deal lands at Karl with a coin burst and a shockwave
    tl.fromTo(deal.scale, { x: 0.4, y: 0.4, z: 0.4 }, { x: 1, y: 1, z: 1, duration: 0.7, ease: "back.out(2.4)", immediateRender: false }, 7.7);
    tl.to(dealFade, { opacity: 1, duration: 0.4 }, 7.7);
    tl.fromTo(dealBurst, { t: 0 }, { t: 1, duration: 1.9, ease: "none", immediateRender: false }, 7.7);
    tl.fromTo(P.logo.group.scale, { x: NODE_SCALE, y: NODE_SCALE, z: NODE_SCALE }, { x: NODE_SCALE * 1.2, y: NODE_SCALE * 1.2, z: NODE_SCALE * 1.2, duration: 0.2, yoyo: true, repeat: 1, ease: "power2.out", immediateRender: false }, 7.7);
    textIn(tl, this.texts[1], 9.4); // after the burst has cleared, so rings and coins never cross it

    // 4) push in on the seller's phone so the negotiation thread is readable
    tl.to(P.seller.group.scale, { x: FOCUS_SCALE, y: FOCUS_SCALE, z: FOCUS_SCALE, duration: 1.6, ease: "power2.inOut" }, 8.9);
    tl.to(P.seller.group.rotation, { y: 0, duration: 1.6, ease: "power2.inOut" }, 8.9);
    tl.to(P.seller.group.position, { z: SELLER.z + 2.5, duration: 1.6, ease: "power2.inOut" }, 8.9); // in front of the relay wire
    tl.to(w.camera.position, { x: SELLER.x - 6, y: SELLER.y - 0.4, z: SELLER.z + 19, duration: 1.8, ease: "power3.inOut" }, 8.9);
    tl.to(w.look, { x: SELLER.x - 6, y: SELLER.y - 0.4, z: SELLER.z, duration: 1.8, ease: "power3.inOut" }, 8.9);
    tl.to(deal.position, { y: HUB.y + 2.75, duration: 1.8, ease: "power3.inOut" }, 8.9); // drop clear of the title as the camera comes in
  },

  settle() {
    P.seller.setScreen(videoTexture("Negotiation"));
    playClip("Negotiation", true);
  },
};

/** The next scene clears the "deal · $40" label (it sits where safety's "blocked" appears). */
export function hideDeal(tl: gsap.core.Timeline, at: number) {
  tl.to(dealFade, { opacity: 0, duration: 0.4 }, at);
  tl.to(tagFade, { opacity: 0, duration: 0.3 }, at); // the price tags (the packets they hang from are already tiny)
  tl.to([offer.group, counter.group], { visible: false, duration: 0.01 }, at + 0.3);
}

/** The next scene puts the seller's phone back into the buyer · Karl · seller layout. */
export function restoreSeller(tl: gsap.core.Timeline, at: number) {
  tl.to(P.seller.group.scale, { x: NODE_SCALE, y: NODE_SCALE, z: NODE_SCALE, duration: 1.2, ease: "power2.inOut" }, at);
  tl.to(P.seller.group.rotation, { y: -0.3, duration: 1.2, ease: "power2.inOut" }, at);
  tl.to(P.seller.group.position, { z: SELLER.z, duration: 1.2, ease: "power2.inOut" }, at);
}
