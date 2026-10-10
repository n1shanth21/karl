// SHARED. Owner: Nishanth. Others: request changes in team/<name>.md.
// Every tunable number lives here so nobody hardcodes it in their own folder.

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") throw new Error(`Missing env var ${name}. See .env.example.`);
  return value;
}

const messagingMode = env("MESSAGING_MODE", "terminal").toLowerCase();
if (!["terminal", "imessage", "both"].includes(messagingMode)) {
  throw new Error(`MESSAGING_MODE must be terminal, imessage, or both (got "${messagingMode}")`);
}
const dbMode = env("DB_MODE", "memory").toLowerCase();
if (!["memory", "postgres"].includes(dbMode)) {
  throw new Error(`DB_MODE must be memory or postgres (got "${dbMode}")`);
}

export const config = {
  messagingMode: messagingMode as "terminal" | "imessage" | "both",
  dbMode: dbMode as "memory" | "postgres",
  databaseUrl: process.env.DATABASE_URL ?? "",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "", // checked where used, so terminal mode boots without it
  geminiModel: env("GEMINI_MODEL", "gemini-3.8-flash"),
  geminiEmbedModel: env("GEMINI_EMBED_MODEL", "gemini-embedding-2"),
  port: Number(env("PORT", "3000")),
  dashboardOrigin: env("DASHBOARD_ORIGIN", "http://localhost:3001"),
  publicBaseUrl: env("PUBLIC_BASE_URL", "http://localhost:3000"),
  agentName: env("AGENT_NAME", "Karl"),
  agentPhoneDisplay: process.env.AGENT_PHONE_DISPLAY ?? "",
};

// Embedding vector size. Must match db/migrations (vector(768)) and the embed call
// (outputDimensionality: 768). Change all three together or search breaks.
export const EMBED_DIM = 768;

export const LIMITS = {
  debounceMs: 2000, // wait this long after a user's last message, then process the burst
  maxSearchResults: 3,
  matchThreshold: 0.72, // min similarity (0..1) for a want <-> listing proactive match
  searchThreshold: 0.55, // min similarity to show a listing in search results
  holdMinutes: 120, // how long an accepted item is held for the buyer
  meetupCheckinDelayMin: 30, // ask "did it happen?" this long after meetup time
  wantTtlDays: 7,
  maxFollowUpQuestions: 1, // sell flow: questions before proposing the listing
  maxProactivePingsPerUserPerDay: 3,
  maxActiveListingsPerUser: 10,
  rateLimitMessagesPer10Min: 30,
  historyMessages: 20, // conversation turns given to Gemini
};

// Public, well-lit campus spots. Karl only ever suggests these.
export const MEETUP_SPOTS = [
  "the Pit",
  "Student Union lobby",
  "Davis Library entrance",
  "Lenoir Dining Hall entrance",
  "Rams Head Plaza",
];

export const PERSONA = {
  name: config.agentName,
  description:
    "a friendly UNC upperclassman who runs a campus buy/sell line over text. Warm, casual, short (1-3 sentences), lowercase is fine, light humor, never cringe, never pushy, at most one emoji per message. Never pretends to be human if sincerely asked.",
};
