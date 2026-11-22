/**
 * Unit tests: getMfaRequirement composition matrix (Phase 25, design §8.1 /
 * §5.3). DB is mocked at the getDb boundary (repo db-config.test.ts
 * pattern); ENV is reloaded per case via vi.resetModules because
 * server/_core/env.ts parses process.env at import time.
 *
 * Matrix: TOTP-only → verify; passkey-only → verify (feature on);
 * both → verify (TOTP-first, unchanged); neither → none;
 * org requireMFA → enroll (unchanged); WEBAUTHN_ENFORCEMENT=required +
 * admin role → enroll; required-tier admin WITH passkey → verify;
 * feature OFF + passkey-only → none (fail-safe: passkeys invisible when
 * the verify procedures are gated off).
 *
 * EXECUTED-VERIFIED (vitest, no network).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";

const dbState = vi.hoisted(() => ({
  // table name → canned rows returned for selects from that table
  // (condition-evaluating mock — server/tests/in-memory-db.ts)
  tables: {
    totp_secrets: [] as Array<Record<string, unknown>>,
    webauthn_credentials: [] as Array<Record<string, unknown>>,
    org_settings: [] as Array<Record<string, unknown>>,
    users: [] as Array<Record<string, unknown>>,
    // Wave P26 (O6): confirmation companions for seeded TOTP rows.
    factor_enrollment_confirmations: [] as Array<Record<string, unknown>>,
  } as Record<string, Array<Record<string, unknown>>>,
  audits: [] as Array<Record<string, unknown>>,
  available: true,
}));

vi.mock("../db", async () => {
  const m = await import("../tests/in-memory-db");
  const mod = m.makeInMemoryDbModule(dbState);
  return {
    ...mod,
    getDb: async () => (dbState.available ? mod.getDb() : null),
  };
});

async function loadMfa(env: Record<string, string>) {
  for (const k of ["WEBAUTHN_ENABLED", "WEBAUTHN_ENFORCEMENT", "WEBAUTHN_REQUIRED_ROLES"]) {
    delete process.env[k];
  }
  Object.assign(process.env, env);
  vi.resetModules();
  return import("./mfa");
}

function setState(s: Partial<typeof dbState.tables>) {
  for (const k of Object.keys(dbState.tables)) dbState.tables[k] = [];
  Object.assign(dbState.tables, s);
}

// Wave P26 (O6) fixtures: an ACTIVE TOTP row only counts when it has a
// confirmed companion whose fingerprint matches the current envelope, and a
// passkey only counts with confirmed_at set.
const TOTP_SECRET = "v1.test-envelope";
function confirmedTotpRow(id = "t1") {
  return { id, userId: "u1", secret: TOTP_SECRET, status: "active" };
}
function confirmedTotpCompanion(id = "t1") {
  return {
    id: "comp-1", userId: "u1", factorType: "totp", factorId: id,
    factorFingerprint: createHash("md5").update(TOTP_SECRET).digest("hex"),
    tokenHash: "x", expiresAt: new Date(), consumedAt: new Date(), confirmedAt: new Date(),
  };
}
function confirmedPasskeyRow(id = "c1") {
  return { id, userId: "u1", confirmedAt: new Date() };
}

beforeEach(() => {
  setState({});
  dbState.available = true;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("getMfaRequirement composition (§5.3)", () => {
  it("TOTP-only → verify (unchanged TOTP-first semantics)", async () => {
    const mfa = await loadMfa({ WEBAUTHN_ENABLED: "true" });
    setState({
      totp_secrets: [confirmedTotpRow()],
      factor_enrollment_confirmations: [confirmedTotpCompanion()],
    });
    expect(await mfa.getMfaRequirement("u1")).toBe("verify");
  });

  it("passkey-only → verify when the feature is enabled", async () => {
    const mfa = await loadMfa({ WEBAUTHN_ENABLED: "true" });
    setState({ webauthn_credentials: [confirmedPasskeyRow()] });
    expect(await mfa.getMfaRequirement("u1")).toBe("verify");
  });

  it("both factors → verify (TOTP stays first; passkey also offered at /mfa)", async () => {
    const mfa = await loadMfa({ WEBAUTHN_ENABLED: "true" });
    setState({
      totp_secrets: [confirmedTotpRow()],
      factor_enrollment_confirmations: [confirmedTotpCompanion()],
      webauthn_credentials: [confirmedPasskeyRow()],
    });
    expect(await mfa.getMfaRequirement("u1")).toBe("verify");
  });

  it("Wave P26 (O6): UNCONFIRMED factors are inert — pending passkey / unconfirmed TOTP → none", async () => {
    const mfa = await loadMfa({ WEBAUTHN_ENABLED: "true" });
    setState({
      totp_secrets: [confirmedTotpRow()], // no companion row → unconfirmed
      webauthn_credentials: [{ id: "c1", userId: "u1", confirmedAt: null }],
    });
    expect(await mfa.getMfaRequirement("u1")).toBe("none");
  });

  it("Wave P26 (O6): confirmed companion with a STALE fingerprint (re-setup) does not count", async () => {
    const mfa = await loadMfa({ WEBAUTHN_ENABLED: "true" });
    setState({
      totp_secrets: [{ id: "t1", userId: "u1", secret: "v1.attacker-envelope", status: "active" }],
      factor_enrollment_confirmations: [confirmedTotpCompanion()],
    });
    expect(await mfa.getMfaRequirement("u1")).toBe("none");
  });

  it("neither factor, optional tier → none", async () => {
    const mfa = await loadMfa({ WEBAUTHN_ENABLED: "true", WEBAUTHN_ENFORCEMENT: "optional" });
    setState({ users: [{ id: "u1", role: "admin" }] });
    expect(await mfa.getMfaRequirement("u1")).toBe("none");
  });

  it("org requireMFA → enroll (unchanged)", async () => {
    const mfa = await loadMfa({ WEBAUTHN_ENABLED: "true" });
    setState({ org_settings: [{ userId: "u1", r: true }] });
    expect(await mfa.getMfaRequirement("u1")).toBe("enroll");
  });

  it("required tier + role in WEBAUTHN_REQUIRED_ROLES, no factors → enroll (§5.2)", async () => {
    const mfa = await loadMfa({
      WEBAUTHN_ENABLED: "true",
      WEBAUTHN_ENFORCEMENT: "required",
      WEBAUTHN_REQUIRED_ROLES: "admin",
    });
    setState({ users: [{ id: "u1", role: "admin" }] });
    expect(await mfa.getMfaRequirement("u1")).toBe("enroll");
  });

  it("required tier does not apply to non-listed roles", async () => {
    const mfa = await loadMfa({
      WEBAUTHN_ENABLED: "true",
      WEBAUTHN_ENFORCEMENT: "required",
      WEBAUTHN_REQUIRED_ROLES: "admin",
    });
    setState({ users: [{ id: "u1", role: "user" }] });
    expect(await mfa.getMfaRequirement("u1")).toBe("none");
  });

  it("required-tier admin WITH a passkey → verify (passkey satisfies the mandate)", async () => {
    const mfa = await loadMfa({
      WEBAUTHN_ENABLED: "true",
      WEBAUTHN_ENFORCEMENT: "required",
      WEBAUTHN_REQUIRED_ROLES: "admin",
    });
    setState({ users: [{ id: "u1", role: "admin" }], webauthn_credentials: [confirmedPasskeyRow()] });
    expect(await mfa.getMfaRequirement("u1")).toBe("verify");
  });

  it("feature OFF + passkey-only → none (fail-safe: passkeys invisible while gated off)", async () => {
    const mfa = await loadMfa({ WEBAUTHN_ENABLED: "false" });
    setState({ webauthn_credentials: [confirmedPasskeyRow()] });
    expect(await mfa.getMfaRequirement("u1")).toBe("none");
  });

  it("DB unavailable fails open (no lockout), per hasActiveTotp precedent", async () => {
    const mfa = await loadMfa({ WEBAUTHN_ENABLED: "true" });
    dbState.available = false;
    expect(await mfa.getMfaRequirement("u1")).toBe("none");
  });
});
