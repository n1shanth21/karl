// Renders every iMessage clip to an MP4 the 3D deck plays on its phone screens.
// Usage: npm run render            (all clips)
//        npm run render MatchPing  (one clip)
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const ALL = ["WantSaved", "SellDraft", "MatchPing", "MaskedRelay", "SafetyWarning", "DemoBackup"];
const OUT = "../deck/public/videos";
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ALL;

mkdirSync(OUT, { recursive: true });
for (const id of ids) {
  console.log(`rendering ${id} ...`);
  execFileSync(
    "npx",
    ["remotion", "render", "src/index.ts", id, `${OUT}/${id}.mp4`, "--codec=h264", "--crf=20", "--log=error"],
    { stdio: "inherit" },
  );
}
console.log(`done: ${ids.length} clip(s) in ${OUT}`);
