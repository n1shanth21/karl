# Aarush: Backend & Safety (branch `backend`) · 3rd hardest role

You keep Karl safe and running: the scam and prohibited-item checks, the every-minute timers, the HTTP server for the dashboard and photos, and the Railway deployment that keeps Karl live all night. **Your Photon project is production.**

**You own:** `src/safety/`, `src/jobs/`, `src/http/`, `tests/backend/`, `railway.json`, `team/aarush.md`.
**Contract you implement:** `src/safety/index.ts` (`checkProhibited`, `scanRelayMessage`, `allowMessage`), `src/jobs/index.ts` (`tick`, `startJobs`), `src/http/index.ts` (`startHttp`). Keep the signatures.
**Rule:** jobs never send texts. They update the DB and `bus.emit(...)`; the agent sends the messages.

## Setup (once)
- app.photon.codes → Pro with promo **HACKWITHPHOTON** → add an iMessage line → add the team's phones under **Users** → Project ID + Secret into `.env`
- railway.app account, connected to the GitHub repo

## Phase B1: safety · 5:30–8:00 PM
- [ ] `scanRelayMessage(text)`: fast regex rules first. **block**: phone numbers, emails, social handles (@…, "my insta"), URLs, gift cards, wire/crypto. **warn**: pay first, deposit, "venmo me now", "send half upfront", pressure ("only today", "text me on whatsapp"). The reason is in Karl's voice and shown to the user. Gemini only for borderline cases (optional).
- [ ] `checkProhibited(draft)`: alcohol, drugs, vapes, meds, weapons, tickets (UNC bans student-ticket resale), digital accounts/licenses, counterfeit → block with a friendly reason
- [ ] `allowMessage(userId)`: max `LIMITS.rateLimitMessagesPer10Min` per user (in-memory sliding window)
- [ ] `tests/backend/safety.test.ts`: ≥15 scam messages + ≥15 normal ones ("omw", "running 5 late", "can we do the Pit instead", "is it still available", "$40 ok?"). **Normal messages must never be blocked.**
**Finish line:** tests pass; tell Nishanth in chat it's merged-ready.

## Phase B2: timers · 8:00–11:30 PM
- [ ] `tick(now)`: (1) `db.matchesWithExpiredHold(now)` → match `expired`, listing back to `active`, emit `hold_expired`; (2) `db.matchesDueForCheckin(now - delay)` → emit `meetup_checkin_due` **once per match** (track it, e.g. a Set or a match status change); (3) `db.openWantsExpiredBefore(now)` → `closed`, emit `want_expired`
- [ ] `tests/backend/jobs.test.ts` with the memory DB and a fake `now`
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
-
