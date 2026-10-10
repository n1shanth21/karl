// Sign-up: adds a phone to the Photon project's Users list so Photon lets it text Karl.
// Photon gives each shared user THEIR OWN Karl number (assignedPhoneNumber), so we show it.
// Karl never texts anyone from here; the person still texts first.
//   GET  /signup      tiny phone-friendly form (QR code points here)
//   POST /api/signup  { phone, firstName, code? } → { karlNumber, karlNumberDisplay, smsLink }

import { Hono } from "hono";
import { signupPage } from "./signupPage";

export type PhotonResult = { ok: true; assignedPhoneNumber: string } | { ok: false; error: "full" | "invalid" | "down" };
export type CreatePhotonUser = (phone: string, firstName: string | null) => Promise<PhotonResult>;

const MAX_PER_IP_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;
const PHOTON_TIMEOUT_MS = 10_000;

const ERRORS = {
  badPhone: "that doesn't look like a US number. try something like 919-555-0123",
  badCode: "that sign-up code isn't right. check the poster/QR and try again",
  tooMany: "whoa, lots of sign-ups from here. try again in a bit",
  full: "we're at capacity rn, sorry! try again later",
  invalid: "photon didn't accept that number. double-check it?",
  down: "couldn't reach the texting service. try again in a sec",
};

/** "919-555-0123", "(919) 555 0123", "+1 919 555 0123" → "+19195550123". Null if not a US number. */
export function normalizeUsPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10 && /^[2-9]\d{2}[2-9]/.test(digits)) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return normalizeUsPhone(digits.slice(1));
  return null;
}

/** "+19195550123" → "(919) 555-0123" */
export function displayPhone(e164: string): string {
  const d = e164.replace(/^\+1/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164;
}

const last4 = (phone: string) => `…${phone.slice(-4)}`;

/** The real Photon call: POST /projects/{id}/users/ with Basic auth (project id + secret). */
export const photonCreateUser: CreatePhotonUser = async (phone, firstName) => {
  const projectId = process.env.SPECTRUM_PROJECT_ID;
  const secret = process.env.SPECTRUM_PROJECT_SECRET;
  if (!projectId || !secret) {
    console.error("[signup] SPECTRUM_PROJECT_ID / SPECTRUM_PROJECT_SECRET not set");
    return { ok: false, error: "down" };
  }
  try {
    const res = await fetch(`https://spectrum.photon.codes/projects/${projectId}/users/`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${projectId}:${secret}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ type: "shared", phoneNumber: phone, firstName }),
      signal: AbortSignal.timeout(PHOTON_TIMEOUT_MS),
    });
    const text = await res.text();
    if (res.ok) {
      const assigned = JSON.parse(text)?.data?.assignedPhoneNumber;
      if (typeof assigned === "string") return { ok: true, assignedPhoneNumber: assigned };
      console.error("[signup] photon 200 without assignedPhoneNumber");
      return { ok: false, error: "down" };
    }
    console.error(`[signup] photon ${res.status}: ${text.slice(0, 200)}`);
    if (/max|limit|capacity|quota/i.test(text)) return { ok: false, error: "full" };
    if (res.status === 400 || res.status === 422) return { ok: false, error: "invalid" };
    return { ok: false, error: "down" };
  } catch (err) {
    console.error(`[signup] photon request failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: "down" };
  }
};

/** Build the sign-up routes. Tests pass a fake Photon, a code and a clock. */
export function signupRoutes(opts: { createUser?: CreatePhotonUser; code?: string; now?: () => number } = {}) {
  const createUser = opts.createUser ?? photonCreateUser;
  const now = opts.now ?? Date.now;
  const recentByIp = new Map<string, number[]>();
  const app = new Hono();

  app.get("/signup", (c) => c.html(signupPage({ needsCode: Boolean(opts.code ?? process.env.SIGNUP_CODE) })));

  app.post("/api/signup", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { phone?: unknown; firstName?: unknown; code?: unknown };
    const requiredCode = opts.code ?? process.env.SIGNUP_CODE;
    if (requiredCode && String(body.code ?? "").trim().toLowerCase() !== requiredCode.toLowerCase()) {
      return c.json({ ok: false, error: ERRORS.badCode }, 403);
    }

    const phone = normalizeUsPhone(String(body.phone ?? ""));
    if (!phone) return c.json({ ok: false, error: ERRORS.badPhone }, 400);
    const firstName = String(body.firstName ?? "").trim().split(/\s+/)[0]?.slice(0, 30) || null;

    // Per-IP limit so a bot can't fill all 100 Photon user slots.
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const times = (recentByIp.get(ip) ?? []).filter((t) => now() - t < HOUR_MS);
    if (times.length >= MAX_PER_IP_PER_HOUR) return c.json({ ok: false, error: ERRORS.tooMany }, 429);
    times.push(now());
    recentByIp.set(ip, times);

    const result = await createUser(phone, firstName);
    if (!result.ok) {
      console.log(`[signup] ${last4(phone)} failed: ${result.error}`);
      return c.json({ ok: false, error: ERRORS[result.error] }, result.error === "invalid" ? 400 : 503);
    }
    const karl = result.assignedPhoneNumber;
    console.log(`[signup] ${last4(phone)} added, texts Karl at line ${last4(karl)}`);
    return c.json({
      ok: true,
      karlNumber: karl,
      karlNumberDisplay: displayPhone(karl),
      smsLink: `sms:${karl}&body=${encodeURIComponent("hi karl")}`,
    });
  });

  return app;
}
