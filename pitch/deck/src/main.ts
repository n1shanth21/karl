import "./styles.css";
import { createWorld } from "./world";
import { Director } from "./director";
import { bindControls } from "./controls";
import { createProps } from "./props";
import { SCENES } from "./scenes";
import { loadStats } from "./stats";
import { isDemoBackupOn, resetDemoBackup, toggleDemoBackup } from "./scenes/s05-demo";
import { channel, DeckMsg } from "./sync";
import { clip } from "./lib/phone";

// Canvas labels need the bundled font loaded before they are drawn.
// Live stats are fetched at the same time (2.5 s max, then the offline snapshot).
await Promise.all([...[500, 600, 700].map((wt) => document.fonts.load(`${wt} 40px "Inter Variable"`)), loadStats()]);

// Start loading every phone clip now, so a clip that first plays mid-scene is already buffered.
for (const name of ["SellDraft", "WantSaved", "MatchPing", "DemoBackup", "MaskedRelay", "Negotiation", "SafetyWarning"]) clip(name);

const world = createWorld();
createProps(world);
const director = new Director(world, SCENES);
const demoIndex = SCENES.findIndex((s) => s.id === "demo");
const ch = channel();
const broadcast = () => {
  const s = director.state();
  const scenes = SCENES.map(({ id, title, notes, move }) => ({ id, title, notes, move }));
  ch.postMessage({ type: "state", ...s, scenes, demoBackup: isDemoBackupOn() } satisfies DeckMsg);
};
const handleKey = bindControls(director, world, {
  d: () => { toggleDemoBackup(director.index === demoIndex); broadcast(); },
  p: () => window.open("presenter.html", "karl-presenter", "width=1280,height=800"),
});
director.onChange((s) => {
  if (s.index !== demoIndex) resetDemoBackup();
  broadcast();
});
ch.onmessage = (e: MessageEvent<DeckMsg>) => {
  if (e.data.type === "hello") broadcast();
  if (e.data.type === "key") handleKey(e.data.key);
};

// Handy in the browser console while building scenes: deck.jump(3), deck.next() ...
(window as unknown as { deck: Director }).deck = director;
