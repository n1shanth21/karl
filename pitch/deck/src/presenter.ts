import "@fontsource-variable/inter/opsz.css";
import "@fontsource/jetbrains-mono/500.css";
import "./presenter.css";
import { channel, DeckMsg } from "./sync";

// Presenter window: speaker notes, next-scene preview, a talk timer and a 90 s demo
// countdown. Keys pressed here are forwarded to the deck, so a clicker works whichever
// window has focus.

const ch = channel();
const $ = (id: string) => document.getElementById(id)!;
const base = import.meta.env.BASE_URL;
const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (s: number) => `${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}`;

let startedAt = 0; // talk timer starts on the first move past the pre-roll
let demoStartedAt = 0;
let last: Extract<DeckMsg, { type: "state" }> | null = null;

ch.onmessage = (e: MessageEvent<DeckMsg>) => {
  const m = e.data;
  if (m.type !== "state") return;
  if (m.index >= 0 && !startedAt) startedAt = Date.now();
  const cur = m.scenes[m.index];
  const onDemo = cur?.id === "demo";
  if (onDemo && !demoStartedAt) demoStartedAt = Date.now();
  if (!onDemo) demoStartedAt = 0;
  last = m;

  $("where").textContent = m.index < 0 ? `pre-roll · ${m.count} scenes` : `${m.index + 1} / ${m.count}${m.playing ? "  ▶ moving" : ""}${m.demoBackup ? "  · BACKUP VIDEO ON" : ""}`;
  $("title").textContent = cur ? cur.title : "Pre-roll (dark). Press → to start.";
  $("notes").textContent = cur ? cur.notes : "Dust drifts in the dark. First → assembles the logo.";

  const next = m.scenes[m.index + 1];
  const img = $("previewImg") as HTMLImageElement;
  if (next) {
    img.src = `${base}stills/${pad(m.index + 2)}-${next.id}.png`;
    img.style.visibility = "visible";
    img.onerror = () => { img.style.visibility = "hidden"; };
    $("nextTitle").textContent = `${m.index + 2}. ${next.title} · ${next.move}`;
  } else {
    img.style.visibility = "hidden";
    $("nextTitle").textContent = "end of deck";
  }
};

ch.postMessage({ type: "hello" } satisfies DeckMsg);

function send(key: string) {
  ch.postMessage({ type: "key", key } satisfies DeckMsg);
}

window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  send(e.key);
  e.preventDefault();
});
document.querySelectorAll<HTMLButtonElement>("button[data-key]").forEach((b) => b.addEventListener("click", () => send(b.dataset.key!)));
$("timerReset").addEventListener("click", () => { startedAt = last && last.index >= 0 ? Date.now() : 0; });

setInterval(() => {
  const now = new Date();
  $("clock").textContent = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  $("timer").textContent = startedAt ? fmt((Date.now() - startedAt) / 1000) : "0:00";
  const t = $("timer");
  const elapsed = startedAt ? (Date.now() - startedAt) / 1000 : 0;
  t.className = elapsed > 240 ? "over" : elapsed > 210 ? "close" : "";
  if (demoStartedAt) {
    const left = 90 - (Date.now() - demoStartedAt) / 1000;
    $("demoTimer").textContent = left >= 0 ? `demo: ${fmt(left)} left` : `demo: ${fmt(-left)} over`;
    $("demoTimer").className = left < 0 ? "over" : left < 15 ? "close" : "";
  } else $("demoTimer").textContent = "";
}, 250);
