# Aayush: Web & Pitch (branch `web`) · lightest coding, most storytelling

You own everything the judges see that isn't a text message: the live dashboard on the projector, Karl's branding and avatar, the demo seed content, the pitch deck, the Devpost write-up, and the required 2-minute video. **You never wait on anyone:** the dashboard runs on mock data until the real API is live.

**You own:** `web/` (its own Next.js app and `package.json`), `pitch/`, `seed/`, `team/aayush.md`.
**Contract:** `GET /api/stats` returns the `Stats` type in `src/types.ts`; `web/mock-stats.json` is a sample of exactly that shape.

## Phase W1: dashboard on mock data · 5:30–8:30 PM
- [ ] Next.js app in `web/` (run it on port 3001), deployed to Vercel
- [ ] One page, projector + phone friendly: big counters (listed, sold, $ traded, students using Karl), a live feed of recent listings (photo, title, price, first name), a **"Text Karl"** block with the number + a QR code that opens `sms:<number>&body=hi%20karl`
- [ ] Polls `NEXT_PUBLIC_API_URL/api/stats` every 5 s; falls back to `mock-stats.json` when unset or failing
- [ ] Carolina blue accents; looks good on a dark projector
**Finish line:** a public Vercel URL.

## Phase W2: brand + seed content · 8:30–11:30 PM
- [ ] Karl's avatar (square PNG) + display name → give to Aarush for the Photon profile
- [ ] `seed/seed-data.json`: ~25 realistic UNC listings (mini fridges, real course textbooks like CHEM 101 / MATH 231, desk lamps, a futon, a bike, a rug, a monitor, Carolina gear). Fields match `ListingDraft` + `sellerFirstName` + `photo` (file in `seed/photos/`, JPEG < 300 KB each). No tickets.
- [ ] Also ~8 seed **wants** ("need a bike lock", "monitor under $80") so proactive matches happen in the demo
**Finish line:** Himagna's seed script loads it.

## Phase W3: real data + pitch · 11:30 PM–3:00 AM
- [ ] Point `NEXT_PUBLIC_API_URL` at the Railway URL; counters animate on change; a "listings per hour" sparkline from `listingsPerHour`
- [ ] Pitch deck (5–6 slides): problem → Karl in one line → live demo → why iMessage (no app, Karl texts *you*) → tech (Photon Spectrum, Gemini, Tiger Data) → traction from HackNC numbers → roadmap (UNC email verify, move-out week, tickets once policy allows)
- [ ] Devpost draft: what it does, how we built it, challenges (no group chats on Pro → masked relay), what's next. Tracks: General, Photon, Gemini, Tiger Data, .Tech domain.

## Phase WX · 3:00–8:00 AM
- [ ] `pitch/persona-notes.md`: read real transcripts with Nishanth and note anything robotic, long or cringe
- [ ] 6–8 AM: record the **required 2-minute demo video** (two phones + dashboard), upload, add to Devpost
- [ ] 9:30 AM: Devpost submitted (not 9:59)

## Starter prompt (paste after `/clear`)
```
Read CLAUDE.md and team/aayush.md. I'm Aayush on the web branch. We're doing Phase W1.
Only edit web/. Read src/types.ts (the Stats type) and web/mock-stats.json first. Show me a plan and wait.
```

## Requests (things I need from others)
- **Aarush:** set `DASHBOARD_ORIGIN` on Railway to the exact Vercel URL (CORS on `/api/stats` only allows that + localhost:3001), or the dashboard stays on demo data.
- **Aarush / Himagna:** set `PUBLIC_BASE_URL` on Railway (photo URLs default to localhost:3000). Dashboard also accepts relative `/photos/:id`.
- **Himagna:** confirm `getStats` exists in `src/db/postgres.ts`; `listingsPerHour` is `[]` in memory mode (sparkline shows "Not enough data yet").
- **Aarush:** Karl's production iMessage number → I set `NEXT_PUBLIC_KARL_NUMBER` in Vercel.
- **Nishanth:** PLAN.md demo hook says "a hundred GroupMe chats" (unsourced); pitch now says "a dozen group chats".
