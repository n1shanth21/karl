import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// The one three.js world every scene lives in, plus the 1920x1080 text stage on top.
// Scenes never create renderers or cameras; they add objects here and tween them.

export const W = 1920;
export const H = 1080;
export const COLORS = {
  blue: new THREE.Color("#4B9CD3"),
  deep: new THREE.Color("#2F7DB5"),
  navy: new THREE.Color("#0F1B2D"),
  white: new THREE.Color("#FFFFFF"),
  ok: new THREE.Color("#5BE08F"),
  block: new THREE.Color("#FF6B6B"),
};

type Ticker = (time: number, dt: number) => void;

export interface World {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  look: THREE.Vector3; // the camera always looks here; tween it like any other value
  stage: HTMLElement;
  renderer: THREE.WebGLRenderer;
  bloom: UnrealBloomPass;
  tick: (fn: Ticker) => void; // ambient motion that runs every frame (drift, spin)
  quality: "high" | "low";
  setQuality: (q: "high" | "low") => void;
}

export function createWorld(): World {
  const canvas = document.getElementById("gl") as HTMLCanvasElement;
  const frame = document.getElementById("frame") as HTMLElement;
  const stage = document.getElementById("stage") as HTMLElement;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.background = COLORS.navy.clone();
  scene.fog = new THREE.FogExp2(COLORS.navy.getHex(), 0.018);

  const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 400);
  camera.position.set(0, 0, 30);
  const look = new THREE.Vector3(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(6, 10, 14);
  scene.add(key);
  const rim = new THREE.PointLight(COLORS.blue.getHex(), 80, 80);
  rim.position.set(-12, -4, 6);
  scene.add(rim);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.55, 0.6, 0.82); // strength, radius, threshold
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const tickers: Ticker[] = [];
  const world: World = {
    scene, camera, look, stage, renderer, bloom,
    tick: (fn) => tickers.push(fn),
    quality: "high",
    setQuality: (q) => {
      world.quality = q;
      bloom.enabled = q === "high";
      resize();
    },
  };

  // Letterbox the frame to 16:9 and scale the text stage to match it.
  function resize() {
    const s = Math.min(window.innerWidth / W, window.innerHeight / H);
    const w = Math.round(W * s);
    const h = Math.round(H * s);
    Object.assign(frame.style, { width: `${w}px`, height: `${h}px`, left: `${(window.innerWidth - w) / 2}px`, top: `${(window.innerHeight - h) / 2}px` });
    stage.style.transform = `scale(${s})`;
    // Cap the drawing buffer so integrated GPUs keep 60 fps: high = up to 1.5x, low = 1x.
    const ratio = Math.min(window.devicePixelRatio, world.quality === "high" ? 1.5 : 1);
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(ratio);
    composer.setSize(w, h);
  }
  window.addEventListener("resize", resize);
  resize();

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    for (const fn of tickers) fn(t, dt);
    camera.lookAt(look);
    composer.render();
  });

  return world;
}
