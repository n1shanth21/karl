# Nishanth: Agent (branch `agent`) · hardest role

You build Karl's brain and everything a user experiences in iMessage: the inbound pipeline, the Gemini tool loop, the sell, buy, match, relay and meetup flows, and the texts sent when bus events fire. You also own the shared contracts and run the merges.

**You own:** `src/index.ts`, `src/types.ts`, `src/config.ts`, `src/bus.ts`, `src/spectrum/`, `src/agent/`, `src/flows/`, `tests/agent/`, docs, `package.json`, `tools/`, `.claude/`, `.githooks/`.
**You depend on:** `db` + `matching` (Himagna; memory versions work today), `safety` (Aarush; stubs allow everything today).

## Phase A0: skeleton ✅ (done in setup)
- [x] Contracts: types, bus, config, Db interface, matching/safety/jobs/http stubs, memory DB
- [x] Terminal round-trip: "hey, it's Karl 👋 (setup works)"
- [x] Ownership guard hooks
- [x] **Access test on a real phone:** your Photon project, `MESSAGING_MODE=imessage`, text the line from your phone (in Users), then from a phone NOT in Users. Write the result in PLAN.md.

## Phase A1: inbound pipeline + Gemini brain + sell flow · 5:30–8:00 PM
- [x] Inbound: debounce bursts (2 s per user) and process them together; `stop`/`start`/`help`; call `allowMessage()`
- [x] Onboarding: first text → 2 short intro texts + ask first name → save it
- [x] `src/agent/systemPrompt.ts` (persona from config) + `src/agent/gemini.ts` + tool loop (Gemini picks a tool → run it → Gemini phrases the reply)
- [x] Photo handling: `content.read()` → HEIC→JPEG (`heif2jpeg`) → `db.savePhoto` → Gemini vision → `ListingDraft`
- [x] Tools `create_listing_draft`, `update_draft` (price/condition edits), `confirm_listing` (also accept ❤️ tapback on the draft message) → `checkProhibited` → status `active` → `onListingActivated`
- [x] Max 1 follow-up question, then: "mini fridge, good condition, $45. post it?"
- [x] Tests with mocked Gemini: photo → draft → confirm → active
**Finish line (phone):** text a photo → draft + price → "yes" → listing is `active` (check `/api/stats`).

## Phase A2: buy, wants, match, relay · 8:00–11:30 PM
- [x] `search_listings` → up to 3 results sent as photo + "**title** · $45" → buyer picks (number, name, or ❤️)
- [x] No results → `save_want` → `onWantCreated` → "i'll text you when one shows up"
- [x] `match_found` notification → text buyer the photo + "someone just listed …, want it?"
- [x] `propose_match` → seller asked (❤️ / yes) → `accepted` + `holdExpiresAt`, listing `held` → both told
- [x] Meetup: propose 2 options from `MEETUP_SPOTS` (native poll if it works, else text) → `meetup_set` (text options; native poll not used)
- [x] **Relay** (plain code, not Gemini): 1 active match → relay logistics; several → use threaded reply target, else ask "which one, the fridge or the lamp?"; messages to Karl ("cancel", "list another") handled by Karl. Every relay: `scanRelayMessage()` → `markdown("**Maya · mini fridge**\n…")`
- [x] Two-user test (simulated spaces) of the full loop
**Finish line (two phones):** want saved → listing posted → buyer pinged → accept → "omw" relayed with label → meetup set.

## Phase A3: close-out + robustness · 11:30 PM–3:00 AM
- [x] `meetup_checkin_due` → "did it happen?" to both → both yes → `completed`, listing `sold`, pay-after-pickup reminder
- [x] `hold_expired` → tell both nicely, item back up
- [x] `my stuff` / cancel listing / cancel want
- [x] Gemini error/timeout → friendly fallback + retry; unclear photo → "can you send another angle?"

## Phase AX: polish + demo · 3:00–8:00 AM
- [ ] Persona pass over real transcripts (with Aayush's notes in `pitch/persona-notes.md`)
- [ ] Rehearse the demo on the Railway deployment; fix only demo-path bugs after 6 AM

## Merge duty
Run the checkpoint merges (8:00 PM, 11:30 PM, 3:00 AM, 6:00 AM) per CLAUDE.md. Apply teammates' **Requests** to shared files on `agent`, then merge.

## Starter prompt (paste after `/clear`)
```
Read CLAUDE.md and team/nishanth.md. I'm Nishanth on the agent branch. We're doing Phase A1, step 1 only.
Before coding, read the Photon docs pages listed in CLAUDE.md that this step needs, then show me a numbered plan and wait.
```

## Requests (things I need from others)
- Aarush: safety contract on `backend` (scanRelayMessage, checkProhibited, allowMessage, checkImage, isBanned) arrives at the 8 PM merge — inbound already calls allowMessage/scanRelayMessage/checkProhibited.
- Himagna: keep `searchListings` / `onListingActivated` / `onWantCreated` signatures; agent relies on match_found firing after onListingActivated.
