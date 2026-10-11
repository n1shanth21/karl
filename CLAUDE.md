# CLAUDE.md: rules for every Claude Code session in this repo

Read this whole file at the start of every session, then read **your person's file in `team/`**. The SessionStart hook tells you which branch/role this checkout is.

## Who you're working with

A 4-person student team at HackNC (UNC Chapel Hill), building in about 16 hours. They are not TypeScript experts.
- **Plan before coding.** Show a short numbered plan and wait for an OK before writing code for a new task.
- **Small steps.** Build one step, run it, test it, commit it. Never one-shot a whole phase.
- **Explain in plain English** (3–5 sentences) what changed and why after each step.
- **Simple, boring code.** Readability over cleverness. No unnecessary abstractions. Files under ~250 lines.
- If something is ambiguous or a doc contradicts this file, **stop and ask**.
- Deadline: **Sunday 9:30 AM ET Devpost submit** (hard deadline 10:00). **Code freeze Sunday 8:00 AM.**

## The product: Karl

Karl is an iMessage agent: a **campus marketplace for UNC students that lives entirely in text messages.** Users text one number; there is no app.

- **Sell:** text a photo → Karl drafts title / condition / price → seller confirms ("yes" or ❤️ tapback) → listing goes live.
- **Buy:** text "need a mini fridge under $60" → Karl replies with up to 3 matches (photo + title + price) → buyer picks one.
- **Wants (the differentiator):** no match → Karl saves the want and **texts the buyer later when a matching item is listed.**
- **Match:** buyer picks → seller asked "ok to hold it?" → accept = item held for `LIMITS.holdMinutes`.
- **Relay:** buyer and seller **never see each other's number**. Karl forwards messages between their two separate DMs, labeled in bold: `**Maya · mini fridge**\nomw, 5 min`.
- **Meetup + close:** Karl proposes a spot from `MEETUP_SPOTS` + a time; after the meetup asks both "did it happen?"; both yes → sold.
- **Safety:** relayed messages scanned (pay-first, gift cards, links, phone numbers, off-platform pressure); prohibited items refused; `stop` / `help` always work.
- **Dashboard:** public page with live counts + recent listings (first names only) + QR to text Karl.

**Out of scope (pitch as roadmap only):** tickets (UNC bans student-ticket resale), maker shops, ratings, payments, UNC email verification, group chats.

**Persona** (`PERSONA` in `src/config.ts`): friendly UNC upperclassman. Warm, casual, 1–3 sentences, lowercase OK, light humor, never cringe or pushy, max one emoji per message. Never pretends to be human if sincerely asked.

**Money:** Karl never handles payments. People pay each other directly; Karl reminds them to pay only after they have the item.

## Non-negotiable safety rules
- Never reveal a user's phone number, last name, or contact info to another user. Log phones as last 4 digits only (`last4()`).
- Every relayed message goes through `scanRelayMessage()` first.
- Meetups only at `MEETUP_SPOTS`, daytime/well-lit times.
- `stop` → never message that user again until `start`. Karl never messages someone who hasn't texted Karl first.

## Tech stack (single process)
- **Bun + TypeScript.** `bun install`, `bun test`, `bun run check` (typecheck), `bun run dev`.
- **Photon Spectrum** (`spectrum-ts`) for iMessage + terminal provider for local testing.
- **Gemini** (`@google/genai`): `GEMINI_MODEL` for chat/vision/tools, `GEMINI_EMBED_MODEL` for embeddings (768 dims via `outputDimensionality`).
- **Tiger Data** (Postgres + pgvector + Timescale) via the `postgres` npm client. Plain SQL. No ORM.
- **Hono** for `/health`, `/api/stats`, `/photos/:id`.
- **Railway** hosts the server. **Vercel** hosts the dashboard (`web/`, separate Next.js app).
- `DB_MODE=memory` runs everything with an in-memory fake DB (zero setup). `DB_MODE=postgres` uses Tiger Data.

## Architecture and contracts

```
iPhone ⇄ Photon ⇄ src/spectrum (inbound pipeline, send helpers)        [Nishanth]
                     → src/agent (Gemini tool loop, system prompt)       [Nishanth]
                     → src/flows (sell, buy, match, relay, meetup)       [Nishanth]
                          → src/safety (scan, prohibited, rate limit)    [Aarush]
                          → src/matching (embeddings, search, wants)     [Himagna]
                          → src/db (all SQL, memory + postgres)          [Himagna]
src/jobs (every-minute timers) → emit on src/bus.ts → src/agent/notifications sends texts
src/http (Hono) → /api/stats → web/ dashboard                            [Aarush → Aayush]
```

**The contracts every branch builds against (do not change signatures without telling the team):**
- `src/types.ts`: domain types (User, Listing, Want, Match, Stats, ...)
- `src/bus.ts`: events `match_found`, `hold_expired`, `meetup_checkin_due`, `want_expired`
- `src/db/types.ts`: the `Db` interface (every DB function)
- `src/matching/index.ts`: `searchListings`, `onListingActivated`, `onWantCreated`
- `src/safety/index.ts`: `checkProhibited`, `scanRelayMessage`, `allowMessage`
- `src/jobs/index.ts`: `startJobs`, `tick` · `src/http/index.ts`: `startHttp`
- `GET /api/stats` returns `Stats` (sample in `web/mock-stats.json`)

**Agent design rule:** Gemini decides *what the user wants* and calls tools. Tools are plain functions in `src/flows/` that validate input and call `db` / `matching` / `safety`. **Gemini never writes SQL and never sends messages directly**; the agent loop sends replies. **Routing in the relay is plain code, not Gemini.**

**Jobs never send texts.** They update the DB and emit bus events; `src/agent/notifications.ts` sends the texts.

## Photon / Spectrum facts (Stable docs: https://photon.codes/docs/llms.txt)
Read the relevant doc page before using a Spectrum API you haven't used in this repo. Key pages: `spectrum-ts/messages.md`, `spectrum-ts/spaces-and-users.md`, `spectrum-ts/reactions-and-replies.md`, `spectrum-ts/content/attachments.md`, `spectrum-ts/content/polls.md`, `spectrum-ts/providers/imessage/connection-and-routing.md`, `best-practices/imessage-deliverability.md`.
- We're on **Pro = shared lines**: **no group chats** (`space.create([a, b])` throws). All relay is via DMs. Only users in the Photon dashboard **Users** list can be messaged (100 max).
- **Users must text first.** Karl never cold-texts. Max 50 new conversations/line/day, 5,000 sends/day; avoid bursts and broadcasts.
- **One running process per Photon project**, or every text is answered twice. Locally use `MESSAGING_MODE=terminal` or **your own** Photon project. Production (Railway) uses Aarush's project.
- Inbound content types: `text`, `attachment` (`read()` → bytes; iPhone photos are `image/heic`, convert with `heif2jpeg`), `reaction` (`emoji`, `target`), `reply` (`content`, `target` = threaded reply), `poll_option`.
- Bold labels: `space.send(markdown("**Maya · mini fridge**\nomw"))`. Tapbacks: `Emoji.love` etc. Message a user later: `spaceFor(user)` in `src/spectrum/send.ts`.
- Dedupe inbound by `message.id` (retries happen). Debounce bursts ~2 s.

## Git rules (this is how 4 people avoid clashing)

**Branches = roles.** `agent` (Nishanth) · `data` (Himagna) · `backend` (Aarush) · `web` (Aayush). Ownership is in `ownership.json` and **enforced by hooks**:
- A Claude Code hook **blocks Edit/Write on files your branch doesn't own**, and on `main`.
- A git pre-commit hook **blocks commits** containing files your branch doesn't own, or `.env`.
- If a hook blocks you: **do not bypass it** (`--no-verify` is forbidden). Write the needed change under **Requests** in your `team/<name>.md`, tell the user to ping the owner, and work around it with a local temporary version inside your own folder.

**When to commit:** every time a small step works, meaning `bun run check` passes and `bun test` passes. Aim for a commit every 30–60 minutes at least. Never commit broken typecheck.

**What to commit:** only your own files, by explicit path: `git add src/db tests/data team/himagna.md`. **Never `git add -A` or `git add .`.** Never commit `.env`, secrets, `node_modules`, or large binaries (>2 MB).

**Commit message:** `<role>: <what changed>`, e.g. `data: postgres users + listings queries`, `agent: sell flow confirm step`.

**After every commit:** `git push origin <your-branch>`.

**Merge checkpoints (Nishanth runs these):** 8:00 PM · 11:30 PM · 3:00 AM · 6:00 AM.
1. Everyone commits and pushes their branch 5 minutes before.
2. Nishanth: `git switch main && git pull`, then `git merge origin/data`, `origin/backend`, `origin/web`, `origin/agent` one at a time, running `bun run check && bun test` after each. Stop and fix (or revert that merge) if anything fails. `git push origin main`.
3. Everyone: `git pull origin main` into their own branch, then `bun install` if `package.json` changed.

**Shared files** (`src/types.ts`, `src/bus.ts`, `src/config.ts`, `src/index.ts`, `package.json`, `CLAUDE.md`, `PLAN.md`) are Nishanth's. Contract files owned by others (`src/db/types.ts`, `src/matching/index.ts`, `src/safety/index.ts`): the owner may add functions but must not change existing signatures without telling the team. **New npm dependencies:** request them (Nishanth adds them to `package.json`); `web/` has its own `package.json` that Aayush owns.

## Conventions
- Secrets only in `.env` (gitignored). Keep `.env.example` updated with names, never values. Never ask the user to paste secrets into chat.
- Log every inbound message, tool call and outbound message with phone masked to last 4.
- Money in integer cents. Times as `Date`/timestamptz, displayed in America/New_York.
- Tests: `tests/<role>/*.test.ts`, run with `bun test`. `tests/setup.ts` (preloaded) forces the memory DB, terminal mode and NO real Gemini key, so `bun test` is safe even with a production `.env`. Postgres data tests: `TEST_DB=postgres DB_MODE=postgres bun test tests/data`. Live Gemini test: `RUN_LIVE_GEMINI=1`.
- When you finish a task, tick it in your `team/<name>.md` and commit that file with your work.
