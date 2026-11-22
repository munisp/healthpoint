/**
 * server/tests/impersonation-revocation.test.ts
 *
 * Phase 24 (F4): impersonation tokens carry a jti and can be revoked
 * server-side via the same Redis blocklist as session tokens. The Redis
 * module is mocked at the boundary with an in-memory set (no Redis in CI —
 * the repo's vi.mock("../db") convention, wave-w5); the revocation logic
 * under test (impersonation.ts) is real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── In-memory Redis boundary (revocation blocklist) ─────────────────────────
const revoked = new Set<string>();
vi.mock("../redis", () => ({
  revokeToken: async (jti: string, _ttl: number) => { revoked.add(jti); },
  isTokenRevoked: async (jti: string) => revoked.has(jti),
}));

// ── DB boundary: one target user row; capture audit writes ──────────────────
const auditRows: Array<Record<string, unknown>> = [];
vi.mock("../db", () => ({
  getDb: async () => ({
    select: (cols?: unknown) => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => [{ id: "target-1", name: "Target User", role: "user" }],
        }),
      }),
    }),
  }),
  createAuditEntry: async (entry: Record<string, unknown>) => { auditRows.push(entry); return entry; },
}));

import {
  impersonationRouter,
  issueImpersonationToken,
  verifyImpersonationToken,
  revokeImpersonationToken,
} from "../impersonation";

process.env.JWT_SECRET = "p24-impersonation-test-secret";

function callerCtx(role: "admin" | "user" = "admin") {
  return {
    user: { id: "admin-1", name: "Admin", email: "a@example.com", role } as never,
    req: { headers: {} },
    res: {},
    mfaPending: false,
    viaApiKey: false,
    apiKeyScopes: [],
  } as never;
}

beforeEach(() => {
  revoked.clear();
  auditRows.length = 0;
});

describe("impersonation token revocation (F4)", () => {
  it("issues tokens with a unique jti", async () => {
    const t1 = await issueImpersonationToken({ impersonatorId: "a", targetId: "b", purpose: "impersonation" });
    const t2 = await issueImpersonationToken({ impersonatorId: "a", targetId: "b", purpose: "impersonation" });
    const c1 = await verifyImpersonationToken(t1);
    const c2 = await verifyImpersonationToken(t2);
    expect(c1?.jti).toBeTruthy();
    expect(c2?.jti).toBeTruthy();
    expect(c1!.jti).not.toBe(c2!.jti);
  });

  it("a revoked token no longer verifies", async () => {
    const token = await issueImpersonationToken({ impersonatorId: "a", targetId: "b", purpose: "impersonation" });
    const claims = await verifyImpersonationToken(token);
    expect(claims).not.toBeNull();
    await revokeImpersonationToken(claims!);
    expect(await verifyImpersonationToken(token)).toBeNull();
  });

  it("revoking one token does not affect another", async () => {
    const t1 = await issueImpersonationToken({ impersonatorId: "a", targetId: "b", purpose: "impersonation" });
    const t2 = await issueImpersonationToken({ impersonatorId: "a", targetId: "b", purpose: "impersonation" });
    await revokeImpersonationToken((await verifyImpersonationToken(t1))!);
    expect(await verifyImpersonationToken(t1)).toBeNull();
    expect(await verifyImpersonationToken(t2)).not.toBeNull();
  });

  it("impersonation.endActive lets an admin kill a live token and audits it", async () => {
    const caller = impersonationRouter.createCaller(callerCtx("admin"));
    const { token } = await caller.start({ userId: "target-1", reason: "P24 test: investigating a support case" });
    expect(await verifyImpersonationToken(token)).not.toBeNull();
    await caller.endActive({ token });
    expect(await verifyImpersonationToken(token)).toBeNull();
    const actions = auditRows.map(r => r.action);
    expect(actions).toContain("impersonate.start");
    expect(actions).toContain("impersonate.revoke");
  });

  it("impersonation.endActive rejects non-admins", async () => {
    const adminCaller = impersonationRouter.createCaller(callerCtx("admin"));
    const { token } = await adminCaller.start({ userId: "target-1", reason: "P24 test: investigating a support case" });
    const userCaller = impersonationRouter.createCaller(callerCtx("user"));
    await expect(userCaller.endActive({ token })).rejects.toThrow(/Admin access required/);
    // token still live after the rejected attempt
    expect(await verifyImpersonationToken(token)).not.toBeNull();
  });

  it("impersonation.endActive 404s on an already-revoked token", async () => {
    const caller = impersonationRouter.createCaller(callerCtx("admin"));
    const { token } = await caller.start({ userId: "target-1", reason: "P24 test: investigating a support case" });
    await caller.endActive({ token });
    await expect(caller.endActive({ token })).rejects.toThrow(/expired, invalid, or already revoked/);
  });

  it("impersonation.end revokes the token it ends", async () => {
    const caller = impersonationRouter.createCaller(callerCtx("admin"));
    const { token } = await caller.start({ userId: "target-1", reason: "P24 test: investigating a support case" });
    await caller.end({ token });
    expect(await verifyImpersonationToken(token)).toBeNull();
  });
});
