/**
 * Phase 25 wave test (live PG, DATABASE_URL-gated): WebAuthn / passkeys for
 * staff authentication (binding design: phase-25-webauthn-design.md).
 *
 *  - migration 0059 applied: webauthn_credentials + both indexes present;
 *  - full register → list → authenticate → rename → delete cycle through the
 *    REAL rootRouter caller with REAL SimpleWebAuthn verification of the
 *    committed software-authenticator fixtures (no crypto mocking);
 *  - last-factor guard rejection (§3.6 step 4);
 *  - impersonation block on the four management paths (§5.5);
 *  - WEBAUTHN_ENABLED=false → ceremony/management procedures
 *    PRECONDITION_FAILED (§5.1), status answers { enabled:false }.
 *
 * Redis is an in-memory double (the sandbox has no Redis server — same
 * sanctioned limitation as the baseline redis-connectivity test failures);
 * Postgres is REAL. EXECUTED-VERIFIED when DATABASE_URL is set; skipped
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
  process.env.JWT_SECRET ??= "wave-p25-test-secret";
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

import "../journeys/env-defaults";
import { eq, sql } from "drizzle-orm";
import { rootRouter } from "../app-router";
import { makeCtxForUser } from "../journeys/framework";
import { getDb } from "../db";
import { users as usersTable, orgSettings } from "../../drizzle/schema";
import { webauthnCredentials } from "../../drizzle/schema-webauthn";
import { issueImpersonationToken } from "../impersonation";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const fixtures = JSON.parse(readFileSync(
  path.join(HERE, "fixtures", "webauthn", "software-authenticator.json"), "utf8",
)) as {
  registration: { challenge: string; response: Record<string, unknown> };
  assertion: { challenge: string; storedCounter: number; response: Record<string, unknown> };
  credential: { credentialId: string; publicKeyCose: string; transports: string[] };
};

const HAS_DB = Boolean(process.env.DATABASE_URL);
const RUN = Date.now().toString(36);
const U1 = `p25-u1-${RUN}`;
const U2 = `p25-u2-${RUN}`;
const ADMIN = `p25-admin-${RUN}`;

function plantChallenge(ceremonyId: string, challenge: string, userId: string | null, mode: string) {
  redisState.store.set(
    `session:webauthn-chal:${ceremonyId}`,
    JSON.stringify({ challenge, userId, mode }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe.skipIf(!HAS_DB)("Phase25 WebAuthn/passkeys (live PG)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let u1row: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let u2row: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let adminRow: any;
  let caller: ReturnType<typeof rootRouter.createCaller>;

  beforeAll(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = await getDb();
    expect(db).toBeTruthy();
    for (const [id, name, role] of [
      [U1, "P25 User One", "user"],
      [U2, "P25 User Two", "user"],
      [ADMIN, "P25 Admin", "admin"],
    ] as const) {
      await db!.insert(usersTable)
        .values({ id, name, email: `${id}@test.local`, loginMethod: "test", role })
        .onConflictDoNothing();
    }
    [u1row] = await db!.select().from(usersTable).where(eq(usersTable.id, U1)).limit(1);
    [u2row] = await db!.select().from(usersTable).where(eq(usersTable.id, U2)).limit(1);
    [adminRow] = await db!.select().from(usersTable).where(eq(usersTable.id, ADMIN)).limit(1);
    // Idempotent re-runs: the committed fixture has a FIXED credential ID and
    // credential_id is globally unique — clear leftovers from prior runs.
    await db!.delete(webauthnCredentials).where(
      eq(webauthnCredentials.credentialId, Buffer.from(fixtures.credential.credentialId, "base64url")),
    );
    caller = rootRouter.createCaller(makeCtxForUser(u1row));
  });

  it("migration 0059 applied: table + both indexes exist", async () => {
    const db = await getDb();
    const t = await db!.execute(sql`SELECT to_regclass('webauthn_credentials') AS r`);
    expect((t.rows ?? t)[0].r).toBe("webauthn_credentials");
    const idx = await db!.execute(sql`
      SELECT indexname FROM pg_indexes WHERE tablename = 'webauthn_credentials'`);
    const names = (idx.rows ?? idx).map((r: { indexname: string }) => r.indexname);
    expect(names).toContain("webauthn_credentials_cred_uniq");
    expect(names).toContain("webauthn_credentials_user_idx");
  });

  it("full cycle: register → list → authenticate → rename → delete", async () => {
    // register
    const regOpts = await caller.webauthn.registrationOptions({ name: "Clinic key" });
    expect(regOpts.options.rp.id).toBe("localhost");
    plantChallenge(regOpts.ceremonyId, fixtures.registration.challenge, U1, "registration");
    const reg = await caller.webauthn.verifyRegistration({
      ceremonyId: regOpts.ceremonyId,
      name: "Clinic key",
      response: fixtures.registration.response,
    });
    expect(reg.success).toBe(true);

    // list
    const list = await caller.webauthn.listCredentials();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe("Clinic key");
    expect(list[0].deviceType).toBe("singleDevice");
    const status = await caller.webauthn.status();
    expect(status.enabled).toBe(true);
    expect(status.credentials.length).toBe(1);
    expect(status.hasTotp).toBe(false);

    // authenticate (mfa-pending upgrade, real signature verification)
    const mfaCtx = makeCtxForUser(u1row, { mfaPending: true });
    const mfaCaller = rootRouter.createCaller(mfaCtx);
    const authOpts = await mfaCaller.webauthn.authenticationOptions({ ceremony: "mfa" });
    expect(authOpts.options.allowCredentials?.length).toBe(1);
    plantChallenge(authOpts.ceremonyId, fixtures.assertion.challenge, U1, "mfa");
    const auth = await mfaCaller.webauthn.verifyAuthentication({
      ceremonyId: authOpts.ceremonyId,
      response: fixtures.assertion.response,
    });
    expect(auth).toEqual({ success: true, sessionIssued: true });
    const db = await getDb();
    const [row] = await db!.select().from(webauthnCredentials)
      .where(eq(webauthnCredentials.id, reg.credentialId)).limit(1);
    expect(row.counter).toBe(1);
    expect(row.lastUsedAt).toBeTruthy();

    // rename
    await caller.webauthn.renameCredential({ credentialId: reg.credentialId, name: "Renamed key" });
    const renamed = await caller.webauthn.listCredentials();
    expect(renamed[0].name).toBe("Renamed key");

    // delete (passkey-only: step-up marker + x-webauthn-stepup header)
    const stepupId = crypto.randomUUID();
    redisState.store.set(`session:webauthn-stepup:${U1}`, stepupId);
    const delCtx = makeCtxForUser(u1row, {
      req: { headers: { "x-webauthn-stepup": stepupId } } as never,
    });
    const delCaller = rootRouter.createCaller(delCtx);
    const del = await delCaller.webauthn.deleteCredential({ credentialId: reg.credentialId });
    expect(del.success).toBe(true);
    expect(await caller.webauthn.listCredentials()).toEqual([]);
    // step-up marker was single-use
    expect(redisState.store.get(`session:webauthn-stepup:${U1}`)).toBeUndefined();
  });

  it("ownership: another user cannot see/rename/delete the credential (NOT_FOUND)", async () => {
    // re-register for U1
    const regOpts = await caller.webauthn.registrationOptions(undefined);
    plantChallenge(regOpts.ceremonyId, fixtures.registration.challenge, U1, "registration");
    const reg = await caller.webauthn.verifyRegistration({
      ceremonyId: regOpts.ceremonyId, response: fixtures.registration.response,
    });
    const outsider = rootRouter.createCaller(makeCtxForUser(u2row));
    expect(await outsider.webauthn.listCredentials()).toEqual([]);
    await expect(outsider.webauthn.renameCredential({ credentialId: reg.credentialId, name: "x" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(outsider.webauthn.deleteCredential({ credentialId: reg.credentialId, totpCode: "123456" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("last-factor guard: org requireMFA + sole passkey → cannot_remove_last_mfa_method", async () => {
    const db = await getDb();
    await db!.insert(orgSettings).values({ id: `p25-orgset-${RUN}`, userId: U2, requireMFA: true }).onConflictDoNothing();
    const credId = `p25-cred-${RUN}`;
    await db!.insert(webauthnCredentials).values({
      id: credId,
      userId: U2,
      credentialId: crypto.randomBytes(32),
      publicKey: crypto.randomBytes(77),
      counter: 0,
      name: "Sole key",
    });
    const stepupId = crypto.randomUUID();
    redisState.store.set(`session:webauthn-stepup:${U2}`, stepupId);
    const u2Caller = rootRouter.createCaller(makeCtxForUser(u2row, {
      req: { headers: { "x-webauthn-stepup": stepupId } } as never,
    }));
    await expect(u2Caller.webauthn.deleteCredential({ credentialId: credId }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "cannot_remove_last_mfa_method" });
    // And the credential survived.
    const still = await u2Caller.webauthn.listCredentials();
    expect(still.length).toBe(1);
  });

  it("impersonation blocks the four management paths (§5.5)", async () => {
    const token = await issueImpersonationToken({
      impersonatorId: ADMIN, targetId: U1, purpose: "impersonation",
    });
    const impCtx = makeCtxForUser(adminRow, {
      req: { headers: { "x-impersonation-token": token } } as never,
    });
    const imp = rootRouter.createCaller(impCtx);
    await expect(imp.webauthn.registrationOptions(undefined))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(imp.webauthn.verifyRegistration({
      ceremonyId: crypto.randomUUID(), response: {},
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(imp.webauthn.renameCredential({ credentialId: "x", name: "y" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(imp.webauthn.deleteCredential({ credentialId: "x" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("WEBAUTHN_ENABLED=false → procedures PRECONDITION_FAILED; status answers enabled:false", async () => {
    process.env.WEBAUTHN_ENABLED = "false";
    vi.resetModules();
    try {
      const { webauthnRouter: gated } = await import("./webauthn");
      const gatedCaller = gated.createCaller(makeCtxForUser(u1row));
      await expect(gatedCaller.listCredentials())
        .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "webauthn_disabled" });
      await expect(gatedCaller.registrationOptions(undefined))
        .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      await expect(gatedCaller.authenticationOptions({ ceremony: "mfa" }))
        .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      await expect(gatedCaller.verifyAuthentication({ ceremonyId: crypto.randomUUID(), response: {} }))
        .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      await expect(gatedCaller.renameCredential({ credentialId: "x", name: "y" }))
        .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      await expect(gatedCaller.deleteCredential({ credentialId: "x" }))
        .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      // status is the documented exception: it answers so the UI can hide.
      const st = await gatedCaller.status();
      expect(st.enabled).toBe(false);
      expect(st.credentials).toEqual([]);
    } finally {
      process.env.WEBAUTHN_ENABLED = "true";
      vi.resetModules();
    }
  });
});
