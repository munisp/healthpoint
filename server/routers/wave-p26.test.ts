/**
 * Phase 26 wave test (live PG, DATABASE_URL-gated): first-factor enrollment
 * email confirmation (adversarial finding O6 — forced-enrollment backdoor).
 *
 *  - migration 0060 applied: factor_enrollment_confirmations + indexes +
 *    webauthn_credentials.confirmed_at;
 *  - FULL first-factor passkey flow through the REAL rootRouter with REAL
 *    SimpleWebAuthn verification (committed fixtures) and a SPIED mailer:
 *    ceremony → pending (authentication rejected, getMfaRequirement
 *    unsatisfied) → confirm via the token from the spied email URL →
 *    authentication succeeds;
 *  - FULL first-factor TOTP flow: active row (as the frozen routers.ts
 *    path leaves it) → verifyLoginCode rejects even a CORRECT code →
 *    finalizeTotp → email confirm → code verifies;
 *  - TOTP re-setup detector: replacing the envelope invalidates the prior
 *    confirmation (stolen-session overwrite scenario);
 *  - subsequent enrollment: auto-confirm + tolerated alert-email success;
 *  - resend supersedes (old token invalid, new token works);
 *  - expired token and random token produce the SAME uniform error
 *    (no account-existence leak).
 *
 * Redis is an in-memory double (sandbox limitation, same as wave-p25);
 * Postgres is NOT mocked. EXECUTED-VERIFIED when DATABASE_URL is set; skipped
 * otherwise.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

vi.hoisted(() => {
  process.env.WEBAUTHN_ENABLED = "true";
  process.env.WEBAUTHN_RP_ID = "localhost";
  process.env.WEBAUTHN_ORIGINS = "http://localhost:3000";
  process.env.WEBAUTHN_RP_NAME = "HealthPoint";
  process.env.JWT_SECRET ??= "wave-p26-test-secret";
});

// In-memory Redis double (see header). Postgres is NOT mocked.
const redisState = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock("../redis", () => {
  const client = {
    getdel: async (key: string) => {
      const v = redisState.store.get(key) ?? null;
      redisState.store.delete(key);
      return v;
    },
    incr: async () => 1,
    expire: async () => 1,
    del: async (key: string) => { redisState.store.delete(key); return 1; },
    set: async (key: string, value: string) => { redisState.store.set(key, value); return "OK"; },
    get: async (key: string) => redisState.store.get(key) ?? null,
  };
  return {
    getRedisClient: () => client,
    sessionSet: async (key: string, value: string, _ttl?: number) => {
      redisState.store.set(`session:${key}`, value);
    },
    sessionGet: async (key: string) => redisState.store.get(`session:${key}`) ?? null,
    sessionDel: async (key: string) => { redisState.store.delete(`session:${key}`); },
    isTokenRevoked: async () => false,
    revokeToken: async () => undefined,
  };
});

// Mailer spy — asserts content and captures the raw token from the URL.
const mailer = vi.hoisted(() => ({
  confirm: [] as Array<{ to: string; payload: Record<string, unknown> }>,
  alert: [] as Array<{ to: string; payload: Record<string, unknown> }>,
}));
vi.mock("../email", () => ({
  sendFactorEnrollmentConfirmEmail: async (to: string, payload: Record<string, unknown>) => {
    mailer.confirm.push({ to, payload });
  },
  sendFactorAddedAlertEmail: async (to: string, payload: Record<string, unknown>) => {
    mailer.alert.push({ to, payload });
    return true;
  },
}));

import "../journeys/env-defaults";
import { eq, sql } from "drizzle-orm";
import { rootRouter } from "../app-router";
import { makeCtxForUser } from "../journeys/framework";
import { getDb } from "../db";
import { users as usersTable, totpSecrets } from "../../drizzle/schema";
import { webauthnCredentials } from "../../drizzle/schema-webauthn";
import { factorEnrollmentConfirmations } from "../../drizzle/schema-enroll-confirm";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const fixtures = JSON.parse(readFileSync(
  path.join(HERE, "fixtures", "webauthn", "software-authenticator.json"), "utf8",
)) as {
  registration: { challenge: string; response: Record<string, unknown> };
  assertion: { challenge: string; response: Record<string, unknown> };
  credential: { credentialId: string };
};

const HAS_DB = Boolean(process.env.DATABASE_URL);
const RUN = Date.now().toString(36);
const U1 = `p26-u1-${RUN}`;
const U2 = `p26-u2-${RUN}`;
const U3 = `p26-u3-${RUN}`;
const TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

function plantChallenge(ceremonyId: string, challenge: string, userId: string | null, mode: string) {
  redisState.store.set(
    `session:webauthn-chal:${ceremonyId}`,
    JSON.stringify({ challenge, userId, mode }),
  );
}

function tokenFromLastConfirmEmail(): string {
  const url = String(mailer.confirm[mailer.confirm.length - 1].payload.confirmUrl);
  const token = new URL(url).searchParams.get("token");
  expect(token).toBeTruthy();
  return token!;
}

afterEach(() => vi.restoreAllMocks());

describe.skipIf(!HAS_DB)("Phase26 first-factor enrollment confirmation (live PG)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let u1row: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let u2row: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let u3row: any;
  let caller1: ReturnType<typeof rootRouter.createCaller>;

  beforeAll(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = await getDb();
    expect(db).toBeTruthy();
    for (const [id, name] of [[U1, "P26 User One"], [U2, "P26 User Two"], [U3, "P26 User Three"]] as const) {
      await db!.insert(usersTable)
        .values({ id, name, email: `${id}@test.local`, loginMethod: "test", role: "user" })
        .onConflictDoNothing();
    }
    [u1row] = await db!.select().from(usersTable).where(eq(usersTable.id, U1)).limit(1);
    [u2row] = await db!.select().from(usersTable).where(eq(usersTable.id, U2)).limit(1);
    [u3row] = await db!.select().from(usersTable).where(eq(usersTable.id, U3)).limit(1);
    // Idempotent re-runs: the committed fixture credential ID is unique.
    await db!.delete(webauthnCredentials).where(
      eq(webauthnCredentials.credentialId, Buffer.from(fixtures.credential.credentialId, "base64url")),
    );
    caller1 = rootRouter.createCaller(makeCtxForUser(u1row));
    mailer.confirm.length = 0;
    mailer.alert.length = 0;
  });

  it("migration 0060 applied: table, indexes, confirmed_at column", async () => {
    const db = await getDb();
    const t = await db!.execute(sql`SELECT to_regclass('factor_enrollment_confirmations') AS r`);
    expect((t.rows ?? t)[0].r).toBe("factor_enrollment_confirmations");
    const idx = await db!.execute(sql`
      SELECT indexname FROM pg_indexes WHERE tablename = 'factor_enrollment_confirmations'`);
    const names = (idx.rows ?? idx).map((r: { indexname: string }) => r.indexname);
    expect(names).toContain("factor_enroll_confirm_token_uniq");
    expect(names).toContain("factor_enroll_confirm_user_idx");
    expect(names).toContain("factor_enroll_confirm_factor_idx");
    const col = await db!.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'webauthn_credentials' AND column_name = 'confirmed_at'`);
    expect((col.rows ?? col).length).toBe(1);
  });

  it("first-factor passkey: pending → inert → email confirm (spied URL token) → active", async () => {
    const opts = await caller1.webauthn.registrationOptions({ name: "Clinic key" });
    plantChallenge(opts.ceremonyId, fixtures.registration.challenge, U1, "registration");
    const reg = await caller1.webauthn.verifyRegistration({
      ceremonyId: opts.ceremonyId, name: "Clinic key", response: fixtures.registration.response,
    });
    expect(reg.requiresConfirmation).toBe(true);
    expect(reg.emailSent).toBe(true);

    // Email content: confirm URL + device label + request metadata.
    expect(mailer.confirm.length).toBe(1);
    const sent = mailer.confirm[0];
    expect(sent.to).toBe(`${U1}@test.local`);
    expect(String(sent.payload.factorLabel)).toContain("Clinic key");
    expect(String(sent.payload.confirmUrl)).toContain("/confirm-enrollment?token=");
    expect(sent.payload.expiresMinutes).toBe(60);
    expect(sent.payload.requestedAt).toBeInstanceOf(Date);

    // Pending credential is INERT at authentication (real assertion).
    const { getMfaRequirement, hasActiveTotp } = await import("../auth/mfa");
    expect(await getMfaRequirement(U1)).toBe("none");
    expect(await hasActiveTotp(U1)).toBe(false);
    const mfaCaller = rootRouter.createCaller(makeCtxForUser(u1row, { mfaPending: true }));
    const authOpts = await mfaCaller.webauthn.authenticationOptions({ ceremony: "mfa" });
    plantChallenge(authOpts.ceremonyId, fixtures.assertion.challenge, U1, "mfa");
    await expect(mfaCaller.webauthn.verifyAuthentication({
      ceremonyId: authOpts.ceremonyId, response: fixtures.assertion.response,
    })).rejects.toMatchObject({ code: "UNAUTHORIZED", message: "authentication_failed" });

    // Confirm via the RAW TOKEN FROM THE SPIED EMAIL (not the test seam).
    const token = tokenFromLastConfirmEmail();
    const anon = rootRouter.createCaller(makeCtxForUser(u2row)); // public proc; any ctx
    const ok = await anon.mfaConfirm.confirm({ token });
    expect(ok).toEqual({ success: true, factorType: "passkey" });
    expect(await getMfaRequirement(U1)).toBe("verify");

    // Replay rejected with the uniform error.
    await expect(anon.mfaConfirm.confirm({ token })).rejects.toMatchObject({
      code: "BAD_REQUEST", message: "This confirmation link is invalid or has expired.",
    });

    // Now the real assertion succeeds and issues the session.
    const authOpts2 = await mfaCaller.webauthn.authenticationOptions({ ceremony: "mfa" });
    plantChallenge(authOpts2.ceremonyId, fixtures.assertion.challenge, U1, "mfa");
    const auth = await mfaCaller.webauthn.verifyAuthentication({
      ceremonyId: authOpts2.ceremonyId, response: fixtures.assertion.response,
    });
    expect(auth).toEqual({ success: true, sessionIssued: true });

    // Audit trail covers registration + confirmation.
    const db = await getDb();
    const audits = await db!.execute(sql`
      SELECT action FROM audit_log WHERE "entityId" IN (${reg.credentialId})
      OR ("entityType" = 'factor_enrollment_confirmation' AND "userId" = ${U1})`);
    const actions = ((audits.rows ?? audits) as Array<{ action: string }>).map(a => a.action);
    expect(actions).toContain("webauthn.register");
    expect(actions).toContain("mfaConfirm.confirmed");
  });

  it("first-factor TOTP: active-but-unconfirmed row rejects even a CORRECT code until email-confirmed", async () => {
    const db = await getDb();
    const totpRowId = `p26-totp-${RUN}`;
    await db!.insert(totpSecrets).values({
      id: totpRowId, userId: U2, secret: TOTP_SECRET, status: "active",
      backupCodes: "[]", usedBackupCodes: "[]",
    }).onConflictDoNothing();
    const { verifyLoginCode, getMfaRequirement } = await import("../auth/mfa");
    const { generate: totpGenerate } = await import("otplib");

    // The backdoor concretely: a correct code against an unconfirmed enrollment.
    expect(await verifyLoginCode(U2, await totpGenerate({ secret: TOTP_SECRET }))).toBe(false);
    expect(await getMfaRequirement(U2)).toBe("none");

    const caller2 = rootRouter.createCaller(makeCtxForUser(u2row, { mfaPending: true }));
    const fin = await caller2.mfaConfirm.finalizeTotp();
    expect(fin.status).toBe("confirmation_required");
    expect((fin as { emailSent: boolean }).emailSent).toBe(true);
    expect(mailer.confirm[mailer.confirm.length - 1].to).toBe(`${U2}@test.local`);
    expect(String(mailer.confirm[mailer.confirm.length - 1].payload.factorLabel)).toContain("TOTP");

    // Still inert until the emailed token is consumed.
    expect(await verifyLoginCode(U2, await totpGenerate({ secret: TOTP_SECRET }))).toBe(false);

    const ok = await caller2.mfaConfirm.confirm({ token: tokenFromLastConfirmEmail() });
    expect(ok.success).toBe(true);
    expect(await verifyLoginCode(U2, await totpGenerate({ secret: TOTP_SECRET }))).toBe(true);
    expect(await getMfaRequirement(U2)).toBe("verify");
  });

  it("TOTP re-setup detector: replacing the envelope invalidates the confirmation", async () => {
    const db = await getDb();
    const { verifyLoginCode } = await import("../auth/mfa");
    const { generate: totpGenerate } = await import("otplib");
    // U2's TOTP was confirmed in the previous test. An attacker with a
    // stolen session re-runs totp.setup → the envelope is replaced.
    const attackerSecret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXQ";
    await db!.update(totpSecrets)
      .set({ secret: attackerSecret, updatedAt: new Date() })
      .where(eq(totpSecrets.userId, U2));
    expect(await verifyLoginCode(U2, await totpGenerate({ secret: attackerSecret }))).toBe(false);

    // The legitimate path forward: finalize again → NEW confirmation email.
    const caller2 = rootRouter.createCaller(makeCtxForUser(u2row, { mfaPending: true }));
    const fin = await caller2.mfaConfirm.finalizeTotp();
    expect(fin.status).toBe("confirmation_required");
    const ok = await caller2.mfaConfirm.confirm({ token: tokenFromLastConfirmEmail() });
    expect(ok.success).toBe(true);
    expect(await verifyLoginCode(U2, await totpGenerate({ secret: attackerSecret }))).toBe(true);
  });

  it("subsequent enrollment: auto-confirmed + alert email (fire-and-forget tolerated)", async () => {
    // U1 has a confirmed passkey (first test). Adding TOTP is subsequent.
    const db = await getDb();
    await db!.insert(totpSecrets).values({
      id: `p26-totp-u1-${RUN}`, userId: U1, secret: TOTP_SECRET, status: "active",
      backupCodes: "[]", usedBackupCodes: "[]",
    }).onConflictDoNothing();
    const alertsBefore = mailer.alert.length;
    const fin = await caller1.mfaConfirm.finalizeTotp();
    expect(fin.status).toBe("confirmed");
    const { verifyLoginCode } = await import("../auth/mfa");
    const { generate: totpGenerate } = await import("otplib");
    expect(await verifyLoginCode(U1, await totpGenerate({ secret: TOTP_SECRET }))).toBe(true);
    await new Promise(r => setImmediate(r)); // alert is fire-and-forget
    expect(mailer.alert.length).toBe(alertsBefore + 1);
    const alert = mailer.alert[mailer.alert.length - 1];
    expect(alert.to).toBe(`${U1}@test.local`);
    expect(String(alert.payload.manageUrl)).toContain("/two-factor-auth");
    expect(String(alert.payload.factorLabel)).toContain("TOTP");
  });

  it("resend supersedes the prior token; expired and random tokens fail identically", async () => {
    const db = await getDb();
    await db!.insert(totpSecrets).values({
      id: `p26-totp-u3-${RUN}`, userId: U3, secret: TOTP_SECRET, status: "active",
      backupCodes: "[]", usedBackupCodes: "[]",
    }).onConflictDoNothing();
    const caller3 = rootRouter.createCaller(makeCtxForUser(u3row, { mfaPending: true }));
    await caller3.mfaConfirm.finalizeTotp();
    const firstToken = tokenFromLastConfirmEmail();

    const r = await caller3.mfaConfirm.resend({ factorType: "totp" });
    expect(r.status).toBe("sent");
    const secondToken = tokenFromLastConfirmEmail();
    expect(secondToken).not.toBe(firstToken);

    await expect(caller3.mfaConfirm.confirm({ token: firstToken })).rejects.toMatchObject({
      code: "BAD_REQUEST", message: "This confirmation link is invalid or has expired.",
    });
    expect((await caller3.mfaConfirm.confirm({ token: secondToken })).success).toBe(true);

    // Expired token (force expiry in DB) vs random garbage: identical error.
    await caller3.mfaConfirm.resend({ factorType: "totp" }).catch(() => undefined);
    const thirdToken = tokenFromLastConfirmEmail();
    await db!.update(factorEnrollmentConfirmations)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(factorEnrollmentConfirmations.userId, U3));
    await expect(caller3.mfaConfirm.confirm({ token: thirdToken })).rejects.toMatchObject({
      code: "BAD_REQUEST", message: "This confirmation link is invalid or has expired.",
    });
    await expect(caller3.mfaConfirm.confirm({ token: crypto.randomBytes(32).toString("hex") }))
      .rejects.toMatchObject({
        code: "BAD_REQUEST", message: "This confirmation link is invalid or has expired.",
      });
  });
});
