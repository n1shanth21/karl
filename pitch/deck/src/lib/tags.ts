import * as THREE from "three";
import { font, roundRect } from "./label";

// 3D props for the negotiation scene.
//  - createPriceTag: a thin extruded tag on a string. Two canvas faces (front / back);
//    tween `state.flip` 0 -> 1 and it turns 180 degrees to show the back. `state.sway`
//    is the swing of the string. Both are plain setters, so scrubbing is always in sync.
//  - createDealBurst: instanced coins + sparkles + two shock rings. Everything is a pure
//    function of one tweened number (`state.t`, 0 -> 1), so it reverses cleanly.
// Geometry and materials are shared and low-poly; nothing allocates per frame.

export type TagFace = { caption: string; price: string; bg: string; fg: string; accent: string; strike?: boolean };

const TAG_W = 1.0, TAG_H = 1.3, TAG_R = 0.17;
const DEPTH = 0.07, BEVEL = 0.018;
const HOLE_Y = TAG_H / 2 - 0.2;
const STRING = 0.22;
/** Distance from the string's attach point to the tag's bottom edge (packet-local units). */
export const TAG_HANG = STRING + HOLE_Y + TAG_H / 2;

function tagShape() {
  const hw = TAG_W / 2, hh = TAG_H / 2, r = TAG_R;
  const s = new THREE.Shape();
  s.moveTo(-hw + r, -hh);
  s.lineTo(hw - r, -hh);
  s.quadraticCurveTo(hw, -hh, hw, -hh + r);
  s.lineTo(hw, hh - r);
  s.quadraticCurveTo(hw, hh, hw - r, hh);
  s.lineTo(-hw + r, hh);
  s.quadraticCurveTo(-hw, hh, -hw, hh - r);
  s.lineTo(-hw, -hh + r);
  s.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  const hole = new THREE.Path();
  hole.absarc(0, HOLE_Y, 0.075, 0, Math.PI * 2, true);
  s.holes.push(hole);
  return s;
}

// Shared by every tag.
let bodyGeo: THREE.ExtrudeGeometry;
let faceGeo: THREE.ShapeGeometry;
let stringGeo: THREE.CylinderGeometry;
let loopGeo: THREE.TorusGeometry;
let bodyMat: THREE.MeshStandardMaterial;
let stringMat: THREE.MeshStandardMaterial;
const tagMats: THREE.Material[] = [];

/** Every material the tags use (shared + faces), for one `fader(...)` that hides them all. */
export function tagMaterials() { return tagMats; }

function shared() {
  if (bodyGeo) return;
  const shape = tagShape();
  bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: DEPTH, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL, bevelSegments: 1, curveSegments: 8 });
  bodyGeo.translate(0, 0, -DEPTH / 2);
  faceGeo = new THREE.ShapeGeometry(shape, 8);
  // remap the raw shape coordinates to 0..1 so a canvas fits the outline exactly
  const uv = faceGeo.attributes.uv as THREE.BufferAttribute;
  const pos = faceGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / TAG_W + 0.5, pos.getY(i) / TAG_H + 0.5);
  stringGeo = new THREE.CylinderGeometry(0.014, 0.014, 1, 5);
  loopGeo = new THREE.TorusGeometry(0.058, 0.014, 5, 14);
  bodyMat = new THREE.MeshStandardMaterial({ color: 0xcfe3f2, roughness: 0.45, metalness: 0.2, transparent: true });
  stringMat = new THREE.MeshStandardMaterial({ color: 0xe9f2f9, roughness: 0.7, transparent: true });
  tagMats.push(bodyMat, stringMat);
}

function faceTexture(f: TagFace) {
  const PXU = 300; // canvas px per tag unit
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(TAG_W * PXU);
  canvas.height = Math.round(TAG_H * PXU);
  const ctx = canvas.getContext("2d")!;
  const cw = canvas.width, ch = canvas.height;
  ctx.fillStyle = f.bg;
  ctx.fillRect(0, 0, cw, ch);
  // accent band under the hole + hairline frame
  ctx.fillStyle = f.accent;
  ctx.fillRect(0, 0, cw, ch * 0.2);
  ctx.strokeStyle = f.accent;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 5;
  roundRect(ctx, 14, ch * 0.2 + 14, cw - 28, ch * 0.8 - 28, 22);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = f.fg;
  ctx.font = font(700, 40);
  ctx.globalAlpha = 0.75;
  ctx.fillText(f.caption, cw / 2, ch * 0.4);
  ctx.globalAlpha = 1;
  ctx.font = font(800, 118);
  ctx.fillText(f.price, cw / 2, ch * 0.66);
  if (f.strike) {
    ctx.strokeStyle = "#E5484D";
    ctx.lineWidth = 12;
    ctx.lineCap = "round";
    const w = ctx.measureText(f.price).width;
    ctx.beginPath();
    ctx.moveTo(cw / 2 - w / 2 - 10, ch * 0.76);
    ctx.lineTo(cw / 2 + w / 2 + 10, ch * 0.56);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const easeOutBack = (x: number) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);

export function createPriceTag(front: TagFace, back: TagFace) {
  shared();
  const root = new THREE.Group(); // attach this to a packet; its origin is the string's top
  const swing = new THREE.Group(); // pivots at the string's top
  root.add(swing);

  const str = new THREE.Mesh(stringGeo, stringMat);
  str.scale.set(1, STRING, 1);
  str.position.y = -STRING / 2;
  swing.add(str);
  const loop = new THREE.Mesh(loopGeo, stringMat);
  loop.rotation.y = Math.PI / 2;
  loop.position.y = -STRING;
  swing.add(loop);

  // the tag turns about the vertical axis through its hole
  const flipper = new THREE.Group();
  flipper.position.y = -STRING - HOLE_Y;
  swing.add(flipper);
  flipper.add(new THREE.Mesh(bodyGeo, bodyMat));

  const faceMats = [front, back].map((f) => new THREE.MeshBasicMaterial({ map: faceTexture(f), color: 0xe4e4e4, toneMapped: false, transparent: true }));
  const z = DEPTH / 2 + BEVEL + 0.003;
  const fm = new THREE.Mesh(faceGeo, faceMats[0]);
  fm.position.z = z;
  const bm = new THREE.Mesh(faceGeo, faceMats[1]);
  bm.position.z = -z;
  bm.rotation.y = Math.PI;
  flipper.add(fm, bm);
  tagMats.push(...faceMats);

  let flip = 0, sway = 0;
  const state = {
    group: root,
    get flip() { return flip; },
    set flip(v: number) {
      flip = v;
      const c = THREE.MathUtils.clamp(v, 0, 1);
      flipper.rotation.y = Math.PI * easeOutBack(c) * 1; // overshoots a touch, then settles
      const hop = Math.sin(Math.PI * c);
      flipper.position.z = hop * 0.45;
      flipper.scale.setScalar(1 + hop * 0.16);
    },
    get sway() { return sway; },
    set sway(v: number) { sway = v; swing.rotation.z = v; },
  };
  state.flip = 0;
  return state;
}

// ---------------------------------------------------------------------------------------

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dummy = new THREE.Object3D();
const col = new THREE.Color();

export function createDealBurst(origin: THREE.Vector3, coinCount = 36, sparkCount = 64) {
  const root = new THREE.Group();
  root.position.copy(origin);
  root.visible = false;
  const rand = rng(7);

  // --- coins: a fat disc with a "$" on both faces
  const coinTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    g.fillStyle = "#F6CF5C";
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = "#C8962A";
    g.lineWidth = 7;
    g.beginPath(); g.arc(64, 64, 50, 0, Math.PI * 2); g.stroke();
    g.fillStyle = "#B07A14";
    g.font = font(800, 78);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("$", 64, 68);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const coinGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.07, 14);
  const coinSide = new THREE.MeshStandardMaterial({ color: 0xe0b23c, roughness: 0.35, metalness: 0.5, emissive: 0x7a5410, emissiveIntensity: 0.6 });
  const coinFace = new THREE.MeshStandardMaterial({ map: coinTex, roughness: 0.4, metalness: 0.3, emissive: 0xffd24a, emissiveMap: coinTex, emissiveIntensity: 0.5 });
  const coins = new THREE.InstancedMesh(coinGeo, [coinSide, coinFace, coinFace], coinCount);
  coins.frustumCulled = false;
  root.add(coins);

  // --- sparkles: small bright octahedra in blue / white / mint
  const sparkGeo = new THREE.OctahedronGeometry(0.15, 0);
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true });
  const sparks = new THREE.InstancedMesh(sparkGeo, sparkMat, sparkCount);
  sparks.frustumCulled = false;
  root.add(sparks);
  const palette = ["#7CC4F5", "#FFFFFF", "#7EE0A1", "#4B9CD3"];
  for (let i = 0; i < sparkCount; i++) sparks.setColorAt(i, col.set(palette[i % palette.length]));

  // --- shock rings (flat rings that face the camera, tilted a little for depth)
  const ringGeo = new THREE.RingGeometry(0.975, 1, 64);
  const ringMats = [0x7ee0a1, 0x4b9cd3].map((c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  const rings = ringMats.map((m) => {
    const r = new THREE.Mesh(ringGeo, m);
    r.rotation.x = -1.2; // lying almost flat: a shockwave on the floor, so it never climbs up to the label
    r.position.y = 0; // centred just above the Karl mark, so the front of the ring clears its caption
    root.add(r);
    return r;
  });

  // per-instance launch values (fixed once)
  const cv = Array.from({ length: coinCount }, (_, i) => {
    const a = (i / coinCount) * Math.PI * 2 + rand() * 0.5;
    const sp = 4.2 + rand() * 4;
    return { vx: Math.cos(a) * sp * 1.15, vy: 0.5 + rand() * 6.2, vz: Math.sin(a) * sp * 0.35 - 0.8, sx: rand() * 6, sy: rand() * 6, wx: 5 + rand() * 7, wz: 4 + rand() * 6, s: 0.8 + rand() * 0.5, delay: rand() * 0.08 };
  });
  const sv = Array.from({ length: sparkCount }, (_, i) => {
    const a = rand() * Math.PI * 2, e = (rand() - 0.5) * 1.6;
    const sp = 3.5 + rand() * 6.5;
    return { dx: Math.cos(a) * Math.cos(e) * sp * 1.2, dy: Math.sin(e) * sp + 0.5, dz: Math.sin(a) * Math.cos(e) * sp * 0.4, s: 0.7 + rand() * 1.1, ph: rand() * 6.28, spin: 3 + rand() * 6 };
  });

  const DUR = 1.7; // seconds of simulated motion for t: 0 -> 1
  const GRAV = 15;
  let t = 0;
  const apply = () => {
    const live = t > 0.0005 && t < 0.9995;
    root.visible = live;
    if (!live) return;
    for (let i = 0; i < coinCount; i++) {
      const c = cv[i];
      const k = Math.max(0, t - c.delay);
      const tau = k * DUR;
      dummy.position.set(c.vx * tau, 0.2 + c.vy * tau - 0.5 * GRAV * tau * tau, c.vz * tau);
      dummy.rotation.set(c.sx + c.wx * tau, 0, c.sy + c.wz * tau);
      const grow = Math.min(1, k * 14);
      const out = 1 - THREE.MathUtils.smoothstep(t, 0.72, 0.98);
      // coins that fall past the Karl mark shrink away before they reach the caption row
      const floor = 1 - THREE.MathUtils.smoothstep(-dummy.position.y, 1.2, 2.2);
      dummy.scale.setScalar(c.s * grow * out * floor);
      dummy.updateMatrix();
      coins.setMatrixAt(i, dummy.matrix);
    }
    coins.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < sparkCount; i++) {
      const s = sv[i];
      const e = 1 - Math.pow(1 - Math.min(1, t * 1.15), 3); // fast out, then drift
      dummy.position.set(s.dx * e * 0.62, s.dy * e * 0.3 + 0.2, s.dz * e * 0.62); // flatter than wide: stays under the label
      dummy.rotation.set(s.ph + t * s.spin, t * s.spin * 0.7, 0);
      const twinkle = 0.65 + 0.35 * Math.sin(t * 30 + s.ph);
      const life = Math.sin(Math.PI * Math.min(1, t * 1.05)) ** 0.6;
      dummy.scale.setScalar(s.s * twinkle * life);
      dummy.updateMatrix();
      sparks.setMatrixAt(i, dummy.matrix);
    }
    sparks.instanceMatrix.needsUpdate = true;
    rings.forEach((r, j) => {
      const k = THREE.MathUtils.clamp((t - j * 0.08) / 0.5, 0, 1);
      const ease = 1 - Math.pow(1 - k, 3);
      r.scale.setScalar(0.6 + ease * (j ? 3.6 : 5.4));
      ringMats[j].opacity = k > 0 && k < 1 ? 0.95 * Math.pow(1 - k, 1.3) : 0;
      r.visible = ringMats[j].opacity > 0.003;
    });
  };
  apply();

  return {
    root,
    get t() { return t; },
    set t(v: number) { t = v; apply(); },
  };
}
