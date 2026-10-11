import * as THREE from "three";
import { World } from "../world";

// Small reusable moves. Each captures its start values when the scene is built (the
// director always builds a scene while the world sits at the previous scene's end
// state), so every move is a pure function of one tweened number and reverses cleanly.

// A tweenable number whose setter applies it to the world. Prefer this over gsap
// onUpdate callbacks: jumps and rewinds set values without firing callbacks, but they
// always go through setters, so the world can never drift out of sync.
export function param(apply: (v: number) => void, start = 0) {
  let v = start;
  return {
    get t() { return v; },
    set t(x: number) { v = x; apply(x); },
  };
}

// Swing the camera around `center` (keeps distance smooth, adds `turn` radians on the way).
export function cameraArc(w: World, tl: gsap.core.Timeline, center: THREE.Vector3, to: THREE.Vector3, at: number, duration: number, turn = 0.6) {
  const from = w.camera.position.clone().sub(center);
  const end = to.clone().sub(center);
  const s0 = new THREE.Spherical().setFromVector3(from);
  const s1 = new THREE.Spherical().setFromVector3(end);
  // shortest way round, plus the extra swing
  let dTheta = s1.theta - s0.theta;
  if (dTheta > Math.PI) dTheta -= Math.PI * 2;
  if (dTheta < -Math.PI) dTheta += Math.PI * 2;
  const s = new THREE.Spherical();
  const p = param((k) => {
    s.radius = THREE.MathUtils.lerp(s0.radius, s1.radius, k);
    s.phi = THREE.MathUtils.lerp(s0.phi, s1.phi, k);
    s.theta = s0.theta + dTheta * k + Math.sin(k * Math.PI) * turn;
    w.camera.position.setFromSpherical(s).add(center);
  });
  tl.to(p, { t: 1, duration, ease: "power2.inOut" }, at);
}

// A glowing tube along a curve that can "draw itself" (tween .draw from 0 to 1).
export function drawableTube(curve: THREE.Curve<THREE.Vector3>, radius: number, color: number | THREE.Color, segments = 120) {
  const radial = 8;
  const geo = new THREE.TubeGeometry(curve, segments, radius, radial, false);
  const total = geo.index!.count;
  const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  let d = 0;
  const state = {
    mesh,
    get draw() { return d; },
    set draw(v: number) {
      d = v;
      const per = radial * 6;
      geo.setDrawRange(0, Math.floor((v * total) / per) * per);
      mesh.visible = v > 0.001;
    },
  };
  state.draw = 0;
  return state;
}

// Point at fraction t along a polyline (used by message packets).
export function along(points: THREE.Vector3[], t: number, out = new THREE.Vector3()) {
  const segs = points.length - 1;
  const x = THREE.MathUtils.clamp(t, 0, 1) * segs;
  const i = Math.min(Math.floor(x), segs - 1);
  return out.lerpVectors(points[i], points[i + 1], x - i);
}

// Copy the camera's rotation so a label always faces the audience.
export function billboard(w: World, obj: THREE.Object3D) {
  w.tick(() => { if (obj.visible) obj.quaternion.copy(w.camera.quaternion); });
}
