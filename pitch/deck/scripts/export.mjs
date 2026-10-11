// Fallback deck: renders every scene's end state to an image and a PDF, in case the
// presenting machine can't run WebGL. Also feeds the presenter view's "next" previews.
//
//   npm run export
//
// Builds the deck, serves it locally, opens it in headless Chrome at 1920x1080, jumps to
// each scene, and saves:
//   public/stills/NN-<scene>.jpg   (bundled with the deck; presenter previews)
//   fallback/karl-pitch.pdf        (one scene per page)
//   fallback/NN-<scene>.jpg
import { execSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const PORT = 5199;
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}. Set CHROME_PATH.`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync("public/stills", { recursive: true });
mkdirSync("fallback", { recursive: true });

console.log("building…");
execSync("npx vite build --logLevel error", { stdio: "inherit" });
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
await sleep(2000);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--ignore-gpu-blocklist", "--enable-gpu", "--autoplay-policy=no-user-gesture-required", "--hide-scrollbars"],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});

try {
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => window.deck !== undefined, { timeout: 20000 });
  const scenes = await page.evaluate(() => window.deck.scenes.map((s) => s.id));
  const files = [];
  for (let i = 0; i < scenes.length; i++) {
    await page.evaluate((k) => window.deck.jump(k), i);
    await sleep(1800); // let videos seek to their last frame and textures upload
    const name = `${String(i + 1).padStart(2, "0")}-${scenes[i]}.jpg`;
    await page.screenshot({ path: `public/stills/${name}`, type: "jpeg", quality: 90 });
    copyFileSync(`public/stills/${name}`, `fallback/${name}`);
    files.push(name);
    console.log(`  ${name}`);
  }

  // One image per 1920x1080 page.
  const imgs = files
    .map((f) => `<img src="data:image/jpeg;base64,${readFileSync(`fallback/${f}`).toString("base64")}">`)
    .join("");
  const pdfPage = await browser.newPage();
  await pdfPage.setContent(
    `<style>@page{size:1920px 1080px;margin:0}body{margin:0}img{display:block;width:1920px;height:1080px;page-break-after:always}</style>${imgs}`,
    { waitUntil: "load" },
  );
  await pdfPage.pdf({ path: "fallback/karl-pitch.pdf", width: "1920px", height: "1080px", printBackground: true });
  writeFileSync("fallback/README.md", "Fallback deck: one image per scene end state, plus karl-pitch.pdf. Regenerate with `npm run export` in pitch/deck.\n");
  console.log("done: public/stills/ and fallback/karl-pitch.pdf");
} finally {
  await browser.close();
  server.kill();
}
