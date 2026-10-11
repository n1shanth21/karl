import * as THREE from "three";
import { World, COLORS } from "../world";

// A low-poly desk lamp built from primitives (round base, gooseneck tube, domed shade,
// emissive bulb) plus the little light "pulse" that travels from it to the phone.
// Everything is a pure function of three numbers, so timelines can scrub it both ways:
//   setAssemble(0..1)  pieces fly in one after another (base, arm draws, head, bulb pops)
//   setGlow(0..1)      bulb + shade interior + halo + light cone
//   setExit(1..0)      fade/shrink away (wired to magicFade, so the next scene needs no call)

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const win = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const outBack = (x: number) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const outCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const lerp = THREE.MathUtils.lerp;

let glowTex: THREE.CanvasTexture | undefined;
let ringTex: THREE.CanvasTexture | undefined;

function radialTexture(stops: [number, string][]) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const softGlow = () => (glowTex ??= radialTexture([[0, "rgba(255,255,255,1)"], [0.25, "rgba(255,255,255,0.45)"], [0.6, "rgba(255,255,255,0.1)"], [1, "rgba(255,255,255,0)"]]));
const softRing = () => (ringTex ??= radialTexture([[0, "rgba(255,255,255,0)"], [0.6, "rgba(255,255,255,0)"], [0.82, "rgba(255,255,255,0.9)"], [0.92, "rgba(255,255,255,0.25)"], [1, "rgba(255,255,255,0)"]]));

function glowSprite(color: THREE.ColorRepresentation, map = softGlow()) {
  const m = new THREE.SpriteMaterial({ map, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false, opacity: 0 });
  const s = new THREE.Sprite(m);
  s.renderOrder = 10;
  return s;
}

// A tube that can be drawn from its start (like motion.drawableTube, but lit).
function drawableMetal(curve: THREE.Curve<THREE.Vector3>, radius: number, mat: THREE.Material, segments: number) {
  const radial = 8;
  const geo = new THREE.TubeGeometry(curve, segments, radius, radial, false);
  const total = geo.index!.count;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return {
    mesh,
    set(v: number) {
      const per = radial * 6;
      geo.setDrawRange(0, Math.floor((v * total) / per) * per);
      mesh.visible = v > 0.001;
    },
  };
}

export function createLamp(w: World) {
  const group = new THREE.Group(); // the scene positions and scales this
  const spin = new THREE.Group(); // slow sway
  const root = new THREE.Group(); // exit shrink
  group.add(spin);
  spin.add(root);
  group.visible = false;

  // dark steel with Carolina blue trim; opaque unless the lamp is fading out
  const metal = new THREE.MeshStandardMaterial({ color: 0x7a9cc4, metalness: 0.45, roughness: 0.35, emissive: 0x123a5e });
  const metalDark = new THREE.MeshStandardMaterial({ color: 0x3d5878, metalness: 0.45, roughness: 0.4, emissive: 0x0c2540 });
  const trim = new THREE.MeshBasicMaterial({ color: COLORS.blue, toneMapped: false });
  const inside = new THREE.MeshBasicMaterial({ color: 0x0b1424, side: THREE.BackSide, toneMapped: false });
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0x33445c, toneMapped: false });
  const solids = [metal, metalDark, trim, inside, bulbMat];
  for (const m of solids) m.transparent = true;

  // base: stepped disc with a blue rim
  const base = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.84, 0.98, 0.2, 32), metalDark);
  disc.position.y = 0.1;
  const step = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.46, 0.22, 24), metal);
  step.position.y = 0.31;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.022, 6, 48), trim);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.2;
  const joint = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), metal);
  joint.position.y = 0.44;
  base.add(disc, step, rim, joint);
  root.add(base);

  // gooseneck arm: rises, arcs over to the left and drops into the shade
  const armPts = [[0, 0.44], [0.02, 0.95], [-0.04, 1.6], [-0.4, 2.2], [-1.0, 2.5], [-1.5, 2.3], [-1.62, 1.95]];
  const armCurve = new THREE.CatmullRomCurve3(armPts.map(([x, y]) => new THREE.Vector3(x, y, 0)), false, "centripetal");
  const arm = drawableMetal(armCurve, 0.058, metal, 56);
  root.add(arm.mesh);
  const neck = armCurve.getPoint(1);

  // head: domed shade (outer dark steel, inner glows), rim ring, socket, bulb, halo, light cone
  const head = new THREE.Group();
  const headRest = { pos: neck.clone(), rx: -0.5, rz: -0.38 };
  const profile = [[0.76, -0.62], [0.72, -0.5], [0.62, -0.36], [0.48, -0.2], [0.31, -0.1], [0.15, -0.04], [0.001, -0.02]].map(([x, y]) => new THREE.Vector2(x, y));
  const lathe = new THREE.LatheGeometry(profile, 32);
  const shadeOut = new THREE.Mesh(lathe, metalDark);
  const shadeIn = new THREE.Mesh(lathe, inside);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.022, 6, 48), trim);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = -0.62;
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.12, 14), metal);
  collar.position.y = 0.02;
  const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.22, 10), metal);
  socket.position.y = -0.14;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), bulbMat);
  bulb.position.y = -0.4;
  head.add(shadeOut, shadeIn, lip, collar, socket, bulb);

  const halo = glowSprite(0xfff1d2);
  halo.position.copy(bulb.position);
  const haloBlue = glowSprite(COLORS.blue);
  haloBlue.position.copy(bulb.position);
  head.add(halo, haloBlue);

  // faint cone of light under the shade (additive, fades to nothing at the bottom)
  const coneGeo = new THREE.CylinderGeometry(0.7, 1.45, 2.4, 28, 1, true);
  const cols = new Float32Array(coneGeo.attributes.position.count * 3);
  for (let i = 0; i < coneGeo.attributes.position.count; i++) {
    const k = coneGeo.attributes.position.getY(i) > 0 ? 1 : 0;
    cols.set([k, k, k], i * 3);
  }
  coneGeo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  const coneMat = new THREE.MeshBasicMaterial({ color: 0xbfdcf5, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false });
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.position.y = -0.62 - 1.2;
  cone.renderOrder = 9;
  head.add(cone);

  head.position.copy(headRest.pos);
  head.rotation.set(headRest.rx, 0, headRest.rz);
  root.add(head);

  const off = new THREE.Color(0x33445c), on = new THREE.Color(2.4, 2.2, 1.9);
  const innerOff = new THREE.Color(0x0b1424), innerOn = new THREE.Color(0.62, 0.52, 0.36);
  let asm = 0, glow = 0, exit = 1;

  const apply = () => {
    group.visible = asm > 0.001 && exit > 0.001;
    if (!group.visible) return;
    // pieces arrive one after another
    const eb = outBack(win(asm, 0, 0.35));
    base.visible = asm > 0.001;
    base.position.y = (1 - eb) * 4.5;
    base.scale.setScalar(lerp(0.4, 1, eb));
    arm.set(outCubic(win(asm, 0.2, 0.6)));
    const wh = win(asm, 0.45, 0.85), eh = outBack(wh);
    head.visible = wh > 0.001;
    head.position.set(headRest.pos.x + (1 - eh) * 3.2, headRest.pos.y + (1 - eh) * 4.2, headRest.pos.z + (1 - eh) * 1.5);
    head.scale.setScalar(lerp(0.2, 1, eh));
    head.rotation.set(headRest.rx, 0, headRest.rz + (1 - eh) * 1.5);
    const wb = win(asm, 0.8, 1), ebb = outBack(wb);
    bulb.visible = wb > 0.001;
    bulb.scale.setScalar(Math.max(ebb, 0.001));
    // exit: shrink toward the base and fade
    root.scale.setScalar(lerp(0.85, 1, exit));
    for (const m of solids) m.opacity = exit;
    // glow
    const g = glow * exit;
    bulbMat.color.copy(off).lerp(on, glow);
    inside.color.copy(innerOff).lerp(innerOn, glow * 0.9);
    halo.material.opacity = g * 0.85;
    haloBlue.material.opacity = g * 0.38;
    halo.scale.setScalar(2.2 * (0.7 + 0.3 * glow));
    haloBlue.scale.setScalar(3.4 * (0.6 + 0.4 * glow));
    coneMat.opacity = g * 0.11;
    cone.visible = g > 0.001;
    halo.visible = haloBlue.visible = g > 0.001;
  };
  apply();

  // slow turn, only while visible
  w.tick((t) => { if (group.visible) spin.rotation.y = 0.15 + Math.sin(t * 0.5) * 0.6; });

  return {
    group,
    setAssemble(v: number) { asm = v; apply(); },
    setGlow(v: number) { glow = v; apply(); },
    setExit(v: number) { exit = v; apply(); },
    // where the bulb is right now (world space), for the pulse to start from
    bulbWorld(out: THREE.Vector3) {
      bulb.updateWorldMatrix(true, false);
      return out.setFromMatrixPosition(bulb.matrixWorld);
    },
  };
}
export type Lamp = ReturnType<typeof createLamp>;

// Bulb flicker as a pure function of p (0..1): off, stutters, then holds at full.
const FLICKER: [number, number][] = [[0, 0], [0.1, 0], [0.16, 0.75], [0.24, 0.05], [0.32, 0.9], [0.4, 0.2], [0.5, 0.65], [0.58, 0.35], [0.7, 1], [1, 1]];
export function flicker(p: number) {
  for (let i = 1; i < FLICKER.length; i++) {
    if (p <= FLICKER[i][0]) {
      const [p0, v0] = FLICKER[i - 1], [p1, v1] = FLICKER[i];
      return lerp(v0, v1, (p - p0) / (p1 - p0));
    }
  }
  return 1;
}

// A comet of light that runs along a curve from the bulb to the phone, plus a flare at
// each end and a ripple ("ping") on the phone for when the message lands.
export function createPulse(curve: THREE.QuadraticBezierCurve3, lamp: Lamp) {
  const group = new THREE.Group(); // the comet (hidden outside its run)
  group.visible = false;
  const all = new THREE.Group(); // comet + ripple; add this one to the scene
  const N = 9;
  const trail: THREE.Sprite[] = [];
  for (let i = 0; i < N; i++) {
    const s = glowSprite(i === 0 ? 0xffffff : COLORS.blue);
    trail.push(s);
    group.add(s);
  }
  const head = glowSprite(COLORS.blue);
  const flareA = glowSprite(0xfff1d2);
  const flareB = glowSprite(COLORS.blue);
  group.add(head, flareA, flareB);
  const ripple = glowSprite(COLORS.blue, softRing());
  ripple.visible = false;

  const tmp = new THREE.Vector3();
  let t = 0, ping = 0;
  const ease = (x: number) => x * x * (3 - 2 * x) * 0.35 + x * 0.65; // eased, but never stalls

  const state = {
    group: all,
    get travel() { return t; },
    set travel(v: number) {
      t = v;
      const vis = v > 0.001 && v < 0.999;
      group.visible = vis;
      if (!vis) return;
      lamp.bulbWorld(curve.v0);
      const env = Math.min(win(v, 0, 0.08), 1 - win(v, 0.9, 1));
      for (let i = 0; i < N; i++) {
        const s = trail[i];
        curve.getPoint(ease(clamp01(v - i * 0.045)), tmp);
        s.position.copy(tmp);
        const k = 1 - i / N;
        s.scale.setScalar((i === 0 ? 1.5 : 1.3) * (0.3 + 0.7 * k));
        s.material.opacity = env * k * k * (i === 0 ? 1 : 0.8);
      }
      head.position.copy(trail[0].position);
      head.scale.setScalar(2.4);
      head.material.opacity = env * 0.5;
      // flare at the lamp as it leaves, flare at the phone as it lands
      const a = win(v, 0, 0.3);
      flareA.position.copy(curve.v0);
      flareA.scale.setScalar(1 + a * 4);
      flareA.material.opacity = (1 - a) * 0.9 * win(v, 0, 0.03);
      const b = win(v, 0.72, 1);
      flareB.position.copy(curve.v2);
      flareB.scale.setScalar(1 + b * 2.2);
      flareB.material.opacity = Math.sin(b * Math.PI) * 0.4;
    },
    get ping() { return ping; },
    set ping(v: number) {
      ping = v;
      ripple.visible = v > 0.001 && v < 0.999;
      if (!ripple.visible) return;
      ripple.position.copy(curve.v2);
      ripple.scale.setScalar(2.5 + v * 8);
      ripple.material.opacity = (1 - v) * (1 - v) * 0.9;
    },
  };
  all.add(group, ripple);
  return state;
}
