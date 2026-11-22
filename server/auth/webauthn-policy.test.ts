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
import { getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

const dbState = vi.hoisted(() => ({
  // table name → canned rows returned for ANY select from that table
  tables: {
    totp_secrets: [] as Array<Record<string, unknown>>,
    webauthn_credentials: [] as Array<Record<string, unknown>>,
    org_settings: [] as Array<Record<string, unknown>>,
    users: [] as Array<Record<string, unknown>>,
  } as Record<string, Array<Record<string, unknown>>>,
  available: true,
}));

vi.mock("../db", () => ({
  getDb: async () => {
    if (!dbState.available) return null;
    function chain(rows: Array<Record<string, unknown>>) {
      const p = Promise.resolve(rows) as Promise<Array<Record<string, unknown>>> & {
        limit: (n: number) => Promise<Array<Record<string, unknown>>>;
      };
      p.limit = (n: number) => Promise.resolve(rows.slice(0, n));
      return p;
    }
    return {
      select: () => ({
        from: (table: PgTable) => ({
          where: () => chain(dbState.tables[getTableName(table)] ?? []),
        }),
      }),
    };
  },
}));

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

beforeEach(() => {
  setState({});
  dbState.available = true;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("getMfaRequirement composition (§5.3)", () => {
  it("TOTP-only → verify (unchanged TOTP-first semantics)", async () => {
    const mfa = await loadMfa({ WEBAUTHN_ENABLED: "true" });
    setState({ totp_secrets: [{ id: "t1" }] });
    expect(await mfa.getMfaRequirement("u1")).toBe("verify");
  });

  it("passkey-only → verify when the feature is enabled", async () => {
    const mfa = await loadMfa({ WEBAUTHN_ENABLED: "true" });
    setState({ webauthn_credentials: [{ id: "c1" }] });
    expect(await mfa.getMfaRequirement("u1")).toBe("verify");
  });

  it("both factors → verify (TOTP stays first; passkey also offered at /mfa)", async () => {
    const mfa = await loadMfa({ WEBAUTHN_ENABLED: "true" });
    setState({ totp_secrets: [{ id: "t1" }], webauthn_credentials: [{ id: "c1" }] });
    expect(await mfa.getMfaRequirement("u1")).toBe("verify");
  });

  it("neither factor, optional tier → none", async () => {
    const mfa = await loadMfa({ WEBAUTHN_ENABLED: "true", WEBAUTHN_ENFORCEMENT: "optional" });
    setState({ users: [{ role: "admin" }] });
    expect(await mfa.getMfaRequirement("u1")).toBe("none");
  });

  it("org requireMFA → enroll (unchanged)", async () => {
    const mfa = await loadMfa({ WEBAUTHN_ENABLED: "true" });
    setState({ org_settings: [{ r: true }] });
    expect(await mfa.getMfaRequirement("u1")).toBe("enroll");
  });

  it("required tier + role in WEBAUTHN_REQUIRED_ROLES, no factors → enroll (§5.2)", async () => {
    const mfa = await loadMfa({
      WEBAUTHN_ENABLED: "true",
      WEBAUTHN_ENFORCEMENT: "required",
      WEBAUTHN_REQUIRED_ROLES: "admin",
    });
    setState({ users: [{ role: "admin" }] });
    expect(await mfa.getMfaRequirement("u1")).toBe("enroll");
  });

  it("required tier does not apply to non-listed roles", async () => {
    const mfa = await loadMfa({
      WEBAUTHN_ENABLED: "true",
      WEBAUTHN_ENFORCEMENT: "required",
      WEBAUTHN_REQUIRED_ROLES: "admin",
    });
    setState({ users: [{ role: "user" }] });
    expect(await mfa.getMfaRequirement("u1")).toBe("none");
  });

  it("required-tier admin WITH a passkey → verify (passkey satisfies the mandate)", async () => {
    const mfa = await loadMfa({
      WEBAUTHN_ENABLED: "true",
      WEBAUTHN_ENFORCEMENT: "required",
      WEBAUTHN_REQUIRED_ROLES: "admin",
    });
    setState({ users: [{ role: "admin" }], webauthn_credentials: [{ id: "c1" }] });
    expect(await mfa.getMfaRequirement("u1")).toBe("verify");
  });

  it("feature OFF + passkey-only → none (fail-safe: passkeys invisible while gated off)", async () => {
    const mfa = await loadMfa({ WEBAUTHN_ENABLED: "false" });
    setState({ webauthn_credentials: [{ id: "c1" }] });
    expect(await mfa.getMfaRequirement("u1")).toBe("none");
  });

  it("DB unavailable fails open (no lockout), per hasActiveTotp precedent", async () => {
    const mfa = await loadMfa({ WEBAUTHN_ENABLED: "true" });
    dbState.available = false;
    expect(await mfa.getMfaRequirement("u1")).toBe("none");
  });
});
