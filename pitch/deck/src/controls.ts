import { Director } from "./director";
import { World } from "./world";

// Keyboard + presentation clicker. Clickers send PageDown/PageUp (some send arrows),
// and their "blank screen" button sends "b" or ".".
//
//   → ↓ space PageDown Enter   next
//   ← ↑ PageUp Backspace       back
//   S                          skip the running transition to its end
//   B or .                     black screen on/off
//   1–9, 0                     jump to scene 1–9 or 10 (G then two digits for 11+)
//   Home                       back to the dark pre-roll
//   F                          fullscreen
//   Q                          quality high/low (low = no bloom, 1x pixels)
//   H                          help + fps overlay

export function bindControls(d: Director, w: World, extra: Record<string, () => void> = {}) {
  const black = document.getElementById("black") as HTMLElement;
  const hud = document.getElementById("hud") as HTMLElement;
  let showHud = false;
  let pendingG = "";

  const go: Record<string, () => void> = {
    ArrowRight: () => d.next(), ArrowDown: () => d.next(), " ": () => d.next(), PageDown: () => d.next(), Enter: () => d.next(),
    ArrowLeft: () => d.back(), ArrowUp: () => d.back(), PageUp: () => d.back(), Backspace: () => d.back(),
    s: () => d.skip(),
    b: () => black.classList.toggle("on"), ".": () => black.classList.toggle("on"),
    Home: () => d.jump(-1),
    f: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()),
    q: () => w.setQuality(w.quality === "high" ? "low" : "high"),
    h: () => { showHud = !showHud; hud.style.display = showHud ? "block" : "none"; },
    ...extra,
  };

  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (pendingG !== "" || key === "g") {
      // "g" then two digits: jump to scenes past 9.
      if (key === "g") pendingG = "g";
      else if (/^\d$/.test(key)) {
        pendingG += key;
        if (pendingG.length === 3) { d.jump(Number(pendingG.slice(1)) - 1); pendingG = ""; }
      } else pendingG = "";
      e.preventDefault();
      return;
    }
    if (/^\d$/.test(key)) {
      d.jump((key === "0" ? 10 : Number(key)) - 1);
      e.preventDefault();
      return;
    }
    const fn = go[key];
    if (fn) { fn(); e.preventDefault(); }
  });

  // Help + fps overlay.
  hud.style.display = "none";
  let frames = 0, last = performance.now(), fps = 0;
  const loop = () => {
    frames++;
    const now = performance.now();
    if (now - last > 500) { fps = Math.round((frames * 1000) / (now - last)); frames = 0; last = now; }
    if (showHud) {
      const s = d.state();
      const name = s.index < 0 ? "pre-roll" : `${s.index + 1}/${s.count} ${d.scenes[s.index].title}`;
      hud.textContent = `${fps} fps · ${w.quality} · ${name}${s.playing ? " ▶" : ""}\n→ next  ← back  S skip  B black  1-9 jump  F full  Q quality  P presenter  D demo backup`;
    }
    requestAnimationFrame(loop);
  };
  loop();
}
