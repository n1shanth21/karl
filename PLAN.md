# PLAN.md: timeline, checkpoints, demo

Detailed tasks live in each person's `team/<name>.md`. This file is the shared schedule. Owner: Nishanth.

**Saturday Oct 10 → Sunday Oct 11, 2026 (ET).** Code freeze **8:00 AM**. Devpost submitted by **9:30 AM** (hard deadline 10:00). A **2-minute video + public GitHub link** are required.

## Timeline

| Time | Nishanth · agent | Himagna · data | Aarush · backend | Aayush · web |
|---|---|---|---|---|
| 5:15–5:30 PM | Setup + access test | Setup + Tiger Data service | Setup + Photon prod project | Setup |
| 5:30–8:00 | **A1** inbound + Gemini + sell | **D1** postgres DB layer | **B1** safety | **W1** dashboard (mock) |
| **8:00 PM** | **Merge #1** | | | |
| 8:00–11:30 | **A2** buy + wants + match + relay | **D2** embeddings + matching | **B2** timers | **W2** avatar + seed content |
| **11:30 PM** | **Merge #2 → Aarush deploys to Railway (B3) → number posted in HackNC Discord** | | | |
| 11:30–3:00 | **A3** close-out + robustness | **D3** Tiger hypertable + stats + seed | **B3** deploy, then monitor | **W3** real data + deck + Devpost |
| **3:00 AM** | **Merge #3** | | | |
| 3:00–6:00 | **AX** persona + demo polish | **DX** price hint, demo data | **BX** logs, hardening | **WX** persona notes, sleep |
| **6:00 AM** | **Merge #4 (final)** → reset/seed demo DB | | | |
| 6:00–8:00 | Bug fixes on demo path only | Bug fixes | Bug fixes | **Record the 2-min video** |
| **8:00 AM** | **CODE FREEZE** | | | |
| 8:00–9:30 | Rehearse 3× · submit Devpost by 9:30 | | | |

**Sleep in shifts.** After midnight, at least one of Nishanth or Aarush is always awake while Karl is live.

## Dependency map (who unblocks whom)

- Everyone builds on **memory DB + stubs today**. Nothing blocks anything before Merge #1.
- Merge #1: Aarush's safety + Himagna's postgres reach the agent. Nishanth switches local dev to `DB_MODE=postgres` after it.
- Merge #2: Himagna's embeddings make search/wants smart; Aarush's timers make holds/check-ins work. **Deploy happens here.**
- Aayush switches the dashboard to the real API after the deploy.

## Merge checklist (Nishanth)
1. 5 min before: "push your branch" in the team chat.
2. `git switch main && git pull`
3. For each of `data`, `backend`, `web`, `agent`: `git merge origin/<branch>` → `bun install` → `bun run check && bun test` → fix or `git merge --abort`.
4. `git push origin main` → "main updated, run: git pull origin main".
5. Apply any **Requests** from `team/*.md` to shared files on the `agent` branch.

## Demo script (2 minutes, two phones + dashboard on the projector)
1. **Hook (15 s):** "Students already buy and sell in a dozen GroupMe chats. Karl is one number that remembers what you want."
2. **Want (15 s):** Judge's phone texts "need a desk lamp under $20." Karl: "nothing yet, i'll text you."
3. **Sell (25 s):** Teammate texts a photo of a lamp on the table → "desk lamp, good condition, $15. post it?" → ❤️.
4. **Proactive match (15 s):** The judge's phone buzzes: "someone just listed a desk lamp, $15. want it?"
5. **Relay (20 s):** Seller accepts; the judge texts "omw"; it arrives on the seller's phone as **Judge · desk lamp**, with no number.
6. **Safety (10 s):** The seller tries "venmo me first pls". Karl warns the buyer.
7. **Proof (15 s):** Dashboard: "N items listed, M sold at HackNC tonight."
8. **Close (5 s):** "Next: UNC email verification and move-out week."

## Risks and fallbacks
- **Promo/line problems:** escalate to leila@photon.codes or the Photon Discord within 15 min; keep building in terminal mode.
- **Unregistered phones can't text in (CONFIRMED):** Aarush's `/signup` adds them via the Spectrum API (see access-test result below); pre-add judges' numbers.
- **Duplicate replies:** two processes on one Photon project. After deploy, only Railway runs on Aarush's project.
- **Gemini/DB outage at demo time:** backup video + seeded data; `DB_MODE=memory` as last resort.
- **Behind schedule at 11:30 PM:** cut meetup polls → text; cut want expiry; never cut the relay or proactive match (they're the pitch).

## Phase 0 access-test result
- Registered phone → line: ✅ works (Oct 10, 6:03 PM; real Gemini set_name + search + want saved)
- Unregistered phone → line: ❌ **blocked by Photon before it reaches Karl** (Photon auto-replies "This number didn't recognize yours… add your number under Project → Users"). Nothing arrives in our server.
- **Decision:** the sign-up page (Aarush, B3) is REQUIRED. `POST https://spectrum.photon.codes/projects/{projectId}/users/` with Basic auth (projectId:projectSecret), body `{"type":"shared","phoneNumber":"+1…","firstName":"…"}`. The response's `assignedPhoneNumber` is the number THAT user must text, so show it on the confirmation screen; don't assume it's the same line for everyone. Pro cap: 100 users. Pre-register judges' numbers before demo time.
