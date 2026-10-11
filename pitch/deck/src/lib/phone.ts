import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

// A stylized phone: dark rounded slab, thin bright edge, and a screen that can show
// a Remotion clip (video texture) or any other texture. No logos, no notch drama.

export const SCREEN_W = 4.6;
export const SCREEN_H = SCREEN_W * (844 / 390); // matches the 390x844 clips

const videos = new Map<string, HTMLVideoElement>();

// One <video> per clip, shared by every phone that shows it. Bundled locally.
export function clip(name: string): HTMLVideoElement {
  let v = videos.get(name);
  if (!v) {
    v = document.createElement("video");
    v.src = `${import.meta.env.BASE_URL}videos/${name}.mp4`;
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.load();
    videos.set(name, v);
  }
  return v;
}

const textures = new Map<string, THREE.VideoTexture>();

export function videoTexture(name: string) {
  let t = textures.get(name);
  if (!t) {
    t = new THREE.VideoTexture(clip(name));
    t.colorSpace = THREE.SRGBColorSpace;
    textures.set(name, t);
  }
  return t;
}

// Restart a clip from the top (or show its last frame when `end` is true, for jumps/back).
export function playClip(name: string, end = false) {
  const v = clip(name);
  if (end) {
    v.pause();
    const seek = () => { v.currentTime = Math.max(0, v.duration - 0.05); };
    if (v.readyState >= 1) seek(); else v.addEventListener("loadedmetadata", seek, { once: true });
    return;
  }
  v.currentTime = 0;
  void v.play().catch(() => {});
}

export type Phone = {
  group: THREE.Group;
  screen: THREE.Mesh; // the video / content plane
  overlay: THREE.Mesh; // a second plane just above the screen, for crossfades
  setScreen: (tex: THREE.Texture | null) => void;
  setOverlay: (tex: THREE.Texture | null) => void;
  overlayFade: { opacity: number };
};

export function createPhone(): Phone {
  const bodyW = SCREEN_W + 0.36, bodyH = SCREEN_H + 0.42, depth = 0.5;
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new RoundedBoxGeometry(bodyW, bodyH, depth, 6, 0.62),
    new THREE.MeshStandardMaterial({ color: 0x1a2433, roughness: 0.32, metalness: 0.75 }),
  );
  group.add(body);

  // Glowing hairline around the glass, Carolina blue.
  const edge = new THREE.Mesh(
    new RoundedBoxGeometry(bodyW + 0.04, bodyH + 0.04, depth * 0.5, 6, 0.64),
    new THREE.MeshBasicMaterial({ color: 0x4b9cd3, transparent: true, opacity: 0.55 }),
  );
  edge.position.z = -0.08;
  group.add(edge);

  const screenGeo = roundedPlane(SCREEN_W, SCREEN_H, 0.5);
  const screenMat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
  const screen = new THREE.Mesh(screenGeo, screenMat);
  screen.position.z = depth / 2 + 0.005;
  group.add(screen);

  // slightly under 1.0 so bright screens don't trip the bloom
  const overlayMat = new THREE.MeshBasicMaterial({ color: 0xd0d0d0, transparent: true, opacity: 0, toneMapped: false, depthWrite: false });
  const overlay = new THREE.Mesh(screenGeo, overlayMat);
  overlay.position.z = depth / 2 + 0.01;
  overlay.visible = false;
  group.add(overlay);

  let o = 0;
  const overlayFade = {
    get opacity() { return o; },
    set opacity(v: number) { o = v; overlayMat.opacity = v; overlay.visible = v > 0.001; },
  };

  return {
    group, screen, overlay, overlayFade,
    setScreen(tex) {
      screenMat.map = tex;
      screenMat.color.set(tex ? 0xd8d8d8 : 0x000000);
      screenMat.needsUpdate = true;
    },
    setOverlay(tex) {
      overlayMat.map = tex;
      overlayMat.needsUpdate = true;
    },
  };
}

// Plane with rounded corners and UVs that span 0..1, for screens.
export function roundedPlane(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  const geo = new THREE.ShapeGeometry(s, 12);
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) - x) / w, (pos.getY(i) - y) / h);
  return geo;
}
