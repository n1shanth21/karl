# Aarush: Backend & Safety (branch `backend`) · 3rd hardest role

You keep Karl safe and running: the scam and prohibited-item checks, the every-minute timers, the HTTP server for the dashboard and photos, and the Railway deployment that keeps Karl live all night. **Your Photon project is production.**

**You own:** `src/safety/`, `src/jobs/`, `src/http/`, `tests/backend/`, `railway.json`, `team/aarush.md`.
**Contract you implement:** `src/safety/index.ts` (`checkProhibited`, `scanRelayMessage`, `allowMessage`), `src/jobs/index.ts` (`tick`, `startJobs`), `src/http/index.ts` (`startHttp`). Keep the signatures.
**Rule:** jobs never send texts. They update the DB and `bus.emit(...)`; the agent sends the messages.

## Milestones (check off as you go; each one ends with `bun run check && bun test` passing, a commit, and a push)

| # | Done by | Milestone | Proof it's done |
|---|---|---|---|
| M0 | 5:30 PM | Laptop ready: repo cloned, `bun run setup`, `.env` filled, on `backend` branch | `bun tools/guard.ts whoami` says BACKEND; `bun run dev` → type "hi" → Karl replies |
| M1 | 6:30 PM | `scanRelayMessage` catches blocks (numbers, emails, handles, links, gift cards, wire/crypto) and warns (pay first, deposit, pressure) | `tests/backend/safety.test.ts` has 15+ scam and 15+ normal messages, all pass |
| M2 | 7:15 PM | `checkProhibited` (incl. tickets) + `allowMessage` rate limit | tests for each pass |
| M3 | 7:55 PM | **Safety done → ready for Merge #1** | pushed to `origin/backend`; told Nishanth in chat |
| M4 | 9:30 PM | `tick`: expired holds → match `expired`, listing `active`, `hold_expired` emitted | `tests/backend/jobs.test.ts` with a fake `now` |
| M5 | 11:00 PM | `tick`: meetup check-ins fire **exactly once** per match + want expiry → `want_expired` | test runs `tick` twice and sees one event |
| M6 | 11:25 PM | **Timers done → ready for Merge #2** | pushed; told Nishanth |
| M7 | 12:30 AM | **Karl live on Railway** (B3) with my Photon project | `/health` OK on the Railway URL; a real text gets a reply that shows in Railway logs |
| M8 | 1:00 AM | Testers' and judges' phones added under Photon → Users; Aayush has the Railway URL | Aayush's dashboard shows real numbers |
| M9 | 3:00 AM | `/api/stats` cached 3 s; a test proves no phone number or last name appears in any response | test passes; pushed for Merge #3 |
| M10 | 6:00 AM | Railway logs clean for the demo path; pushed for the final merge | no errors in the last hour of logs |

## Setup (once)
- app.photon.codes → Pro with promo **HACKWITHPHOTON** → add an iMessage line → add the team's phones under **Users** → Project ID + Secret into `.env`
- railway.app account, connected to the GitHub repo

## Phase B1: safety · 5:30–8:00 PM
- [x] `scanRelayMessage(text)`: fast regex rules first. **block**: phone numbers, emails, social handles (@…, "my insta"), URLs, gift cards, wire/crypto. **warn**: pay first, deposit, "venmo me now", "send half upfront", pressure ("only today", "text me on whatsapp"). The reason is in Karl's voice and shown to the user. Gemini only for borderline cases (optional).
- [x] `checkProhibited(draft)`: alcohol, drugs, vapes, meds, weapons, tickets (UNC bans student-ticket resale), digital accounts/licenses, counterfeit → block with a friendly reason
- [x] `checkImage(bytes, mimeType, userId)`: Gemini labels every inbound photo. explicit → block + ban sender; suggestive or check failed → block photo only. `isBanned(userId)`: in-memory ban list (restart clears it)
- [x] `allowMessage(userId)`: max `LIMITS.rateLimitMessagesPer10Min` per user (in-memory sliding window)
- [x] `tests/backend/safety.test.ts`: ≥15 scam messages + ≥15 normal ones ("omw", "running 5 late", "can we do the Pit instead", "is it still available", "$40 ok?"). **Normal messages must never be blocked.**
**Finish line:** tests pass; tell Nishanth in chat it's merged-ready.

## Phase B2: timers · 8:00–11:30 PM
- [x] `tick(now)`: (1) `db.matchesWithExpiredHold(now)` → match `expired`, listing back to `active`, emit `hold_expired`; (2) `db.matchesDueForCheckin(now - delay)` → emit `meetup_checkin_due` **once per match** (track it, e.g. a Set or a match status change); (3) `db.openWantsExpiredBefore(now)` → `closed`, emit `want_expired`
- [x] `tests/backend/jobs.test.ts` with the memory DB and a fake `now`
**Finish line:** a test proves each event fires exactly once.

## Phase B3: deploy · 11:30 PM–1:00 AM (right after the 11:30 merge)
- [ ] Railway: deploy `main`, start command `bun src/index.ts`, env vars from `.env.example` (`MESSAGING_MODE=imessage`, `DB_MODE=postgres`, your Photon creds, `PUBLIC_BASE_URL` = Railway URL, `DASHBOARD_ORIGIN` = Vercel URL)
- [ ] `/health` OK; text the line, confirm the reply comes from Railway logs
- [ ] **From now on nobody runs iMessage mode on your Photon project from a laptop**
- [ ] If the access test showed unregistered phones can't text in: `POST /signup` (phone → Photon Dashboard API adds them to Users) and tell Aayush to link it
- [ ] Post the number in the HackNC Discord ("sell your extra swag, snacks, chargers to other hackers")

## Phase BX · 1:00–8:00 AM
- [ ] Watch Railway logs for errors; report bugs to the owner with the exact log line
- [ ] Harden `/api/stats` (cache 3 s), make sure no phone or last name ever appears in any response

## Starter prompt (paste after `/clear`)
```
Read CLAUDE.md and team/aarush.md. I'm Aarush on the backend branch. We're doing Phase B1 step 1 only.
Read src/safety/index.ts and src/types.ts first. Show me a numbered plan and wait.
```

## Requests (things I need from others)
- **Nishanth (PLAN.md):** access-test result is already known from my Photon project (tested 2026-10-10). Registered phone → reply works. Unregistered phone → Photon auto-replies "didn't recognize your number"; nothing reaches our code. Also, each user is assigned **their own** line ("Texts on" in Photon → Users), so there's no single Karl number for the dashboard QR or a Discord post. Please record this and decide: add people by hand (max 100 users), or I build `POST /signup` in B3.
- **Himagna:** I already have a Tiger Data service (pgvector 0.8.7 verified). I'll DM you the `DATABASE_URL` so we use one database instead of two.
- **Nishanth (after Merge #1):** wire in `isBanned` + `checkImage`. Paste this into Claude Code on the `agent` branch:
  ```
  Read CLAUDE.md and team/nishanth.md. I'm Nishanth on the agent branch.
  Task: wire Aarush's new image-safety + ban functions into the inbound pipeline and photo handling.
  Show me a numbered plan first and wait for my OK.

  Aarush added these to the safety contract (src/safety/index.ts, already merged to main):

    // true if this user was banned for sending an explicit photo (in-memory, resets on restart)
    isBanned(userId: string): boolean

    // Gemini checks the photo. If explicit (nudity/sexual/gore/hate), it bans the user itself.
    // reason is in Karl's voice; send it to the SENDER only.
    checkImage(bytes: Uint8Array, mimeType: string, userId: string):
      Promise<{ action: "allow" | "block"; reason?: string; banned: boolean }>

  Where to call them:
  1. Inbound pipeline (src/spectrum/inbound.ts): right after we resolve the user from the
     message, if isBanned(user.id) → log it (phone masked with last4) and return.
     No reply, no Gemini call, nothing else. This goes before "stop"/"help" handling too.
  2. Every inbound image attachment, BEFORE db.savePhoto, before Gemini vision drafts a
     listing, and before the relay forwards it to the other person:
       const v = await checkImage(bytes, mimeType, user.id)
       if (v.action === "block") → send v.reason to the sender, do NOT save/draft/forward
       the photo, and stop handling this message.
     Call it on the original bytes (HEIC is fine, Gemini reads it).
  3. If v.banned and the user has an active match, cancel the match, put the listing back
     to active, and tell the other person something neutral like "heads up, this one fell
     through. want me to keep looking?" Never say why or show the banned user's info.

  Tests: mock checkImage/isBanned in tests/agent. Cover: banned user gets no reply;
  blocked photo is never saved or relayed; allowed photo continues normally.
  Then bun run check && bun test, commit, push.
  ```
