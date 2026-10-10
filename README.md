# Karl: the campus marketplace that lives in iMessage

**HackNC 2026 · Photon "Best iMessage Agent" track** (+ General, Gemini, Tiger Data, .Tech)

Karl is a phone number UNC students text to buy and sell used stuff. There's no app and no browsing. Text a photo to sell, or text what you're looking for. Karl remembers what everyone wants and **texts you the moment a match is listed**, then passes messages between buyer and seller so nobody's number is shared.

> Facebook Marketplace makes you search. Karl texts *you* when the thing you want shows up.

---

## What users can do (MVP)

| Feature | In iMessage |
|---|---|
| **Sell** | Send a photo → Karl replies "mini fridge, good condition, $45. post it?" → "yes" or ❤️ → live |
| **Buy** | "need a mini fridge under $60" → up to 3 matches with photos → pick one |
| **Wants** | Nothing yet? Karl saves it and texts you when one is listed, even days later |
| **Match + hold** | Seller is asked "ok to hold it?" → accepted → held for 2 hours |
| **Masked relay** | "omw" arrives on the seller's phone as **Maya · mini fridge** / omw. Numbers never swapped |
| **Meetup + close** | Karl proposes a public campus spot and time; asks both "did it happen?"; marks it sold |
| **Safety** | Flags pay-first / gift card / link / number-sharing; refuses prohibited items; `stop` / `help` |
| **Dashboard** | Live counters + recent listings (first names only) + QR to text Karl |

**Not in the MVP (roadmap):** tickets (UNC bans student-ticket resale), maker shops, ratings, UNC email verification.

## Team and roles

| Role (branch) | Person | Builds | Difficulty |
|---|---|---|---|
| **Agent** (`agent`) | Nishanth | Spectrum pipeline, Gemini tool loop, sell/buy/match/relay/meetup flows, notifications, merges | ★★★★ |
| **Data** (`data`) | Himagna | Tiger Data DB layer, embeddings + vector search, want↔listing matching, stats, seed | ★★★ |
| **Backend & Safety** (`backend`) | Aarush | Scam/prohibited checks, timers, HTTP API, Railway deploy, production Photon line | ★★ |
| **Web & Pitch** (`web`) | Aayush | Dashboard (Vercel), branding, seed content, deck, Devpost, demo video | ★ |

Each person's task list, phases and starter prompt: **`team/<name>.md`**. Timeline and merges: **`PLAN.md`**. Rules for Claude Code: **`CLAUDE.md`**.

## Architecture (one Bun process on Railway)

```
iPhone ⇄ Photon Spectrum ⇄ Karl server (Bun + TypeScript)
                            ├─ spectrum/   inbound pipeline, send helpers        Nishanth
                            ├─ agent/      Gemini tool loop + system prompt      Nishanth
                            ├─ flows/      sell · buy · match · relay · meetup    Nishanth
                            ├─ safety/     scam scan, prohibited, rate limit     Aarush
                            ├─ matching/   embeddings, search, want matching     Himagna
                            ├─ db/         all SQL (memory + Tiger Data)         Himagna
                            ├─ jobs/       timers → bus events                   Aarush
                            └─ http/       /health /api/stats /photos            Aarush
                                               │
                                       web/ dashboard (Next.js, Vercel)       Aayush
```

Branches connect only through **contracts**: `src/types.ts`, `src/bus.ts`, `src/db/types.ts`, `src/matching/index.ts`, `src/safety/index.ts`. Everything runs today with stubs and an in-memory DB, so **nobody is blocked on anyone.**

## Setup (everyone, ~10 minutes)

1. Install **Claude Code**, **Git**, and **Bun** (`curl -fsSL https://bun.sh/install | bash`).
2. Clone and set up:
   ```bash
   git clone https://github.com/n1shanth21/karl.git && cd karl
   bun run setup          # installs deps + turns on the ownership git hook
   cp .env.example .env   # then fill in your own values (never commit .env)
   git switch -c <agent|data|backend|web>   # your role branch (or git switch <branch> if it exists)
   ```
3. Run Karl in your terminal (no phone or keys needed):
   ```bash
   bun run dev
   ```
   Type "hi". Karl answers. `curl localhost:3000/health` works.
4. Open Claude Code in the `karl` folder. It automatically learns your role from your branch and **cannot edit other people's files.** Paste the starter prompt from your `team/<name>.md`.

**Accounts:** Gemini key (aistudio.google.com, one shared key OK) · Photon project with promo **HACKWITHPHOTON** (each person who tests iMessage needs their own project; Aarush's is production) · Tiger Data (Himagna creates one service, shares the URL privately) · Railway (Aarush) · Vercel (Aayush).

## Git rules (short version; full version in CLAUDE.md)

- Work **only on your role branch**. Never commit to `main`; hooks block it.
- Commit **only your own files**, by path (`git add src/db tests/data`). Never `git add -A`.
- Commit every time a small step works (`bun run check && bun test` pass), message `<role>: <what>`, then `git push origin <branch>`.
- **Merges at 8:00 PM · 11:30 PM · 3:00 AM · 6:00 AM** (Nishanth). Then everyone runs `git pull origin main`.
- Need a change in someone else's file? Write it under **Requests** in your `team/<name>.md` and ping them.
