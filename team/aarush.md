# Aarush: Backend & Safety (branch `backend`) · 3rd hardest role

You keep Karl safe and running: the scam and prohibited-item checks, the every-minute timers, the HTTP server for the dashboard and photos, and the Railway deployment that keeps Karl live all night. **Production Photon project = Nishanth's NEW project** (keys only in Railway Variables; my old project is retired).

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
| M7 | 12:30 AM | **Karl live on Railway** (B3) with Nishanth's new Photon project | `/health` OK on the Railway URL; a real text gets a reply that shows in Railway logs |
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
- [x] Railway: deploy `main`, start command `bun src/index.ts`, env vars from `.env.example` (`MESSAGING_MODE=imessage`, `DB_MODE=postgres`, Photon creds from Nishanth's new project, `PUBLIC_BASE_URL` = Railway URL, `DASHBOARD_ORIGIN` = Vercel URL)
- [x] `/health` OK; text the line, confirm the reply comes from Railway logs
- [ ] **Nobody runs iMessage mode with the production Photon keys from a laptop** (Nishanth uses a separate project for local tests)
- [x] Railway `DB_MODE=memory` until `origin/data` (Himagna's postgres code) is merged to `main`, then switch to `postgres`. Tiger tables already exist (checked 2026-10-10)
- [x] `backfillEmbeddings()` every 5 min (postgres mode), overlap-guarded, never throws (Himagna request)
- [x] `railway.json`: start command, `/health` healthcheck, restart on failure, no deploy overlap (avoids double replies)
- [x] `/signup` page + `POST /api/signup`: Spectrum API create shared user → shows that person's own Karl number (`assignedPhoneNumber`). 5/IP/hour; optional `SIGNUP_CODE` env. Dashboard QR should point at `https://karl-production.up.railway.app/signup`
- [ ] Post the number in the HackNC Discord ("sell your extra swag, snacks, chargers to other hackers")

## Phase BX · 1:00–8:00 AM
- [ ] Watch Railway logs for errors; report bugs to the owner with the exact log line
- [x] `GET /api/activity` (first names only, scrubbed titles) for Aayush's live pipeline view
- [x] Harden `/api/stats` (cache 3 s), make sure no phone or last name ever appears in any response

## Starter prompt (paste after `/clear`)
```
Read CLAUDE.md and team/aarush.md. I'm Aarush on the backend branch. We're doing Phase B1 step 1 only.
Read src/safety/index.ts and src/types.ts first. Show me a numbered plan and wait.
```

## Requests (things I need from others)
- ~~**Nishanth (PLAN.md):** access-test result is already known from my Photon project (tested 2026-10-10). Registered phone → reply works. Unregistered phone → Photon auto-replies "didn't recognize your number"; nothing reaches our code. Also, each user is assigned **their own** line ("Texts on" in Photon → Users), so there's no single Karl number for the dashboard QR or a Discord post. Please record this and decide: add people by hand (max 100 users), or I build `POST /signup` in B3.~~ Done: `/signup` is live.
- **Himagna:** I already have a Tiger Data service (pgvector 0.8.7 verified). I'll DM you the `DATABASE_URL` so we use one database instead of two.
- **Nishanth (HANDOFF, two fixes in your files):** paste this into Claude Code on the `agent` branch:
  ```
  Read CLAUDE.md and team/nishanth.md. I'm Nishanth on the agent branch.
  Two fixes from Aarush (backend). Show me a numbered plan first and wait for my OK.

  FIX 1: production bug, one slow Gemini response kills the turn.
  Prod log 2026-10-10 19:52:22 EDT: "[agent] turn failed: DOMException" = the 20 s abort fired.
  Aayush replied with his name during onboarding and got FALLBACK. The same conversation works
  locally in ~3 s (memory AND postgres), so it's a latency spike, not a logic bug.
  - src/agent/gemini.ts chat(): move the generateContent call into chatOnce(req), then
      async function chat(req) {
        try { return await chatOnce(req); }
        catch (err) {
          const e = err as { name?: string; status?: number };
          const retryable = e?.name === "TimeoutError" || e?.name === "AbortError" || [429, 500, 503].includes(Number(e?.status));
          if (!retryable) throw err;
          console.warn(`[gemini] chat retry after ${e?.name ?? e?.status}`);
          return chatOnce(req); // fresh AbortSignal.timeout inside chatOnce
        }
      }
  - src/agent/loop.ts:50: log one readable line so Railway search shows the reason:
      console.error("[agent] turn failed:", err instanceof Error ? `${err.name}: ${err.message}` : err);
  - Test with the fake Gemini: first chat call throws a TimeoutError, second succeeds -> normal reply;
    a non-retryable error still gives FALLBACK; never more than 2 attempts.

  FIX 2: photo safety is not wired (checkImage / isBanned are on main but nothing calls them).
    isBanned(userId: string): boolean            // explicit-photo ban, in-memory
    checkImage(bytes, mimeType, userId): Promise<{ action: "allow" | "block"; reason?: string; banned: boolean }>
      // explicit -> block AND bans the user itself; suggestive/Gemini failed -> block, no ban
  In src/spectrum/inbound.ts:
  1. Right after getOrCreateUser() + the spaceId update, BEFORE db.saveInbound, optedOut/start/
     stop/help and allowMessage:
       if (isBanned(user.id)) { console.log(`[karl] banned ${last4(phone)}`); return; }
     No reply, no Gemini. "start" must NOT undo a ban.
  2. In draftPhoto(), before draftFromPhoto (so before HEIC conversion, savePhoto, vision):
       const bytes = await photo!.read();
       const v = await checkImage(bytes, photo!.mimeType, user.id);
       if (v.action === "block") { await sendTo(user, v.reason!); return; }
     then pass the same bytes to draftFromPhoto. checkImage reads HEIC directly.
  3. If v.banned: for each db.activeMatchesForUser(user.id) set status "cancelled", put a "held"
     listing back to "active", and text the OTHER person something neutral like "heads up, this one
     fell through. want me to keep looking?" Never say why or reveal anything about the banned user.
  Tests in tests/agent (mock src/safety): banned user gets no reply and nothing saved; blocked photo
  -> sender gets v.reason, savePhoto/draftFromPhoto never called; allowed photo drafts as before;
  explicit photo with an active match -> cancelled, listing active, other person told once.

  Then bun run check && bun test, commit, push, and merge origin/backend + origin/agent into main.
  ```
