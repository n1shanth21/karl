# Himagna: Data (branch `data`) · 2nd hardest role

You own everything stored and searched: the Tiger Data database, embeddings and vector search, matching saved wants to new listings, the live stats query, and the seed/reset scripts. This role also wins the **MLH "Best Use of Tiger Data"** prize: pgvector search + a hypertable + a continuous aggregate in one database.

**You own:** `src/db/`, `src/matching/`, `db/`, `scripts/`, `tests/data/`, `team/himagna.md`.
**Contract you implement:** the `Db` interface in `src/db/types.ts` and the 3 functions in `src/matching/index.ts`. Keep `src/db/memory.ts` working too, since everyone else runs on it.
**Nobody waits on you:** the agent runs on the memory DB until your postgres version merges.

## Setup (once)
- tigerdata.com → create a free service → copy the connection string into `.env` as `DATABASE_URL` (share it with the team privately, never in git or chat)
- Gemini key from aistudio.google.com into `.env` (`GEMINI_API_KEY`)

## Phase D1: Postgres DB layer · 5:30–8:00 PM
- [ ] `scripts/migrate.ts`: runs every `db/migrations/*.sql` in order (idempotent)
- [ ] `src/db/postgres.ts`: implement **every** `Db` method with the `postgres` client (one file per table is fine: `src/db/pg/users.ts`, …). Map snake_case ↔ camelCase, cents as integers.
- [ ] `tests/data/db.test.ts`: the same test cases run against **both** memory and postgres (use a `test_`-prefixed schema or reset between runs)
**Finish line:** `DB_MODE=postgres bun test tests/data` passes; `DB_MODE=postgres bun run dev` → text "hi" in terminal → a `users` row exists.

## Phase D2: embeddings + search + matching · 8:00–11:30 PM
- [ ] `src/matching/embed.ts`: Gemini `GEMINI_EMBED_MODEL` with `outputDimensionality: 768` (= `EMBED_DIM`). Use task types (`RETRIEVAL_DOCUMENT` for listings, `RETRIEVAL_QUERY` for searches/wants).
- [ ] `searchListings(query, {maxPriceCents, excludeSellerId})`: pgvector cosine similarity on active listings + filters, top `LIMITS.maxSearchResults`, score 0..1
- [ ] `onListingActivated(listing)`: embed + store, find open wants above `LIMITS.matchThreshold` within price → `bus.emit("match_found", …)`. Max `LIMITS.maxProactivePingsPerUserPerDay` per buyer.
- [ ] `onWantCreated(want)`: embed + store
- [ ] Keep the keyword version as the memory-mode fallback
- [ ] Tune thresholds with ~15 query/listing pairs ("something to keep drinks cold" → mini fridge must rank first; "desk lamp" must NOT match "lamp oil")
**Finish line:** test proves `match_found` fires for a matching want and not for a non-matching one.

## Phase D3: Tiger features + stats + seed · 11:30 PM–3:00 AM
- [ ] `db/migrations/002_tiger.sql`: `events` → hypertable; continuous aggregate `events_hourly` (`time_bucket('1 hour', ts)`, type, count) with a refresh policy
- [ ] `logEvent` called inside the db layer for: user_created, listing_activated, want_created, match_accepted, sale_completed
- [ ] `getStats()` real, including `listingsPerHour` from the continuous aggregate (photoUrl = `${PUBLIC_BASE_URL}/photos/<id>`, first names only)
- [ ] `scripts/seed.ts`: loads `seed/seed-data.json` + photos (Aayush writes them) into listings, embedded. `scripts/reset.ts`: wipe + reseed.
**Finish line:** `/api/stats` on postgres returns real numbers + hourly buckets.

## Phase DX · 3:00–8:00 AM
- [ ] Optional: `suggestPriceCents(category, title)` from sold comps (median), else null
- [ ] 6 AM: reset + seed the production DB for the demo (keep real HackNC data if the team wants the stats)

## Starter prompt (paste after `/clear`)
```
Read CLAUDE.md and team/himagna.md. I'm Himagna on the data branch. We're doing Phase D1 step 1 only.
Read src/db/types.ts, src/db/memory.ts and db/migrations/001_init.sql first. Show me a numbered plan and wait.
```

## Requests (things I need from others)
-
