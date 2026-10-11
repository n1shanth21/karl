# Karl pitch deck

`deck.html`: the 7-slide pitch deck (1920×1080 slides, scaled to the window) with speaker notes at the bottom. Open it in a browser. `karl-avatar.png` and `signup-qr.png` (QR to https://karl-production.up.railway.app/signup) sit beside it.

Before presenting: fill the three `[__]` counters on the last slide from the live dashboard (https://karl-dashboard-lac.vercel.app).

Editable version (present, export to PowerPoint/PDF): https://claude.ai/artifact/EYxD5jNKb45aWHeDMbUCCf (owned by Aayush; ask him to share it).

---

# 3D pitch (three.js)

`index.html` + `src/` is the animated three.js pitch: 12 scenes in one continuous 3D world. `deck.html` above stays as a flat backup.

## Before you present (do these in order)

```bash
npm install                 # once
npm run stats               # save the live dashboard numbers (offline fallback)
npm run build               # bundle everything into dist/: fonts, videos, code
npm run preview             # serves the deck at http://localhost:5190
```

1. Open http://localhost:5190 in Chrome on the projector screen, press **F** for fullscreen.
2. Press **P** to open the presenter window; drag it to the laptop screen.
3. Press **H** once to check fps (should read ~60), then **H** again to hide it.
4. Turn Wi-Fi off and reload once to prove it runs offline (traction numbers fall back to the `npm run stats` snapshot).

Open it from localhost, not by double-clicking `index.html`: browsers block the scripts on `file://`.

## Keys (deck or presenter window)

| Key | Does |
|---|---|
| → space PageDown Enter | next (clickers send PageDown) |
| ← PageUp Backspace | back, also mid-transition |
| S | skip the running transition to its end |
| B or . | black screen on/off |
| 1–9, 0 | jump to scene 1–10 · G + two digits for 11/12 · Home = dark start |
| D | on the demo scene: play the recorded demo backup on the phone (again = QR) |
| P | presenter window (notes, next-scene preview, timer, 90 s demo countdown) |
| F · Q · H | fullscreen · quality high/low · fps + help |

## The 12 scenes

| # | Scene | Transition into it |
|---|---|---|
| 1 | Cold open: logo + tagline | particles assemble into the 3D mark |
| 2 | The problem | logo dissolves, camera flies through buried group-chat posts |
| 3 | Karl in one line | gravity well pulls every post into one iMessage bubble |
| 4 | Want → match | timeline draws, a day passes, listing drops, line snaps, phone buzzes |
| 5 | Live demo (~90 s) | camera flies into the phone; the screen becomes the sign-up QR |
| 6 | Masked relay | camera orbits out to buyer · Karl · seller; the number scrambles away |
| 7 | Safety | push-in, scan rings pulse, pay-first warned, a phone number shatters |
| 8 | How it's built | exploded view of the stack, modules orbit the server |
| 9 | Meaning, not keywords | the stack dissolves into an embedding cloud, focus pulls onto the fridge cluster |
| 10 | Traction (live numbers) | camera cranes up, light beams rise, counters count up |
| 11 | What's next | a road of light draws into the distance, milestones light up |
| 12 | Close: Text Karl + QR | everything collapses, camera flies home, dust implodes into the logo |

## If something goes wrong

- **Live demo stalls:** press **D** on scene 5 to play the recorded flow on the phone.
- **The machine can't run WebGL:** open `fallback/karl-pitch.pdf` (one scene per page) or the JPGs next to it.
- **Laggy:** press **Q** for low quality (no bloom, 1x pixels).
- **Lost your place:** press the scene number to jump; every jump lands on that scene's exact end state.

## Maintenance scripts

```bash
npm run export    # re-render fallback/ (PDF + JPGs) and public/stills/ (presenter previews)
npm run navtest   # headless check that forward/back/skip/jump always land on identical states
npm run check     # typecheck
```

iMessage clips come from `pitch/remotion` (`npm run render` there writes into `public/videos/`).

**How it works:** `src/world.ts` is the one three.js world (camera, lights, bloom). Each scene in `src/scenes/` creates its objects once and adds a GSAP timeline for the transition into it. `src/director.ts` plays timelines forward, reverses them to go back, and rewinds + fast-forwards to jump. Values that drive the world are setters (`param()` in `src/lib/motion.ts`), so rewinds can never leave anything out of sync.
