// Tests for /signup and /api/signup with a fake Photon (no network calls).
import { expect, spyOn, test } from "bun:test";
import { type CreatePhotonUser, displayPhone, normalizeUsPhone, type PhotonResult, signupRoutes } from "../../src/http/signup";

const KARL_LINE = "+19195550100";

function fakePhoton(result: PhotonResult = { ok: true, assignedPhoneNumber: KARL_LINE }) {
  const calls: { phone: string; firstName: string | null }[] = [];
  const createUser: CreatePhotonUser = async (phone, firstName) => {
    calls.push({ phone, firstName });
    return result;
  };
  return { createUser, calls };
}

function post(app: ReturnType<typeof signupRoutes>, body: unknown, ip = "1.2.3.4") {
  return app.request("/api/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

test("normalizeUsPhone accepts common US formats and rejects junk", () => {
  for (const input of ["919-555-0123", "(919) 555 0123", "+1 919 555 0123", "19195550123", "919.555.0123"]) {
    expect(normalizeUsPhone(input)).toBe("+19195550123");
  }
  for (const input of ["", "555-0123", "123-456-7890", "+44 20 7946 0958", "abc"]) {
    expect(normalizeUsPhone(input)).toBeNull();
  }
  expect(displayPhone("+19195550123")).toBe("(919) 555-0123");
});

test("good signup returns the user's own Karl number and an sms link", async () => {
  const photon = fakePhoton();
  const res = await post(signupRoutes({ createUser: photon.createUser, code: "" }), { phone: "(919) 555-0123", firstName: "Maya Smith" });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    ok: true,
    karlNumber: KARL_LINE,
    karlNumberDisplay: "(919) 555-0100",
    smsLink: "sms:+19195550100&body=hi%20karl",
  });
  expect(photon.calls).toEqual([{ phone: "+19195550123", firstName: "Maya" }]); // first name only
});

test("bad phone number never reaches Photon", async () => {
  const photon = fakePhoton();
  const res = await post(signupRoutes({ createUser: photon.createUser, code: "" }), { phone: "555", firstName: "Jo" });
  expect(res.status).toBe(400);
  expect(photon.calls).toEqual([]);
});

test("Photon full / down errors become friendly messages", async () => {
  const full = await post(signupRoutes({ createUser: fakePhoton({ ok: false, error: "full" }).createUser, code: "" }), { phone: "9195550123" });
  expect(full.status).toBe(503);
  expect(((await full.json()) as { error: string }).error).toContain("capacity");
  const down = await post(signupRoutes({ createUser: fakePhoton({ ok: false, error: "down" }).createUser, code: "" }), { phone: "9195550123" });
  expect(((await down.json()) as { error: string }).error).toContain("try again");
});

test("sign-up code is required when set (case-insensitive)", async () => {
  const photon = fakePhoton();
  const app = signupRoutes({ createUser: photon.createUser, code: "HackNC" });
  expect((await post(app, { phone: "9195550123" })).status).toBe(403);
  expect((await post(app, { phone: "9195550123", code: "nope" })).status).toBe(403);
  expect((await post(app, { phone: "9195550123", code: "hacknc" })).status).toBe(200);
  expect(photon.calls.length).toBe(1);
});

test("max 5 signups per IP per hour, then allowed again", async () => {
  let clock = 1_000_000;
  const app = signupRoutes({ createUser: fakePhoton().createUser, code: "", now: () => clock });
  for (let i = 0; i < 5; i++) expect((await post(app, { phone: "9195550123" }, "9.9.9.9")).status).toBe(200);
  expect((await post(app, { phone: "9195550123" }, "9.9.9.9")).status).toBe(429);
  expect((await post(app, { phone: "9195550123" }, "8.8.8.8")).status).toBe(200); // other IPs unaffected
  clock += 60 * 60 * 1000;
  expect((await post(app, { phone: "9195550123" }, "9.9.9.9")).status).toBe(200);
});

test("logs never contain the full phone number", async () => {
  const log = spyOn(console, "log").mockImplementation(() => {});
  await post(signupRoutes({ createUser: fakePhoton().createUser, code: "" }), { phone: "919-555-0123" });
  const printed = log.mock.calls.flat().join(" ");
  log.mockRestore();
  expect(printed).toContain("0123");
  expect(printed).not.toContain("5550123");
});

test("GET /signup serves the form, with a code field only when needed", async () => {
  const open = await (await signupRoutes({ code: "" }).request("/signup")).text();
  expect(open).toContain("get my karl number");
  expect(open).not.toContain('id="code"');
  const coded = await (await signupRoutes({ code: "x" }).request("/signup")).text();
  expect(coded).toContain('id="code"');
});
