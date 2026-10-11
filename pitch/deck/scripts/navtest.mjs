// Navigation regression test, run in headless Chrome:
//   npm run navtest
// For every scene, the end state reached by playing forward, by mashing back, by turning
// around mid-transition, or by jumping must be identical. Exits 1 on any mismatch.
import { execSync, spawn } from "node:child_process";
import puppeteer from "puppeteer-core";

const PORT = 5198;
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

execSync("npx vite build --logLevel error", { stdio: "inherit" });
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
await sleep(2000);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"], defaultViewport: { width: 1280, height: 720 } });

try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("page error:", e.message));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => window.deck !== undefined, { timeout: 20000 });

  const result = await page.evaluate(async () => {
    const d = window.deck, w = d.w;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const r = (v) => Math.round(v * 10) / 10;
    // Fingerprint of everything visible. Ambient motion (bobbing cards, orbiting chips) is ignored.
    const snap = () => {
      const parts = [w.camera.position.toArray().map(r).join(","), w.look.toArray().map(r).join(",")];
      w.scene.traverse((o) => {
        if (!o.isMesh && !o.isPoints) return;
        let vis = o.visible && o.material?.visible !== false;
        for (let p = o.parent; p && vis; p = p.parent) vis = p.visible;
        if (!vis) return parts.push("h");
        if (o.userData.ambient) return parts.push("a");
        const y = o.userData.card && o.userData.free !== false ? 0 : o.position.y; // free cards bob
        parts.push([o.position.x, y, o.position.z].map(r).join(",") + "|" + r(o.scale.x) + "|" + (o.material && "opacity" in o.material ? r(o.material.opacity) : ""));
      });
      parts.push([...document.querySelectorAll("#stage .t")].map((e) => getComputedStyle(e).visibility[0]).join(""));
      return parts.join(";");
    };
    const N = d.scenes.length;
    const ref = [];
    for (let k = -1; k < N; k++) { d.jump(k); ref.push(snap()); }
    const fails = [];
    const check = (label, k) => { const s = snap(); if (s !== ref[k + 1]) fails.push(`${label} (scene ${k + 1})`); };

    d.jump(-1);
    for (let k = 0; k < N; k++) { d.next(); d.skip(); check("forward+skip", k); }
    for (let k = N - 1; k >= 0; k--) { d.back(); await sleep(150); }
    await sleep(4000);
    check("mash back to start", -1);
    for (let k = 1; k < N; k++) { d.jump(k - 1); d.next(); await sleep(600); d.back(); await sleep(250); d.next(); d.skip(); check("turn around mid-transition", k); }
    for (const k of [9, 2, 11, 0, 6, 3, -1, 7, 4, 10]) { d.jump(k); check("jump", k); }
    d.jump(-1); d.next(); await sleep(6000); check("play scene 1 in real time", 0);
    return { N, fails };
  });
  console.log(`${result.N} scenes · ${result.fails.length ? "FAILED: " + result.fails.join(", ") : "all navigation checks passed"}`);
  process.exitCode = result.fails.length ? 1 : 0;
} finally {
  await browser.close();
  server.kill();
}
