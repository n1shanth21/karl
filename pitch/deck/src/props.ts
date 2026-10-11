import * as THREE from "three";
import { World } from "./world";
import { createLogo, Logo, sampleLogo } from "./lib/logo";
import { createParticles, dustShape, Particles } from "./lib/particles";
import { createPhone, Phone } from "./lib/phone";
import { Card, createCards, createCardTextures } from "./lib/cards";

// Objects that more than one scene animates. Created once, before any scene's init().
// Scenes 3+ happen around HUB, deep in the dust field past the group-chat cards.

export const HUB = new THREE.Vector3(0, 0, -95);

export type Props = {
  logo: Logo;
  particles: Particles;
  phone: Phone; // the hero phone (becomes the buyer's phone later)
  seller: Phone; // the seller's phone in the privacy/safety scenes
  cards: Card[];
};

export let P: Props;

export function createProps(w: World) {
  const count = w.quality === "high" ? 7000 : 3500;
  const particles = createParticles(count);
  particles.setShape("dust", dustShape(count));
  const { pos } = sampleLogo(count, 0.72);
  particles.setShape("logo", pos);
  particles.look.opacity = 0.75;
  w.scene.add(particles.points);

  const logo = createLogo();
  w.scene.add(logo.group);
  w.tick((t) => { logo.spin.rotation.y = Math.sin(t * 0.45) * 0.32; logo.spin.rotation.x = Math.sin(t * 0.3) * 0.08; });

  const phone = createPhone();
  phone.group.visible = false;
  w.scene.add(phone.group);
  const seller = createPhone();
  seller.group.visible = false;
  w.scene.add(seller.group);

  const cards = createCards(64, createCardTextures(), -12, -150);
  for (const c of cards) w.scene.add(c.mesh);
  // Cards bob gently while they float free (the gravity well turns this off).
  w.tick((t) => {
    for (const c of cards) if (c.mesh.visible && c.mesh.userData.free !== false) c.mesh.position.y = c.home.y + Math.sin(t * 0.4 + c.seed * 9) * 0.3;
  });

  // A second light near the hub so objects there are lit like the opening.
  const hubLight = new THREE.PointLight(0x4b9cd3, 120, 90);
  hubLight.position.copy(HUB).add(new THREE.Vector3(-14, 6, 14));
  w.scene.add(hubLight);
  const hubKey = new THREE.PointLight(0xffffff, 90, 90);
  hubKey.position.copy(HUB).add(new THREE.Vector3(10, 12, 22));
  w.scene.add(hubKey);

  P = { logo, particles, phone, seller, cards };
}
