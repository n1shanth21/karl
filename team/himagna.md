# Himagna: Data (branch `data`) · 2nd hardest role

You own everything stored and searched: the Tiger Data database, embeddings and vector search, matching saved wants to new listings, the live stats query, and the seed/reset scripts. This role also wins the **MLH "Best Use of Tiger Data"** prize: pgvector search + a hypertable + a continuous aggregate in one database.

**You own:** `src/db/`, `src/matching/`, `db/`, `scripts/`, `tests/data/`, `team/himagna.md`.
**Contract you implement:** the `Db` interface in `src/db/types.ts` and the 3 functions in `src/matching/index.ts`. Keep `src/db/memory.ts` working too, since everyone else runs on it.
**Nobody waits on you:** the agent runs on the memory DB until your postgres version merges.

## Setup (once)
- tigerdata.com → create a free service → copy the connection string into `.env` as `DATABASE_URL` (share it with the team privately, never in git or chat)
- Gemini key from aistudio.google.com into `.env` (`GEMINI_API_KEY`)

## Phase D1: Postgres DB layer · 5:30–8:00 PM
- [x] `scripts/migrate.ts`: runs every `db/migrations/*.sql` in order (idempotent)
- [x] `src/db/postgres.ts`: implement **every** `Db` method with the `postgres` client (one file per table is fine: `src/db/pg/users.ts`, …). Map snake_case ↔ camelCase, cents as integers.
- [x] `tests/data/db.test.ts`: the same test cases run against **both** memory and postgres (use a `test_`-prefixed schema or reset between runs)
**Finish line:** `DB_MODE=postgres bun test tests/data` passes; `DB_MODE=postgres bun run dev` → text "hi" in terminal → a `users` row exists.

## Phase D2: embeddings + search + matching · 8:00–11:30 PM
- [x] `src/matching/embed.ts`: Gemini `GEMINI_EMBED_MODEL` with `outputDimensionality: 768` (= `EMBED_DIM`). Use task types (`RETRIEVAL_DOCUMENT` for listings, `RETRIEVAL_QUERY` for searches/wants). *(Done differently: gemini-embedding-2 has no task types, so we use its text prefixes `title: … | text: …` and `task: search result | query: …`.)*
- [x] `searchListings(query, {maxPriceCents, excludeSellerId})`: pgvector cosine similarity on active listings + filters, top `LIMITS.maxSearchResults`, score 0..1
- [x] `onListingActivated(listing)`: embed + store, find open wants above `LIMITS.matchThreshold` within price *(tuned cutoffs live in `src/matching/thresholds.ts`: match 0.67, search 0.64)* → `bus.emit("match_found", …)`. Max `LIMITS.maxProactivePingsPerUserPerDay` per buyer.
- [x] `onWantCreated(want)`: embed + store
- [x] Keep the keyword version as the memory-mode fallback
- [x] Tune thresholds with ~15 query/listing pairs ("something to keep drinks cold" → mini fridge must rank first; "desk lamp" must NOT match "lamp oil")
**Finish line:** test proves `match_found` fires for a matching want and not for a non-matching one.

## Phase D3: Tiger features + stats + seed · 11:30 PM–3:00 AM
- [x] `db/migrations/003_tiger.sql` *(002 is the vector index)*: `events` → hypertable; continuous aggregate `events_hourly` (`time_bucket('1 hour', ts)`, type, count) with a refresh policy
- [x] `logEvent` called inside the db layer for: user_created, listing_activated, want_created, match_accepted, sale_completed
- [x] `getStats()` real, including `listingsPerHour` from the continuous aggregate (photoUrl = `${PUBLIC_BASE_URL}/photos/<id>`, first names only)
- [x] `scripts/seed.ts`: loads `seed/seed-data.json` + photos (Aayush writes them) into listings, embedded. `scripts/reset.ts`: wipe + reseed. *(Falls back to 27 built-in UNC listings until `seed/seed-data.json` exists. Also `scripts/healthcheck.ts`.)*
**Finish line:** `/api/stats` on postgres returns real numbers + hourly buckets.

## Phase DX · 3:00–8:00 AM
- [x] Optional: `suggestPriceCents(category, title)` from sold comps (median), else null *(`src/matching/price.ts`: needs ≥3 sold in the category, rounded to $1)*
- [ ] 6 AM: reset + seed the production DB for the demo (keep real HackNC data if the team wants the stats)

## Starter prompt (paste after `/clear`)
```
Read CLAUDE.md and team/himagna.md. I'm Himagna on the data branch. We're doing Phase D1 step 1 only.
Read src/db/types.ts, src/db/memory.ts and db/migrations/001_init.sql first. Show me a numbered plan and wait.
```

## Status
- **D1 done**: every `Db` method works on Tiger Data (`DB_MODE=postgres`). `bun scripts/migrate.ts` applies `db/migrations/*.sql` once each. Contract tests run the same cases on memory + postgres in throwaway `test_` schemas.
- **D3 done**: `events` is a Tiger hypertable; `events_hourly` is a real-time continuous aggregate refreshed every minute; `/api/stats` → `listingsPerHour` reads it (last 12 h, zero-filled). The data layer logs `user_created`, `want_created`, `listing_activated`, `match_accepted`, `sale_completed` itself.
- Scripts: `bun scripts/migrate.ts` · `bun scripts/seed.ts` · `bun scripts/reset.ts --yes` (wipes the real DB, asks for `--yes`) · `bun scripts/healthcheck.ts`.
- **D2 done**: Gemini embeddings + pgvector search + proactive want matching, with keyword fallback if Gemini fails. Real run: "need a desk lamp under $20" gets pinged for an IKEA desk lamp (0.758), not for lamp oil; "concert tickets" finds nothing.
- Tests: `bun test` (postgres tests skip without `DATABASE_URL`). The one live Gemini test is opt-in: `RUN_LIVE_GEMINI=1 bun test tests/data/embed.test.ts`.

## Handoff to Nishanth (everything runs on one machine now)

**State of the data side:** all D1–DX work is merged into `main`. The live Tiger database (the one Railway uses) is migrated (001–004) and seeded with Aayush's demo data: 24 listings + photos, 8 wants, 32 seed users (all `optedOut`, phones `seed:<name>`, never texted).

**`.env` on the demo machine** (values from Himagna privately, never in git):
```
DB_MODE=postgres
DATABASE_URL=...            # Tiger Data connection string
GEMINI_API_KEY=...
GEMINI_EMBED_MODEL=gemini-embedding-2
PUBLIC_BASE_URL=https://karl-production.up.railway.app   # must include https://
```

**Commands (all from the repo root):**
| Command | What it does | Safe? |
|---|---|---|
| `bun scripts/healthcheck.ts` | Row counts, embedding gaps, Tiger features present. Exit 1 if an active listing has no embedding. | read-only |
| `bun scripts/backfill.ts` | Embeds any listing/want Gemini missed (backend jobs also do this). | safe, additive |
| `bun scripts/migrate.ts` | Applies new `db/migrations/*.sql` once each. | safe, additive |
| `bun scripts/seed.ts` | Adds the seed data (refuses if already seeded). | additive |
| `bun scripts/reset.ts --yes` | **Wipes the live database** and reseeds. Only for the 6 AM demo reset, and only if the team decides not to keep tonight's real data. | DESTRUCTIVE |
| `DB_MODE=postgres bun test tests/data` | Data tests against throwaway `test_` schemas. | safe |
| `bun test` | Full suite. Run it in memory mode only (the default); in postgres mode `tests/agent/smoke.test.ts` writes to the live DB. | memory: safe |

**Open decisions / known issues:**
1. **Demo risk, the desk fan:** with the seed data, "need a desk lamp under $20" returns *Blue USB desk fan* (0.678) instead of "nothing yet". Either the agent only offers results that really are the requested item, or set that one listing to `removed` before the demo. Judge should text exactly "need a desk lamp under $20"; the seller's listing should keep "desk lamp" in its title (scores 0.69–0.76 vs the 0.67 cutoff).
2. **6 AM:** keep tonight's real HackNC activity for the dashboard stats, or `bun scripts/reset.ts --yes` back to clean demo data. Run `bun scripts/healthcheck.ts` after either.
3. **Migration 004 (pgvectorscale DiskANN + events compression) is reviewed and APPLIED** to the live DB (migrations 001–004). `bun scripts/migrate.ts` now prints "nothing to apply". Rollback SQL is in the Opus review notes if ever needed (not expected).
4. Tiger write-up for judges / Devpost: `db/TIGER.md` (includes read-only SQL to prove each feature live).

## Requests (things I need from others)
- **Nishanth (FYI, additive):** `Db` gained `setListingEmbedding`, `setWantEmbedding`, `searchListingsByVector`, `openWantsByVector`, `countEventsSince`. Flows don't need to call them; keep calling `searchListings` / `onListingActivated` / `onWantCreated` from `src/matching`.
- **Nishanth:** call `onListingActivated(listing)` when a listing goes live for the first time (draft → active) and `onWantCreated(want)` right after `db.createWant`. Without these, nothing gets embedded and search/matching find nothing in postgres mode.
- **Nishanth:** `LIMITS.matchThreshold` (0.72) and `LIMITS.searchThreshold` (0.55) in `src/config.ts` are not used in postgres mode; the tuned values are in `src/matching/thresholds.ts` (0.67 / 0.64). 0.72 would have missed "something to keep drinks cold" → mini fridge (0.69). Change or leave config as you like; just don't rely on those two numbers.
- **Nishanth:** `db.createUser` is now safe to call twice for the same phone (returns the same user), so a burst of first messages won't crash.
- **Nishanth:** the data layer logs `user_created`, `listing_activated`, `want_created`, `match_accepted`, `sale_completed` itself, and `db.logEvent()` now **ignores** those 5 types (`DB_OWNED_EVENTS` in `src/db/types.ts`), so your calls in sell.ts:89, buy.ts:56, match.ts:66/117 are harmless no-ops. Delete them when convenient.
- **Nishanth:** call `onListingActivated` only when a listing goes live the first time (draft → active), not when a hold expires and it goes back to active. (A buyer is never pinged twice for the same listing anyway, but this saves a Gemini call.)
- **Nishanth:** when a buyer picks the item they were pinged about, call `db.updateWantStatus(wantId, "matched")`; on "stop looking" / cancel, `"closed"`. Otherwise an open want keeps matching new listings (max 3 pings/day) for 7 days.
- **Nishanth:** seed sellers have phones like `seed:maya`, `spaceId: "seed"` and `optedOut: true`. Never try to text them; if a buyer picks a seed listing, reply that the seller isn't reachable right now (or treat it as demo-only).
- **Nishanth:** `tests/agent/smoke.test.ts` uses the shared `db`, so `DB_MODE=postgres bun test` (whole suite) writes to the REAL database. Run the full suite in memory mode (the default); data's postgres tests are `DB_MODE=postgres bun test tests/data` and only use throwaway `test_` schemas. `db.reset()` now refuses to wipe the real tables, so that test fails loudly instead of deleting data.
- **Nishanth:** at startup, call `backfillEmbeddings().catch(() => {})` from `src/matching` once (postgres mode). It embeds any listing/want that missed its embedding while Gemini was down, so search can find them. (`bun scripts/backfill.ts` does the same by hand.)
- **Nishanth:** `suggestPriceCents(category)` in `src/matching/price.ts` returns the median of ≥3 sold listings in that category (rounded to $1), else null → use Gemini's estimate.
- **Nishanth:** your `match_found` handler should skip buyers who are `optedOut` (pings respect the daily cap but don't know about stop).
- **Nishanth (demo risk):** with Aayush's seed data, "need a desk lamp under $20" returns the *Blue USB desk fan* (score 0.68) because it's the closest thing in meaning. If the agent presents every search result as a match, the demo's "nothing yet, i'll text you" beat breaks. Have the agent only offer results that are actually the item asked for (Gemini can judge that from the titles) and otherwise `save_want` + "nothing yet". Raising the search cutoff isn't an option: "drinks cold" → mini fridge also scores 0.68.
- **Aayush (done, thanks):** `scripts/seed.ts` loads your `{ listings, wants }` format and photo paths as-is: 24 listings, 24 photos, 8 wants tested in a throwaway schema. Old note below kept for history.
- **Aayush:** for the seed script I need `seed/seed-data.json` as a list of `{ title, description, category, condition, priceCents, sellerFirstName, photo }` where `photo` is a file in `seed/photos/` (JPEG under ~300 KB). Tell me if you'd rather use another shape.
