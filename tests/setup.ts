// Preloaded before every `bun test` file (bunfig.toml). Bun auto-loads .env, so without this any code path
// that builds its own Gemini client (safety/image.ts, matching/embed.ts) would make real, billed API calls.
// Opt in to live calls only for Himagna's live embedding test: RUN_LIVE_GEMINI=1 bun test tests/data/embed.test.ts
if (process.env.RUN_LIVE_GEMINI !== "1") process.env.GEMINI_API_KEY = "";
