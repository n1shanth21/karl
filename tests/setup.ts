// Preloaded before every `bun test` file (bunfig.toml). Bun auto-loads .env, so without this a laptop whose .env
// points at production would (a) make real, billed Gemini calls and (b) run tests against the live database.
// Opt-ins: RUN_LIVE_GEMINI=1 for Himagna's live embedding test; TEST_DB=postgres for the postgres data tests
//   (TEST_DB=postgres DB_MODE=postgres bun test tests/data  — they use throwaway test_ schemas).
if (process.env.RUN_LIVE_GEMINI !== "1") process.env.GEMINI_API_KEY = "";
if (process.env.TEST_DB !== "postgres") {
  process.env.DB_MODE = "memory";
  process.env.DATABASE_URL = "";
}
process.env.MESSAGING_MODE = "terminal";
