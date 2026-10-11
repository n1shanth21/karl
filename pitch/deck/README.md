# Karl pitch deck

`deck.html`: the 7-slide pitch deck (1920×1080 slides, scaled to the window) with speaker notes at the bottom. Open it in a browser. `karl-avatar.png` and `signup-qr.png` (QR to https://karl-production.up.railway.app/signup) sit beside it.

Before presenting: fill the three `[__]` counters on the last slide from the live dashboard (https://karl-dashboard-lac.vercel.app).

Editable version (present, export to PowerPoint/PDF): https://claude.ai/artifact/EYxD5jNKb45aWHeDMbUCCf (owned by Aayush; ask him to share it).

---

# 3D pitch (three.js)

`index.html` + `src/` is the animated three.js pitch. `deck.html` above stays as the flat fallback.

```bash
npm install
npm run dev       # http://localhost:5190 while building
npm run build     # bundle everything into dist/ (fonts, videos, code; no internet needed)
npm run preview   # serve dist/ at http://localhost:5190, use this to present
```

Open it from localhost, not by double-clicking `index.html`; browsers block the scripts on `file://`.

**Keys:** → / space / PageDown = next · ← / PageUp = back (works mid-transition) · S = skip to the end of the transition · B or . = black screen · 1–9, 0 = jump to scene 1–10 (G + two digits for 11+) · Home = back to the start · F = fullscreen · Q = quality high/low · H = help + fps.

**How it works:** `src/world.ts` is the one three.js world (camera, lights, bloom). Each scene in `src/scenes/` creates its objects once and adds a GSAP timeline for the transition into it. `src/director.ts` plays timelines forward, reverses them to go back, and rewinds + fast-forwards to jump. Phone clips come from `pitch/remotion` (`npm run render` there writes into `public/videos/`).
