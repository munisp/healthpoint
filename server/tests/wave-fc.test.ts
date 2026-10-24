/**
 * server/tests/wave-fc.test.ts
 *
 * Phase13-FC (final gap closure) coverage:
 *  1. G6  — NPPES NPI verification (fetch is MOCKED — label: MOCK-VERIFIED):
 *           verified / mismatch / fail-open-unverified / checksum reject,
 *           identity.verifyNpi persists npiVerified + audit row
 *  2. G6b — IDRE certification admin-verify workflow (admin-only, evidence
 *           note, audit-logged)
 *  3. G8  — org suspension: admin suspend/unsuspend with reason + audit;
 *           member mutations blocked while suspended
 *  4. G9  — API-key org scoping: cross-org tenant header rejected, matching
 *           org accepted, legacy (null orgId) keys unaffected
 *  5. G13 — register redirect strips tamperable ?role= (sanitizeRegisterRedirect)
 *  6. G14b— admin TOTP reset: admin+reason, disables + clears backup codes,
 *           audit-logged; non-admin and no-active-TOTP rejected
 *
 * DB access is mocked in-memory (same pattern as wave-fa.test.ts).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";

// ─── In-memory DB mock ───────────────────────────────────────────────────────
type Rows = Record<string, any[]>;
let tables: Rows = {};
const auditRows: any[] = [];
const insertedRows: Record<string, any[]> = {};
const updatedTables: string[] = [];

function seed(table: string, rows: any[]) { tables[table] = rows; }
function tableName(table: any): string {
  return table?.[Symbol.for("drizzle:Name")] ?? table?._?.name ?? "unknown";
}

vi.mock("../db", () => ({
  getDb: async () => ({
    select: () => ({
      from: (table: any) => {
        const rows = tables[tableName(table)] ?? [];
        const q: any = {
          where: () => q,
          orderBy: () => q,
          limit: (n: number) => Promise.resolve(rows.slice(0, n)),
          then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
        };
        return q;
      },
    }),
    insert: (table: any) => ({
      values: (v: any) => {
        const name = tableName(table);
        tables[name] = tables[name] ?? [];
        const rows = Array.isArray(v) ? v : [v];
        tables[name].push(...rows);
        (insertedRows[name] = insertedRows[name] ?? []).push(...rows);
        return {
          onConflictDoUpdate: () => Promise.resolve(),
          returning: () => Promise.resolve(rows),
        };
      },
    }),
    update: (table: any) => {
      updatedTables.push(tableName(table));
      return {
        set: () => ({
          where: () => {
            const w: any = {
              returning: () => Promise.resolve([]),
              then: (resolve: any) => Promise.resolve([]).then(resolve),
            };
            return w;
          },
        }),
      };
    },
    delete: () => ({
      where: () => ({
        returning: () => Promise.resolve([]),
        then: (resolve: any) => Promise.resolve([]).then(resolve),
      }),
    }),
    execute: async () => ({ rows: [] }),
  }),
  getUser: async (id: string) => (tables["users"] ?? []).find(u => u.id === id) ?? null,
  createAuditEntry: async (entry: any) => { auditRows.push(entry); return entry; },
  createNotification: async () => {},
}));

vi.mock("../authz", () => ({ revokeDisputeAccess: async () => {} }));
vi.mock("../search", () => ({ invalidateSearchIndex: vi.fn(async () => {}) }));

import { identityRouter, verifyNpiWithNppes, isValidNpiChecksum } from "../auth/nppes";
import { adminTotpRouter } from "../auth/totp-admin";
import { orgsRouter } from "../routers/personas";
import { authenticateApiKey, BearerAuthError } from "../auth/bearer";
import { sanitizeRegisterRedirect } from "../auth/register-redirect";

function ctxFor(user: { id: string; email?: string | null; role?: string; name?: string }) {
  return {
    user: { role: "user", name: "Test User", email: null, ...user },
    req: undefined,
    res: undefined,
    mfaPending: false,
  } as any;
}

function mockNppesResponse(resultCount: number, orgName = "ACME MEDICAL GROUP") {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      result_count: resultCount,
      results: resultCount > 0 ? [{ number: 1234567893, basic: { organization_name: orgName } }] : [],
    }),
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  tables = {};
  auditRows.length = 0;
  updatedTables.length = 0;
  for (const k of Object.keys(insertedRows)) delete insertedRows[k];
  delete process.env.NPPES_VERIFY_ENABLED;
});

afterEach(() => { vi.unstubAllGlobals(); });

// ─── G6: NPPES verification (fetch MOCKED → MOCK-VERIFIED) ──────────────────
describe("G6 NPPES NPI verification (mocked fetch — MOCK-VERIFIED)", () => {
  it("accepts a valid Luhn checksum NPI and rejects an invalid one", () => {
    expect(isValidNpiChecksum("1234567893")).toBe(true);
    expect(isValidNpiChecksum("1234567890")).toBe(false);
  });

  it("returns 'verified' when the registry returns the NPI", async () => {
    const res = await verifyNpiWithNppes("1234567893", { fetchFn: mockNppesResponse(1) });
    expect(res.status).toBe("verified");
    expect(res.registryName).toBe("ACME MEDICAL GROUP");
  });

  it("returns 'mismatch' when the registry authoritatively has no such NPI", async () => {
    const res = await verifyNpiWithNppes("1234567893", { fetchFn: mockNppesResponse(0) });
    expect(res.status).toBe("mismatch");
    expect(res.warning).toMatch(/not found/i);
  });

  it("returns 'mismatch' when the registry name conflicts with the expected name", async () => {
    const res = await verifyNpiWithNppes("1234567893", { fetchFn: mockNppesResponse(1), expectedName: "Totally Different Clinic" });
    expect(res.status).toBe("mismatch");
  });

  it("fails open with 'unverified' + warning (never fake success) when the registry is unreachable", async () => {
    const failing = vi.fn(async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    const res = await verifyNpiWithNppes("1234567893", { fetchFn: failing });
    expect(res.status).toBe("unverified");
    expect(res.warning).toBeTruthy();
  });

  it("fails open with 'unverified' when NPPES_VERIFY_ENABLED=false", async () => {
    process.env.NPPES_VERIFY_ENABLED = "false";
    const res = await verifyNpiWithNppes("1234567893", { fetchFn: mockNppesResponse(1) });
    expect(res.status).toBe("unverified");
    expect(res.warning).toMatch(/disabled/i);
  });

  it("rejects a bad-checksum NPI without calling the registry", async () => {
    const spy = mockNppesResponse(1);
    await expect(verifyNpiWithNppes("1234567890", { fetchFn: spy })).rejects.toThrow(/checksum/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it("identity.verifyNpi persists npiVerified on the profile and audit-logs", async () => {
    vi.stubGlobal("fetch", mockNppesResponse(1));
    seed("user_profiles", [{ id: "u-prov", npi: "1234567893" }]);
    const caller = identityRouter.createCaller(ctxFor({ id: "u-prov" }));
    const res = await caller.verifyNpi({ npi: "1234567893" });
    expect(res.status).toBe("verified");
    expect(updatedTables).toContain("user_profiles");
    const audit = auditRows.find(a => a.action === "identity.verifyNpi");
    expect(audit).toBeTruthy();
    // never log the full NPI — masked to first 4 digits
    expect(audit.newValue).not.toContain("1234567893");
  });
});

// ─── G6b: IDRE certification admin-verify ────────────────────────────────────
describe("G6b IDRE certification admin-verify workflow", () => {
  it("admin marks a certification verified with an evidence note (audit-logged)", async () => {
    seed("idr_entities", [{ id: "idre-1", certificationNumber: "CMS-001", certificationStatus: "submitted" }]);
    const caller = identityRouter.createCaller(ctxFor({ id: "u-admin", role: "admin" }));
    const res = await caller.verifyIdreCertification({ idrEntityId: "idre-1", evidenceNote: "CMS certification letter reviewed and archived on 2026-09-05" });
    expect(res.certificationStatus).toBe("verified");
    expect(updatedTables).toContain("idr_entities");
    const audit = auditRows.find(a => a.action === "identity.verifyIdreCertification");
    expect(audit).toBeTruthy();
    expect(audit.newValue).toContain("evidenceNote");
  });

  it("rejects non-admin callers", async () => {
    seed("idr_entities", [{ id: "idre-1", certificationStatus: "submitted" }]);
    const caller = identityRouter.createCaller(ctxFor({ id: "u-user", role: "user" }));
    await expect(caller.verifyIdreCertification({ idrEntityId: "idre-1", evidenceNote: "attempted without admin role here" }))
      .rejects.toThrow(/admin/i);
  });
});

// ─── G8: org suspension ──────────────────────────────────────────────────────
describe("G8 org suspension", () => {
  it("admin suspends with reason (audit-logged) and member mutations are blocked", async () => {
    seed("organizations", [{ id: "org-1", name: "Acme", type: "biller", status: "active" }]);
    seed("org_memberships", [{ id: "m1", orgId: "org-1", userId: "u-owner", role: "owner" }]);
    const admin = orgsRouter.createCaller(ctxFor({ id: "u-admin", role: "admin" }));
    const res = await admin.suspendOrg({ orgId: "org-1", reason: "Non-payment hold pending review" });
    expect(res.status).toBe("suspended");
    expect(auditRows.find(a => a.action === "org.suspend")).toBeTruthy();

    // Simulate the now-suspended org for the member mutation
    seed("organizations", [{ id: "org-1", name: "Acme", type: "biller", status: "suspended" }]);
    const owner = orgsRouter.createCaller(ctxFor({ id: "u-owner", role: "user" }));
    await expect(owner.updateBranding({ orgId: "org-1", brandName: "New Name" })).rejects.toThrow(/org_suspended/i);
    await expect(owner.addMember({ orgId: "org-1", userId: "u-2", role: "staff" })).rejects.toThrow(/org_suspended/i);
  });

  it("suspend/unsuspend require admin", async () => {
    seed("organizations", [{ id: "org-1", name: "Acme", type: "biller", status: "active" }]);
    const user = orgsRouter.createCaller(ctxFor({ id: "u-owner", role: "user" }));
    await expect(user.suspendOrg({ orgId: "org-1", reason: "not an admin attempt" })).rejects.toThrow(/admin/i);
  });

  it("unsuspend restores active status (audit-logged)", async () => {
    seed("organizations", [{ id: "org-1", name: "Acme", type: "biller", status: "suspended", suspensionReason: "hold" }]);
    const admin = orgsRouter.createCaller(ctxFor({ id: "u-admin", role: "admin" }));
    const res = await admin.unsuspendOrg({ orgId: "org-1", reason: "Payment received, reinstating" });
    expect(res.status).toBe("active");
    expect(auditRows.find(a => a.action === "org.unsuspend")).toBeTruthy();
  });
});

// ─── G9: API-key org scoping ─────────────────────────────────────────────────
describe("G9 API-key org binding", () => {
  const validKey = "hp_" + "a".repeat(64);
  function seedKey(orgId: string | null) {
    seed("api_keys", [{
      id: "k1", userId: "u-owner", name: "ci", keyHash: createHash("sha256").update(validKey).digest("hex"),
      keyPrefix: "hp_aaaa", scopes: "read,write", orgId, expiresAt: null, revokedAt: null,
    }]);
    seed("users", [{ id: "u-owner", role: "user", suspendedAt: null }]);
  }
  function reqWithOrg(orgId?: string) {
    return { headers: orgId ? { "x-org-id": orgId } : {} } as any;
  }

  it("rejects a cross-org tenant id on an org-bound key", async () => {
    seedKey("org-1");
    await expect(authenticateApiKey(validKey, reqWithOrg("org-2")))
      .rejects.toThrow(/cross_org_tenant_rejected/);
  });

  it("accepts the matching org and exposes orgId on the result", async () => {
    seedKey("org-1");
    const res = await authenticateApiKey(validKey, reqWithOrg("org-1"));
    expect(res.orgId).toBe("org-1");
    expect(res.user.id).toBe("u-owner");
  });

  it("legacy keys (orgId NULL) keep user-scoped behavior", async () => {
    seedKey(null);
    const res = await authenticateApiKey(validKey, reqWithOrg("org-anything"));
    expect(res.orgId).toBeNull();
  });
});

// ─── G13: tamperable ?role= ignored at registration ─────────────────────────
describe("G13 registration ignores client-supplied role", () => {
  it("strips ?role= from register redirect targets", () => {
    expect(sanitizeRegisterRedirect("/dashboard?role=admin")).toBe("/dashboard");
    expect(sanitizeRegisterRedirect("/onboarding?role=idr_entity&foo=bar")).toBe("/onboarding?foo=bar");
    expect(sanitizeRegisterRedirect("")).toBe("/");
    expect(sanitizeRegisterRedirect("/?role=admin")).toBe("/");
  });
});

// ─── G14b: admin TOTP reset ──────────────────────────────────────────────────
describe("G14b admin TOTP reset", () => {
  it("admin resets a user's TOTP with reason (audit-logged)", async () => {
    seed("users", [{ id: "u-target", role: "user", suspendedAt: null }]);
    seed("totp_secrets", [{ id: "t1", userId: "u-target", status: "active", backupCodes: "[]", usedBackupCodes: "[]" }]);
    const admin = adminTotpRouter.createCaller(ctxFor({ id: "u-admin", role: "admin" }));
    const res = await admin.resetUserTotp({ userId: "u-target", reason: "User lost device and backup codes; verified identity via helpdesk call" });
    expect(res.totpStatus).toBe("disabled");
    expect(updatedTables).toContain("totp_secrets");
    const audit = auditRows.find(a => a.action === "totp.adminReset");
    expect(audit).toBeTruthy();
    expect(audit.entityId).toBe("u-target");
  });

  it("rejects non-admin callers", async () => {
    seed("users", [{ id: "u-target", role: "user" }]);
    seed("totp_secrets", [{ id: "t1", userId: "u-target", status: "active" }]);
    const user = adminTotpRouter.createCaller(ctxFor({ id: "u-other", role: "user" }));
    await expect(user.resetUserTotp({ userId: "u-target", reason: "not an admin, attempting reset" })).rejects.toThrow(/admin/i);
  });

  it("rejects when the target has no ACTIVE TOTP enrollment", async () => {
    seed("users", [{ id: "u-target", role: "user" }]);
    seed("totp_secrets", [{ id: "t1", userId: "u-target", status: "disabled" }]);
    const admin = adminTotpRouter.createCaller(ctxFor({ id: "u-admin", role: "admin" }));
    await expect(admin.resetUserTotp({ userId: "u-target", reason: "no active enrollment to reset here" }))
      .rejects.toThrow(/active/i);
  });
});
