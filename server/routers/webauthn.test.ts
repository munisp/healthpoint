/**
 * Unit tests: server/routers/webauthn.ts ceremonies against recorded
 * known-good vectors (Phase 25, design §8.1).
 *
 * Fixtures: server/routers/fixtures/webauthn/software-authenticator.json —
 * generated once by a scratch script with a software authenticator (Node
 * crypto P-256, attestation fmt "none") and self-verified with the REAL
 * @simplewebauthn/server verify functions before being committed. The
 * SimpleWebAuthn crypto runs for real here — nothing about signature,
 * origin, RP ID, challenge or UV verification is mocked. DB and Redis are
 * in-memory doubles (repo vi.mock convention).
 *
 * Covered:
 *  - full registration ceremony (registrationOptions → verifyRegistration);
 *  - full mfa-mode authentication ceremony with session issuance via the
 *    TOTP-identical path (cookie set on ctx.res);
 *  - wrong-origin / wrong-RPID / challenge-mismatch rejection (library level);
 *  - UV-false assertion rejected (requireUserVerification);
 *  - counter regression → ACCEPTED + anomaly flagged (§4.4 warn-and-audit);
 *  - challenge replay → ceremony_expired; unknown credential → 401;
 *  - WEBAUTHN_ENABLED=false → PRECONDITION_FAILED on every procedure.
 *
 * EXECUTED-VERIFIED (vitest, no network).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// ── Env (vi.hoisted runs BEFORE module imports, so server/_core/env.ts sees it) ──
vi.hoisted(() => {
  process.env.WEBAUTHN_ENABLED = "true";
  process.env.WEBAUTHN_RP_ID = "localhost";
  process.env.WEBAUTHN_ORIGINS = "http://localhost:3000";
  process.env.WEBAUTHN_RP_NAME = "HealthPoint";
  process.env.JWT_SECRET ??= "webauthn-unit-test-secret";
});

const HERE = path.dirname(new URL(import.meta.url).pathname);
const fixtures = JSON.parse(readFileSync(
  path.join(HERE, "fixtures", "webauthn", "software-authenticator.json"), "utf8",
)) as {
  rpId: string;
  origin: string;
  registration: { challenge: string; response: Record<string, unknown> };
  assertion: { challenge: string; storedCounter: number; response: Record<string, unknown> };
  assertionCounterRegression: { challenge: string; storedCounter: number; response: Record<string, unknown> };
  assertionUvFalse: { challenge: string; storedCounter: number; response: Record<string, unknown> };
  credential: { credentialId: string; publicKeyCose: string; transports: string[] };
};

// ── In-memory Redis double ───────────────────────────────────────────────────
const redisState = vi.hoisted(() => ({
  store: new Map<string, string>(),
}));

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
    set: async (key: string, value: string, ..._rest: unknown[]) => {
      redisState.store.set(key, value);
      return "OK";
    },
    get: async (key: string) => redisState.store.get(key) ?? null,
  };
  return {
    getRedisClient: () => client,
    sessionSet: async (key: string, value: string, _ttl?: number) => {
      redisState.store.set(`session:${key}`, value);
    },
    sessionGet: async (key: string) => redisState.store.get(`session:${key}`) ?? null,
    sessionDel: async (key: string) => { redisState.store.delete(`session:${key}`); },
  };
});

// ── In-memory DB double (single webauthn_credentials table) ─────────────────
const dbState = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
}));

vi.mock("../db", () => {
  function chain(rows: Array<Record<string, unknown>>) {
    const p = Promise.resolve(rows) as Promise<Array<Record<string, unknown>>> & {
      limit: (n: number) => Promise<Array<Record<string, unknown>>>;
    };
    p.limit = (n: number) => Promise.resolve(rows.slice(0, n));
    return p;
  }
  const db = {
    select: () => ({
      from: () => ({
        where: () => chain([...dbState.rows]),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        dbState.rows.push(v);
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: (o: Record<string, unknown>) => ({
        where: () => {
          if (dbState.rows[0]) Object.assign(dbState.rows[0], o);
          return Promise.resolve();
        },
      }),
    }),
    delete: () => ({
      where: () => {
        dbState.rows.length = 0;
        return Promise.resolve();
      },
    }),
  };
  return {
    getDb: async () => db,
    createAuditEntry: async (entry: Record<string, unknown>) => {
      dbState.audits.push(entry);
      return entry;
    },
  };
});

// No TOTP for the fixture user (passkey-only paths); verifyLoginCode unused.
vi.mock("../auth/mfa", () => ({
  hasActiveTotp: async () => false,
  orgRequiresMfa: async () => false,
  verifyLoginCode: async () => false,
}));

import { verifyRegistrationResponse, verifyAuthenticationResponse } from "@simplewebauthn/server";
import { webauthnRouter } from "./webauthn";

const USER = { id: "wa-user-1", name: "WA User", email: "wa@test.local", role: "user" } as never;

function makeCtx(mfaPending: boolean) {
  const cookies: Array<{ name: string; value: string; opts: unknown }> = [];
  return {
    ctx: {
      user: USER,
      mfaPending,
      viaApiKey: false,
      apiKeyScopes: [],
      req: { headers: { "x-forwarded-for": "203.0.113.7", "user-agent": "vitest" }, ip: "203.0.113.7" },
      res: {
        cookie: (name: string, value: string, opts: unknown) => { cookies.push({ name, value, opts }); },
        clearCookie: () => undefined,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    cookies,
  };
}

/** Point the stored challenge for `ceremonyId` at the fixture's challenge. */
function plantChallenge(ceremonyId: string, challenge: string, userId: string | null, mode: string) {
  redisState.store.set(
    `session:webauthn-chal:${ceremonyId}`,
    JSON.stringify({ challenge, userId, mode }),
  );
}

function seedCredentialRow(counter = 0) {
  dbState.rows.length = 0;
  dbState.rows.push({
    id: "cred-row-1",
    userId: "wa-user-1",
    credentialId: Buffer.from(fixtures.credential.credentialId, "base64url"),
    publicKey: Buffer.from(fixtures.credential.publicKeyCose, "base64url"),
    counter,
    transports: JSON.stringify(fixtures.credential.transports),
    aaguid: "00000000-0000-0000-0000-000000000000",
    name: "Passkey",
    backedUp: false,
    deviceType: "singleDevice",
    createdAt: new Date(),
    lastUsedAt: null,
    lastCounterAnomalyAt: null,
  });
}

beforeEach(() => {
  redisState.store.clear();
  dbState.rows.length = 0;
  dbState.audits.length = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("registration ceremony (router level)", () => {
  it("registrationOptions → verifyRegistration inserts the credential row and audits", async () => {
    const { ctx } = makeCtx(false);
    const caller = webauthnRouter.createCaller(ctx);
    const opts = await caller.registrationOptions({ name: "Clinic key" });
    expect(opts.ceremonyId).toBeTruthy();
    expect(opts.options.rp.id).toBe("localhost");
    expect(opts.options.userVerification ?? opts.options.authenticatorSelection?.userVerification).toBe("required");

    plantChallenge(opts.ceremonyId, fixtures.registration.challenge, "wa-user-1", "registration");
    const res = await caller.verifyRegistration({
      ceremonyId: opts.ceremonyId,
      name: "Clinic key",
      response: fixtures.registration.response,
    });
    expect(res.success).toBe(true);
    expect(dbState.rows.length).toBe(1);
    expect(dbState.rows[0].userId).toBe("wa-user-1");
    expect((dbState.rows[0].credentialId as Buffer).toString("base64url")).toBe(fixtures.credential.credentialId);
    expect(dbState.audits.some(a => a.action === "webauthn.register")).toBe(true);
  });

  it("rejects a registration response whose challenge does not match", async () => {
    const { ctx } = makeCtx(false);
    const caller = webauthnRouter.createCaller(ctx);
    const opts = await caller.registrationOptions(undefined);
    // Stored challenge left as the one generateRegistrationOptions created —
    // the fixture embeds a DIFFERENT challenge → mismatch.
    await expect(caller.verifyRegistration({
      ceremonyId: opts.ceremonyId,
      response: fixtures.registration.response,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(dbState.rows.length).toBe(0);
  });
});

describe("authentication ceremony (router level)", () => {
  it("mfa-mode assertion upgrades an mfa-pending session via the TOTP-identical path", async () => {
    seedCredentialRow(0);
    const { ctx, cookies } = makeCtx(true);
    const caller = webauthnRouter.createCaller(ctx);
    const opts = await caller.authenticationOptions({ ceremony: "mfa" });
    expect(opts.options.allowCredentials?.length).toBe(1);
    plantChallenge(opts.ceremonyId, fixtures.assertion.challenge, "wa-user-1", "mfa");

    const res = await caller.verifyAuthentication({
      ceremonyId: opts.ceremonyId,
      response: fixtures.assertion.response,
    });
    expect(res).toEqual({ success: true, sessionIssued: true });
    // Session cookie issued through createSessionToken path (httpOnly, path /).
    expect(cookies.length).toBe(1);
    expect(cookies[0].opts).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    // Counter + lastUsedAt updated.
    expect(dbState.rows[0].counter).toBe(1);
    expect(dbState.rows[0].lastUsedAt).toBeTruthy();
    expect(dbState.audits.some(a => a.action === "webauthn.authenticate")).toBe(true);
    // Step-up marker recorded for §3.6 passkey-only deleteCredential.
    expect(redisState.store.get("session:webauthn-stepup:wa-user-1")).toBe(opts.ceremonyId);
  });

  it("rejects a replayed ceremonyId (single-use GETDEL)", async () => {
    seedCredentialRow(0);
    const { ctx } = makeCtx(true);
    const caller = webauthnRouter.createCaller(ctx);
    const opts = await caller.authenticationOptions({ ceremony: "mfa" });
    plantChallenge(opts.ceremonyId, fixtures.assertion.challenge, "wa-user-1", "mfa");
    await caller.verifyAuthentication({ ceremonyId: opts.ceremonyId, response: fixtures.assertion.response });
    // Replay: the challenge was consumed atomically.
    await expect(caller.verifyAuthentication({
      ceremonyId: opts.ceremonyId,
      response: fixtures.assertion.response,
    })).rejects.toMatchObject({ code: "UNAUTHORIZED", message: "ceremony_expired" });
  });

  it("rejects an assertion for an unknown credential (generic 401)", async () => {
    seedCredentialRow(0);
    dbState.rows.length = 0; // no credential registered
    const { ctx } = makeCtx(true);
    const caller = webauthnRouter.createCaller(ctx);
    const opts = await caller.authenticationOptions({ ceremony: "mfa" });
    plantChallenge(opts.ceremonyId, fixtures.assertion.challenge, "wa-user-1", "mfa");
    await expect(caller.verifyAuthentication({
      ceremonyId: opts.ceremonyId,
      response: fixtures.assertion.response,
    })).rejects.toMatchObject({ code: "UNAUTHORIZED", message: "authentication_failed" });
    expect(dbState.audits.some(a => a.action === "webauthn.authenticateFailed"
      && String(a.newValue).includes("unknown_credential"))).toBe(true);
  });

  it("rejects an mfa-mode ceremony swapped to a different user (binding check)", async () => {
    seedCredentialRow(0);
    const { ctx } = makeCtx(true);
    const caller = webauthnRouter.createCaller(ctx);
    const opts = await caller.authenticationOptions({ ceremony: "mfa" });
    // Challenge bound to a DIFFERENT user than the credential owner/caller.
    plantChallenge(opts.ceremonyId, fixtures.assertion.challenge, "someone-else", "mfa");
    await expect(caller.verifyAuthentication({
      ceremonyId: opts.ceremonyId,
      response: fixtures.assertion.response,
    })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("counter regression is ACCEPTED and flagged (§4.4 warn-and-audit, never reject)", async () => {
    seedCredentialRow(1); // stored counter already 1
    const { ctx, cookies } = makeCtx(true);
    const caller = webauthnRouter.createCaller(ctx);
    const opts = await caller.authenticationOptions({ ceremony: "mfa" });
    plantChallenge(opts.ceremonyId, fixtures.assertionCounterRegression.challenge, "wa-user-1", "mfa");
    const res = await caller.verifyAuthentication({
      ceremonyId: opts.ceremonyId,
      response: fixtures.assertionCounterRegression.response,
    });
    expect(res.success).toBe(true);
    expect(dbState.rows[0].lastCounterAnomalyAt).toBeTruthy();
    expect(dbState.audits.some(a => a.action === "webauthn.counterAnomaly")).toBe(true);
    expect(cookies.length).toBe(1);
  });

  it("rejects a UV-false assertion (requireUserVerification, §4.3)", async () => {
    seedCredentialRow(0);
    const { ctx } = makeCtx(true);
    const caller = webauthnRouter.createCaller(ctx);
    const opts = await caller.authenticationOptions({ ceremony: "mfa" });
    plantChallenge(opts.ceremonyId, fixtures.assertionUvFalse.challenge, "wa-user-1", "mfa");
    await expect(caller.verifyAuthentication({
      ceremonyId: opts.ceremonyId,
      response: fixtures.assertionUvFalse.response,
    })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("discoverable mode is PRECONDITION_FAILED while WEBAUTHN_PASSWORDLESS_ENABLED=false", async () => {
    const { ctx } = makeCtx(false);
    ctx.user = null;
    const caller = webauthnRouter.createCaller(ctx);
    await expect(caller.authenticationOptions({ ceremony: "discoverable" }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "webauthn_passwordless_disabled" });
  });
});

describe("library-level rejection vectors (real SimpleWebAuthn crypto)", () => {
  const cred = {
    id: fixtures.credential.credentialId,
    publicKey: new Uint8Array(Buffer.from(fixtures.credential.publicKeyCose, "base64url")),
    counter: 0,
    transports: ["internal" as const],
  };

  it("wrong origin is rejected (registration)", async () => {
    await expect(verifyRegistrationResponse({
      response: fixtures.registration.response as never,
      expectedChallenge: fixtures.registration.challenge,
      expectedOrigin: "https://evil.example",
      expectedRPID: fixtures.rpId,
      requireUserVerification: true,
    })).rejects.toThrow();
  });

  it("wrong RP ID is rejected (assertion)", async () => {
    await expect(verifyAuthenticationResponse({
      response: fixtures.assertion.response as never,
      expectedChallenge: fixtures.assertion.challenge,
      expectedOrigin: fixtures.origin,
      expectedRPID: "evil.example",
      requireUserVerification: true,
      credential: cred,
    })).rejects.toThrow();
  });

  it("challenge mismatch is rejected (assertion)", async () => {
    await expect(verifyAuthenticationResponse({
      response: fixtures.assertion.response as never,
      expectedChallenge: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      expectedOrigin: fixtures.origin,
      expectedRPID: fixtures.rpId,
      requireUserVerification: true,
      credential: cred,
    })).rejects.toThrow();
  });

  it("UV-false assertion is rejected at the library level too", async () => {
    await expect(verifyAuthenticationResponse({
      response: fixtures.assertionUvFalse.response as never,
      expectedChallenge: fixtures.assertionUvFalse.challenge,
      expectedOrigin: fixtures.origin,
      expectedRPID: fixtures.rpId,
      requireUserVerification: true,
      credential: cred,
    })).rejects.toThrow();
  });
});
