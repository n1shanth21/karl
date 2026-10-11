// Renders every iMessage clip to an MP4 the 3D deck plays on its phone screens.
// Usage: npm run render            (all clips)
//        npm run render MatchPing  (one clip)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

const ALL = ["WantSaved", "SellDraft", "MatchPing", "MaskedRelay", "Negotiation", "SafetyWarning", "DemoBackup"];
const OUT = "../deck/public/videos";
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
// Remotion's bundled headless shell can crash on some Macs ("Target closed"); use installed Chrome if present.
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = existsSync(CHROME) ? [`--browser-executable=${CHROME}`] : [];

mkdirSync(OUT, { recursive: true });
for (const id of ids) {
  console.log(`rendering ${id} ...`);
  execFileSync(
    "npx",
    ["remotion", "render", "src/index.ts", id, `${OUT}/${id}.mp4`, "--codec=h264", "--crf=20", "--log=error", ...browser],
    { stdio: "inherit" },
  );
}
console.log(`done: ${ids.length} clip(s) in ${OUT}`);
