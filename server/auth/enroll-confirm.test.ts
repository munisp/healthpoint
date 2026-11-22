/**
 * Unit tests: server/auth/enroll-confirm.ts — Wave P26 (O6) first-factor
 * enrollment confirmation token lifecycle.
 *
 * Covered (all against in-memory DB/Redis doubles; no network):
 *  - issueConfirmation: raw token returned once; only sha256(raw) stored;
 *    issuing a second token burns the first (latest-email-wins);
 *  - consumeConfirmationToken: happy path activates a pending passkey
 *    (confirmed_at set + token consumed); single-use (replay → invalid);
 *    expired → invalid; unknown token → invalid (uniform, no leak);
 *    TOTP confirm requires status=active AND a matching envelope
 *    fingerprint (re-setup detector: changed envelope → invalid);
 *  - isTotpConfirmed: confirmed+fingerprint-match → true; pending token row
 *    (confirmed_at NULL) → false; fingerprint mismatch (re-setup) → false;
 *  - countConfirmedFactors: first-vs-subsequent discriminator;
 *  - mfaConfirm router: confirm is rate-limited per IP and returns a
 *    uniform error for every failure mode; finalizeTotp picks
 *    confirmation_required (first factor) vs confirmed+alert (subsequent);
 *    resend burns the prior token.
 *
 * EXECUTED-VERIFIED (vitest, no network).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";

vi.hoisted(() => {
  process.env.JWT_SECRET ??= "enroll-confirm-unit-test-secret";
});

// ── In-memory DB double (condition-evaluating; see server/tests/in-memory-db.ts) ──
const dbState = vi.hoisted(() => ({
  tables: {
    totp_secrets: [] as Array<Record<string, unknown>>,
    webauthn_credentials: [] as Array<Record<string, unknown>>,
    factor_enrollment_confirmations: [] as Array<Record<string, unknown>>,
  } as Record<string, Array<Record<string, unknown>>>,
  audits: [] as Array<Record<string, unknown>>,
}));

vi.mock("../db", async () => {
  const m = await import("../tests/in-memory-db");
  return m.makeInMemoryDbModule(dbState);
});

// ── In-memory Redis double (for webauthnRateLimit) ──────────────────────────
vi.mock("../redis", () => ({
  getRedisClient: () => null, // non-production → warn-and-allow rate limits
  sessionSet: async () => undefined,
  sessionGet: async () => null,
  sessionDel: async () => undefined,
  rateLimitIncr: async () => 1,
}));

// ── Mailer spy ───────────────────────────────────────────────────────────────
const mailer = vi.hoisted(() => ({
  confirm: [] as Array<{ to: string; payload: Record<string, unknown> }>,
  alert: [] as Array<{ to: string; payload: Record<string, unknown> }>,
  confirmShouldThrow: false,
}));
vi.mock("../email", () => ({
  sendFactorEnrollmentConfirmEmail: async (to: string, payload: Record<string, unknown>) => {
    if (mailer.confirmShouldThrow) throw new Error("Email delivery is not configured");
    mailer.confirm.push({ to, payload });
  },
  sendFactorAddedAlertEmail: async (to: string, payload: Record<string, unknown>) => {
    mailer.alert.push({ to, payload });
    return true;
  },
}));

import {
  consumeConfirmationToken,
  countConfirmedFactors,
  findPendingFactor,
  getLastIssuedTokenForTests,
  isTotpConfirmed,
  issueConfirmation,
  recordConfirmedTotpCompanion,
  totpFingerprint,
} from "./enroll-confirm";
import { enrollConfirmRouter } from "../routers/enroll-confirm";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function reset() {
  for (const k of Object.keys(dbState.tables)) dbState.tables[k] = [];
  dbState.audits.length = 0;
  mailer.confirm.length = 0;
  mailer.alert.length = 0;
  mailer.confirmShouldThrow = false;
}
beforeEach(() => {
  reset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function seedPendingPasskey(userId = "u1") {
  dbState.tables.webauthn_credentials.push({
    id: "cred-1", userId, credentialId: Buffer.from("cred"), publicKey: Buffer.from("pk"),
    counter: 0, transports: "[]", aaguid: null, name: "Clinic key", backedUp: false,
    deviceType: "singleDevice", createdAt: new Date(), lastUsedAt: null,
    lastCounterAnomalyAt: null, confirmedAt: null,
  });
  return "cred-1";
}

function seedActiveTotp(userId = "u1", secret = "ENVELOPE-V1") {
  dbState.tables.totp_secrets.push({
    id: "totp-1", userId, secret, status: "active",
    backupCodes: "[]", usedBackupCodes: "[]",
  });
  return { rowId: "totp-1", secret };
}

describe("issueConfirmation", () => {
  it("returns the raw token once and stores only the sha256 hash", async () => {
    const credId = seedPendingPasskey();
    const issued = await issueConfirmation({ userId: "u1", factorType: "passkey", factorId: credId });
    expect(issued.token).toMatch(/^[0-9a-f]{64}$/);
    const rows = dbState.tables.factor_enrollment_confirmations;
    expect(rows.length).toBe(1);
    expect(rows[0].tokenHash).toBe(sha256(issued.token));
    expect(JSON.stringify(rows[0])).not.toContain(issued.token);
    expect((rows[0].expiresAt as Date).getTime()).toBeGreaterThan(Date.now());
    expect(getLastIssuedTokenForTests("passkey", credId)).toBe(issued.token);
  });

  it("issuing a second token for the same factor burns the first", async () => {
    const credId = seedPendingPasskey();
    const first = await issueConfirmation({ userId: "u1", factorType: "passkey", factorId: credId });
    const second = await issueConfirmation({ userId: "u1", factorType: "passkey", factorId: credId });
    expect(second.token).not.toBe(first.token);
    const rows = dbState.tables.factor_enrollment_confirmations;
    expect(rows.length).toBe(2);
    // First token's row was force-expired → consume rejects it.
    expect((rows[0].expiresAt as Date).getTime()).toBeLessThanOrEqual(Date.now());
    const r1 = await consumeConfirmationToken(first.token);
    expect(r1.status).toBe("invalid");
    const r2 = await consumeConfirmationToken(second.token);
    expect(r2.status).toBe("confirmed");
  });
});

describe("consumeConfirmationToken — passkey", () => {
  it("happy path: activates the pending credential and consumes the token", async () => {
    const credId = seedPendingPasskey();
    const issued = await issueConfirmation({ userId: "u1", factorType: "passkey", factorId: credId });
    const result = await consumeConfirmationToken(issued.token);
    expect(result.status).toBe("confirmed");
    const cred = dbState.tables.webauthn_credentials[0];
    expect(cred.confirmedAt).toBeInstanceOf(Date);
    const tok = dbState.tables.factor_enrollment_confirmations[0];
    expect(tok.consumedAt).toBeInstanceOf(Date);
    expect(tok.confirmedAt).toBeInstanceOf(Date);
  });

  it("single-use: replay of the same token is invalid", async () => {
    const credId = seedPendingPasskey();
    const issued = await issueConfirmation({ userId: "u1", factorType: "passkey", factorId: credId });
    expect((await consumeConfirmationToken(issued.token)).status).toBe("confirmed");
    expect((await consumeConfirmationToken(issued.token)).status).toBe("invalid");
  });

  it("unknown token → invalid (uniform, no account-existence leak)", async () => {
    const result = await consumeConfirmationToken("f".repeat(64));
    expect(result.status).toBe("invalid");
  });

  it("expired token → invalid", async () => {
    const credId = seedPendingPasskey();
    const issued = await issueConfirmation({ userId: "u1", factorType: "passkey", factorId: credId });
    dbState.tables.factor_enrollment_confirmations[0].expiresAt = new Date(Date.now() - 1000);
    expect((await consumeConfirmationToken(issued.token)).status).toBe("invalid");
  });

  it("credential deleted before confirmation → invalid", async () => {
    const credId = seedPendingPasskey();
    const issued = await issueConfirmation({ userId: "u1", factorType: "passkey", factorId: credId });
    dbState.tables.webauthn_credentials.length = 0;
    expect((await consumeConfirmationToken(issued.token)).status).toBe("invalid");
  });
});

describe("consumeConfirmationToken — TOTP + re-setup detector", () => {
  it("confirms when the envelope is unchanged since issuance", async () => {
    const { rowId, secret } = seedActiveTotp();
    const issued = await issueConfirmation({
      userId: "u1", factorType: "totp", factorId: rowId, factorFingerprint: totpFingerprint(secret),
    });
    const result = await consumeConfirmationToken(issued.token);
    expect(result.status).toBe("confirmed");
    expect(await isTotpConfirmed(rowId, secret)).toBe(true);
  });

  it("re-setup (envelope replaced after issuance) → invalid", async () => {
    const { rowId, secret } = seedActiveTotp();
    const issued = await issueConfirmation({
      userId: "u1", factorType: "totp", factorId: rowId, factorFingerprint: totpFingerprint(secret),
    });
    // Attacker (or user) re-runs totp.setup → new envelope.
    dbState.tables.totp_secrets[0].secret = "ENVELOPE-V2-ATTACKER";
    expect((await consumeConfirmationToken(issued.token)).status).toBe("invalid");
    expect(await isTotpConfirmed(rowId, "ENVELOPE-V2-ATTACKER")).toBe(false);
  });

  it("a prior CONFIRMED companion stops matching after re-setup", async () => {
    const { rowId, secret } = seedActiveTotp();
    await recordConfirmedTotpCompanion({ userId: "u1", totpRowId: rowId, secretEnvelope: secret });
    expect(await isTotpConfirmed(rowId, secret)).toBe(true);
    expect(await isTotpConfirmed(rowId, "ENVELOPE-V2-ATTACKER")).toBe(false);
  });

  it("a pending (unconfirmed) token row does NOT count as confirmation", async () => {
    const { rowId, secret } = seedActiveTotp();
    await issueConfirmation({
      userId: "u1", factorType: "totp", factorId: rowId, factorFingerprint: totpFingerprint(secret),
    });
    expect(await isTotpConfirmed(rowId, secret)).toBe(false);
  });
});

describe("countConfirmedFactors (first-vs-subsequent discriminator)", () => {
  it("zero factors → 0 (first-factor path)", async () => {
    expect(await countConfirmedFactors("u1")).toBe(0);
  });
  it("pending passkey does not count; confirmed one does", async () => {
    seedPendingPasskey();
    expect(await countConfirmedFactors("u1")).toBe(0);
    dbState.tables.webauthn_credentials[0].confirmedAt = new Date();
    expect(await countConfirmedFactors("u1")).toBe(1);
  });
  it("unconfirmed TOTP does not count; confirmed does", async () => {
    const { rowId, secret } = seedActiveTotp();
    expect(await countConfirmedFactors("u1")).toBe(0);
    await recordConfirmedTotpCompanion({ userId: "u1", totpRowId: rowId, secretEnvelope: secret });
    expect(await countConfirmedFactors("u1")).toBe(1);
  });
});

describe("findPendingFactor", () => {
  it("finds the pending passkey and the unconfirmed TOTP", async () => {
    expect(await findPendingFactor("u1", "passkey")).toBeNull();
    const credId = seedPendingPasskey();
    expect((await findPendingFactor("u1", "passkey"))?.factorId).toBe(credId);
    const { rowId } = seedActiveTotp();
    expect((await findPendingFactor("u1", "totp"))?.factorId).toBe(rowId);
  });
  it("returns null once confirmed", async () => {
    const credId = seedPendingPasskey();
    dbState.tables.webauthn_credentials[0].confirmedAt = new Date();
    expect(await findPendingFactor("u1", "passkey")).toBeNull();
  });
});

// ── Router-level: mfaConfirm.confirm / finalizeTotp / resend ────────────────
function makeCtx(user: Record<string, unknown> | null) {
  return {
    user, mfaPending: false, viaApiKey: false, apiKeyScopes: [],
    req: { headers: { "x-forwarded-for": "203.0.113.9", "user-agent": "vitest" }, ip: "203.0.113.9" },
    res: { cookie: () => undefined, clearCookie: () => undefined },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
const USER = { id: "u1", name: "U One", email: "u1@test.local", role: "user" };

describe("mfaConfirm.confirm (public, token-only)", () => {
  it("confirms a valid token; uniform error otherwise; audits both", async () => {
    const credId = seedPendingPasskey();
    const issued = await issueConfirmation({ userId: "u1", factorType: "passkey", factorId: credId });
    const caller = enrollConfirmRouter.createCaller(makeCtx(null));
    const ok = await caller.confirm({ token: issued.token });
    expect(ok.success).toBe(true);
    expect(ok.factorType).toBe("passkey");
    await expect(caller.confirm({ token: issued.token })).rejects.toThrow(
      "This confirmation link is invalid or has expired.");
    await expect(caller.confirm({ token: "a".repeat(64) })).rejects.toThrow(
      "This confirmation link is invalid or has expired.");
    const actions = dbState.audits.map(a => a.action);
    expect(actions).toContain("mfaConfirm.confirmed");
    expect(actions).toContain("mfaConfirm.confirmFailed");
  });
});

describe("mfaConfirm.finalizeTotp", () => {
  it("first factor → confirmation_required + confirm email with metadata", async () => {
    seedActiveTotp();
    const caller = enrollConfirmRouter.createCaller(makeCtx(USER as never));
    const res = await caller.finalizeTotp();
    expect(res.status).toBe("confirmation_required");
    expect((res as { emailSent: boolean }).emailSent).toBe(true);
    expect(mailer.confirm.length).toBe(1);
    const sent = mailer.confirm[0];
    expect(sent.to).toBe("u1@test.local");
    const url = String(sent.payload.confirmUrl);
    expect(url).toContain("/confirm-enrollment#token=");
    expect(String(sent.payload.ip)).toBe("203.0.113.9");
    expect(String(sent.payload.userAgent)).toBe("vitest");
    // The emailed token is the raw one; it confirms the TOTP.
    const token = url.split("token=")[1];
    const pub = enrollConfirmRouter.createCaller(makeCtx(null));
    expect((await pub.confirm({ token })).success).toBe(true);
    expect(await isTotpConfirmed("totp-1", "ENVELOPE-V1")).toBe(true);
  });

  it("email failure is tolerated — factor stays pending, emailSent=false", async () => {
    seedActiveTotp();
    mailer.confirmShouldThrow = true;
    const caller = enrollConfirmRouter.createCaller(makeCtx(USER as never));
    const res = await caller.finalizeTotp();
    expect(res.status).toBe("confirmation_required");
    expect((res as { emailSent: boolean }).emailSent).toBe(false);
    expect(await isTotpConfirmed("totp-1", "ENVELOPE-V1")).toBe(false);
  });

  it("subsequent factor (confirmed passkey exists) → auto-confirmed + alert email", async () => {
    seedActiveTotp();
    seedPendingPasskey();
    dbState.tables.webauthn_credentials[0].confirmedAt = new Date(); // confirmed passkey
    const caller = enrollConfirmRouter.createCaller(makeCtx(USER as never));
    const res = await caller.finalizeTotp();
    expect(res.status).toBe("confirmed");
    expect(await isTotpConfirmed("totp-1", "ENVELOPE-V1")).toBe(true);
    // Alert is fire-and-forget — flush the microtask queue.
    await new Promise(r => setImmediate(r));
    expect(mailer.alert.length).toBe(1);
    expect(String(mailer.alert[0].payload.manageUrl)).toContain("/two-factor-auth");
    expect(dbState.audits.map(a => a.action)).toContain("mfaConfirm.totpAutoConfirmed");
  });

  it("no active TOTP → NOT_FOUND", async () => {
    const caller = enrollConfirmRouter.createCaller(makeCtx(USER as never));
    await expect(caller.finalizeTotp()).rejects.toThrow("No active TOTP enrollment");
  });
});

describe("mfaConfirm.resend", () => {
  it("issues a fresh token and burns the previous one", async () => {
    const credId = seedPendingPasskey();
    const caller = enrollConfirmRouter.createCaller(makeCtx(USER as never));
    const r1 = await caller.resend({ factorType: "passkey" });
    expect(r1.status).toBe("sent");
    const firstToken = getLastIssuedTokenForTests("passkey", credId)!;
    const r2 = await caller.resend({ factorType: "passkey" });
    expect(r2.status).toBe("sent");
    const secondToken = getLastIssuedTokenForTests("passkey", credId)!;
    expect(secondToken).not.toBe(firstToken);
    const pub = enrollConfirmRouter.createCaller(makeCtx(null));
    await expect(pub.confirm({ token: firstToken })).rejects.toThrow("invalid or has expired");
    expect((await pub.confirm({ token: secondToken })).success).toBe(true);
  });

  it("nothing pending → no_pending (own-account signal, no leak)", async () => {
    const caller = enrollConfirmRouter.createCaller(makeCtx(USER as never));
    expect((await caller.resend({ factorType: "totp" })).status).toBe("no_pending");
  });
});
