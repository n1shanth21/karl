import * as THREE from "three";
import { Scene, text, textIn } from "../scene";
import { COLORS, World } from "../world";

// Throwaway scenes that prove the director: forward, back mid-transition, skip, jump.
// Replaced by the real scenes in step 4.

let orb: THREE.Mesh;

const one: Scene = {
  id: "test1", title: "Test one", notes: "Orb flies in.", move: "fly-in", texts: [],
  init(w) {
    orb = new THREE.Mesh(new THREE.IcosahedronGeometry(3, 1), new THREE.MeshStandardMaterial({ color: COLORS.blue, flatShading: true, emissive: COLORS.deep, emissiveIntensity: 0.4 }));
    orb.position.set(0, 0, -60);
    orb.scale.setScalar(0.01);
    w.scene.add(orb);
    w.tick((_, dt) => { orb.rotation.y += dt * 0.4; });
    this.texts = [text(w, "the campus marketplace<br>that lives in <span class='blue'>iMessage</span>", { x: 960, y: 760, cls: "title", align: "center" })];
  },
  build(_w, tl) {
    tl.to(orb.position, { z: 0, duration: 1.6 }, 0);
    tl.to(orb.scale, { x: 1, y: 1, z: 1, duration: 1.6 }, 0);
    textIn(tl, this.texts, 1.0);
  },
};

const two: Scene = {
  id: "test2", title: "Test two", notes: "Camera orbits left.", move: "orbit", texts: [],
  init(w) {
    this.texts = [text(w, "Where do I even post this?", { x: 160, y: 420, cls: "hero" })];
  },
  build(w, tl) {
    tl.to(w.camera.position, { x: 18, y: 4, z: 22, duration: 1.8 }, 0);
    tl.to(orb.position, { x: 6 }, 0.2);
    textIn(tl, this.texts, 1.1);
  },
};

const three: Scene = {
  id: "test3", title: "Test three", notes: "Orb turns red, camera pulls back.", move: "pull-back", texts: [],
  init(w) {
    this.texts = [text(w, "venmo me first pls", { x: 960, y: 880, cls: "line mono", align: "center" })];
  },
  build(w, tl) {
    const mat = orb.material as THREE.MeshStandardMaterial;
    tl.to(w.camera.position, { x: 0, y: 0, z: 40, duration: 1.4 }, 0);
    tl.to(mat.color, { r: COLORS.block.r, g: COLORS.block.g, b: COLORS.block.b, duration: 0.8 }, 0.6);
    textIn(tl, this.texts, 1.0);
  },
};

export const TEST_SCENES = [one, two, three];
