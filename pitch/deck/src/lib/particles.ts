import * as THREE from "three";

// One particle system reused across the whole pitch. Every particle has four "home"
// positions (dust, logo, layers, cloud). The shader blends between them by the weights
// in `p.w`, so a gsap tween of the weights morphs the swarm and runs backwards cleanly.
// Points away from the focus distance grow and dim: a cheap depth-of-field pull.

export type ShapeName = "dust" | "logo" | "layers" | "cloud";
export const SHAPES: ShapeName[] = ["dust", "logo", "layers", "cloud"];

export type Particles = {
  points: THREE.Points;
  w: Record<ShapeName, number>; // tween these (0..1); they are normalized in the shader
  look: { size: number; opacity: number; focus: number; dof: number }; // tween these too
  setShape: (name: ShapeName, pos: Float32Array) => void;
  count: number;
};

const vertex = /* glsl */ `
  attribute vec3 aDust; attribute vec3 aLogo; attribute vec3 aLayers; attribute vec3 aCloud;
  attribute vec3 color; attribute float aSeed;
  uniform vec4 uW; uniform float uTime; uniform float uSize; uniform float uOpacity;
  uniform float uFocus; uniform float uDof; uniform float uPixelRatio;
  varying vec3 vColor; varying float vAlpha;
  void main() {
    float sum = max(uW.x + uW.y + uW.z + uW.w, 0.0001);
    vec3 p = (aDust * uW.x + aLogo * uW.y + aLayers * uW.z + aCloud * uW.w) / sum;
    float settled = max(max(uW.x, uW.y), max(uW.z, uW.w)) / sum; // 1 = resting on one shape
    float s = aSeed * 6.2831;
    // gentle drift, strongest as dust; a swirl while particles travel between shapes
    vec3 drift = vec3(sin(uTime * 0.31 + s), cos(uTime * 0.23 + s * 2.0), sin(uTime * 0.19 + s * 3.0));
    p += drift * (0.45 * uW.x / sum + 0.03);
    p += vec3(cos(s + uTime), sin(s * 1.7 + uTime), cos(s * 2.3)) * (1.0 - settled) * 4.0;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = -mv.z;
    float blur = uDof * abs(depth - uFocus);
    gl_PointSize = uSize * uPixelRatio * (1.0 + blur) * (30.0 / max(depth, 0.1)) * (0.6 + aSeed * 0.8);
    vAlpha = uOpacity / (1.0 + blur * blur * 2.0);
    vColor = color;
    gl_Position = projectionMatrix * mv;
  }`;

const fragment = /* glsl */ `
  varying vec3 vColor; varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor * a, a);
  }`;

export function createParticles(count: number): Particles {
  const geo = new THREE.BufferGeometry();
  const color = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const white = new THREE.Color("#EAF4FF"), blue = new THREE.Color("#4B9CD3");
  for (let i = 0; i < count; i++) {
    (Math.random() < 0.7 ? white : blue).toArray(color, i * 3);
    seed[i] = Math.random();
  }
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3)); // unused but required
  geo.setAttribute("color", new THREE.BufferAttribute(color, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  for (const name of SHAPES) geo.setAttribute(attr(name), new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5); // never frustum-culled

  const mat = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      uW: { value: new THREE.Vector4(1, 0, 0, 0) },
      uTime: { value: 0 },
      uSize: { value: 1 },
      uOpacity: { value: 0 },
      uFocus: { value: 30 },
      uDof: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 1.5) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 5;
  const w = { dust: 1, logo: 0, layers: 0, cloud: 0 };
  const look = { size: 2.6, opacity: 0, focus: 30, dof: 0 };
  points.onBeforeRender = (renderer) => {
    const u = mat.uniforms;
    u.uW.value.set(w.dust, w.logo, w.layers, w.cloud);
    u.uTime.value = performance.now() / 1000;
    u.uSize.value = look.size;
    u.uOpacity.value = look.opacity;
    u.uFocus.value = look.focus;
    u.uDof.value = look.dof;
    u.uPixelRatio.value = renderer.getPixelRatio();
  };

  return {
    points, w, look, count,
    setShape(name, pos) {
      const a = geo.getAttribute(attr(name)) as THREE.BufferAttribute;
      (a.array as Float32Array).set(pos.subarray(0, count * 3));
      a.needsUpdate = true;
    },
  };
}

const attr = (name: ShapeName) => "a" + name[0].toUpperCase() + name.slice(1);

// Shape helpers ------------------------------------------------------------

// A long box of dust: the "space" the camera travels through.
export function dustShape(count: number, box = { x: 46, y: 28, z0: 40, z1: -230 }) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() * 2 - 1) * box.x;
    pos[i * 3 + 1] = (Math.random() * 2 - 1) * box.y;
    pos[i * 3 + 2] = box.z0 + Math.random() * (box.z1 - box.z0);
  }
  return pos;
}

// Gaussian blobs around cluster centers: the embedding space.
export function cloudShape(count: number, centers: THREE.Vector3[], spread: number, noise = 0.12) {
  const pos = new Float32Array(count * 3);
  const g = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  for (let i = 0; i < count; i++) {
    const loose = Math.random() < noise; // a few stragglers between clusters
    const c = centers[i % centers.length];
    const r = loose ? spread * 4 : spread;
    pos[i * 3] = c.x + g() * r;
    pos[i * 3 + 1] = c.y + g() * r;
    pos[i * 3 + 2] = c.z + g() * r;
  }
  return pos;
}
