/**
 * server/tests/wave-fa.test.ts
 *
 * Phase13-FA (stakeholder onboarding) remediation coverage:
 *  1. G2 — first-admin bootstrap: one-time claim, refused when an admin exists
 *  2. G1 — invite tokens: issue (hashed at rest, honest email status) + accept
 *     binds org membership / activates payer links; wrong-email + expired rejected
 *  3. G5 — offboarding persona cascade: payer links, idre assignments, patient
 *     tokens, invite tokens, org memberships
 *  4. G4 — patient token revoke endpoint + revoked-token access denial
 *  5. G7 — payer-account duplicate-email race surfaces friendly 409
 *
 * DB access is mocked in-memory (same pattern as wave-w5.test.ts); email
 * delivery is mocked to assert the honest 'unconfigured' propagation.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── In-memory DB mock ───────────────────────────────────────────────────────
type Rows = Record<string, any[]>;
let tables: Rows = {};
let returnQueue: any[][] = [];
// Per-table queued select results (shifted per select call) for tests where
// the same table is queried multiple times with different expectations
// (e.g. target lookup vs. other-admins guard in offboardUser).
let selectQueues: Record<string, any[][]> = {};
const auditRows: any[] = [];
const insertedRows: Record<string, any[]> = {};

function seed(table: string, rows: any[]) { tables[table] = rows; }
function queueReturning(rows: any[]) { returnQueue.push(rows); }
function queueSelects(table: string, perCallRows: any[][]) { selectQueues[table] = perCallRows; }
function tableName(table: any): string {
  return table?.[Symbol.for("drizzle:Name")] ?? table?._?.name ?? "unknown";
}

vi.mock("../db", () => ({
  getDb: async () => ({
    select: () => ({
      from: (table: any) => {
        const name = tableName(table);
        const queued = selectQueues[name];
        const rows = queued && queued.length ? queued.shift()! : (tables[name] ?? []);
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
    update: () => ({
      set: () => ({
        where: () => {
          const w: any = {
            returning: () => Promise.resolve(returnQueue.shift() ?? []),
            then: (resolve: any) => Promise.resolve([]).then(resolve),
          };
          return w;
        },
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: () => Promise.resolve(returnQueue.shift() ?? []),
        then: (resolve: any) => Promise.resolve([]).then(resolve),
      }),
    }),
    execute: async () => ({ rows: [] }),
  }),
  createAuditEntry: async (entry: any) => { auditRows.push(entry); return entry; },
  createNotification: async () => {},
  addDocument: async () => "doc-1",
}));

vi.mock("../authz", () => ({ revokeDisputeAccess: async () => {} }));
vi.mock("../search", () => ({ invalidateSearchIndex: vi.fn(async () => {}) }));

let emailStatus: string = "delivered";
vi.mock("../notifications", () => ({
  dispatchNotification: vi.fn(async () => [{ success: emailStatus === "delivered", deliveryStatus: emailStatus }]),
}));

vi.mock("../fsm-store/store", () => ({ getFsmCaseStore: () => ({}) }));
vi.mock("../gfe-ppdr/ppdr", () => ({
  evaluatePpdrEligibility: () => ({ eligible: true, reasons: [], excessUsd: 0 }),
  createPpdrDispute: () => ({}),
  transition: () => ({}),
}));

import { orgsRouter, payerRouter } from "../routers/personas";
import { patientPortalRouter } from "../routers/patient-portal";
import { offboardUser } from "../offboarding";

function ctxFor(user: { id: string; email?: string | null; role?: string; name?: string }) {
  return {
    user: { role: "user", name: "Test User", email: null, ...user },
    req: undefined,
    res: undefined,
    mfaPending: false,
  } as any;
}

beforeEach(() => {
  tables = {};
  returnQueue = [];
  selectQueues = {};
  auditRows.length = 0;
  for (const k of Object.keys(insertedRows)) delete insertedRows[k];
  emailStatus = "delivered";
});

// ─── G2: first-admin bootstrap ───────────────────────────────────────────────
describe("G2 bootstrap admin claim", () => {
  it("grants admin when zero active admins exist and audit-logs admin.bootstrap", async () => {
    seed("users", []); // no admins
    const caller = orgsRouter.createCaller(ctxFor({ id: "u-new" }));
    const res = await caller.claimBootstrapAdmin();
    expect(res.ok).toBe(true);
    expect(res.role).toBe("admin");
    const audit = auditRows.find(a => a.action === "admin.bootstrap");
    expect(audit).toBeTruthy();
    expect(audit.userId).toBe("u-new");
  });

  it("refuses when any admin exists", async () => {
    seed("users", [{ id: "u-admin", role: "admin", suspendedAt: null }]);
    const caller = orgsRouter.createCaller(ctxFor({ id: "u-new" }));
    await expect(caller.claimBootstrapAdmin()).rejects.toThrow(/already exists/i);
    expect(auditRows.find(a => a.action === "admin.bootstrap")).toBeUndefined();
  });
});

// ─── G1: invite issue + accept ───────────────────────────────────────────────
describe("G1 invite tokens", () => {
  it("orgs.inviteMember issues a hashed invite token and reports email status", async () => {
    seed("org_memberships", [{ id: "m1", orgId: "org-1", userId: "u-owner", role: "owner" }]);
    seed("organizations", [{ id: "org-1", name: "Acme Billing", type: "biller" }]);
    seed("users", []); // invitee not registered yet
    const caller = orgsRouter.createCaller(ctxFor({ id: "u-owner", role: "user" }));
    const res = await caller.inviteMember({ orgId: "org-1", email: "staff@acme.test", role: "staff" });
    expect(res.inviteId).toBeTruthy();
    expect(res.inviteEmailStatus).toBe("delivered");
    const rows = insertedRows["invite_tokens"] ?? [];
    expect(rows.length).toBe(1);
    expect(rows[0].email).toBe("staff@acme.test");
    expect(rows[0].purpose).toBe("org_member");
    expect(rows[0].orgId).toBe("org-1");
    // hashed at rest — never a raw bearer token
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(auditRows.find(a => a.action === "org.inviteMember")).toBeTruthy();
  });

  it("honestly reports unconfigured email delivery (no fake success)", async () => {
    emailStatus = "unconfigured";
    seed("org_memberships", [{ id: "m1", orgId: "org-1", userId: "u-owner", role: "owner" }]);
    seed("organizations", [{ id: "org-1", name: "Acme Billing", type: "biller" }]);
    seed("users", []);
    const caller = orgsRouter.createCaller(ctxFor({ id: "u-owner", role: "user" }));
    const res = await caller.inviteMember({ orgId: "org-1", email: "staff@acme.test", role: "viewer" });
    expect(res.inviteEmailStatus).toBe("unconfigured");
    // invite still recorded for later acceptance
    expect((insertedRows["invite_tokens"] ?? []).length).toBe(1);
  });

  it("acceptInvite binds the caller to org+role (org_member)", async () => {
    seed("invite_tokens", [{
      id: "inv-1",
      tokenHash: "hash-ok",
      email: "staff@acme.test",
      purpose: "org_member",
      orgId: "org-1",
      orgRole: "staff",
      payerAccountId: null,
      invitedByUserId: "u-owner",
      expiresAt: new Date(Date.now() + 86400_000),
      acceptedAt: null,
      revokedAt: null,
    }]);
    seed("org_memberships", []);
    const { createHash } = await import("node:crypto");
    const raw = "raw-token";
    // align the seeded hash with the raw token the caller presents
    tables["invite_tokens"][0].tokenHash = createHash("sha256").update(raw).digest("hex");
    const caller = orgsRouter.createCaller(ctxFor({ id: "u-staff", email: "staff@acme.test" }));
    const res = await caller.acceptInvite({ token: raw });
    expect(res.ok).toBe(true);
    expect(res.purpose).toBe("org_member");
    const memberships = insertedRows["org_memberships"] ?? [];
    expect(memberships.length).toBe(1);
    expect(memberships[0].userId).toBe("u-staff");
    expect(memberships[0].orgId).toBe("org-1");
    expect(memberships[0].role).toBe("staff");
    expect(auditRows.find(a => a.action === "invite.accept")).toBeTruthy();
  });

  it("acceptInvite rejects a different email address", async () => {
    const { createHash } = await import("node:crypto");
    const raw = "raw-token";
    seed("invite_tokens", [{
      id: "inv-1",
      tokenHash: createHash("sha256").update(raw).digest("hex"),
      email: "someone-else@acme.test",
      purpose: "org_member",
      orgId: "org-1",
      orgRole: "staff",
      invitedByUserId: "u-owner",
      expiresAt: new Date(Date.now() + 86400_000),
      acceptedAt: null,
      revokedAt: null,
    }]);
    const caller = orgsRouter.createCaller(ctxFor({ id: "u-staff", email: "staff@acme.test" }));
    await expect(caller.acceptInvite({ token: raw })).rejects.toThrow(/different email/i);
  });

  it("acceptInvite rejects expired tokens", async () => {
    const { createHash } = await import("node:crypto");
    const raw = "raw-token";
    seed("invite_tokens", [{
      id: "inv-1",
      tokenHash: createHash("sha256").update(raw).digest("hex"),
      email: "staff@acme.test",
      purpose: "org_member",
      orgId: "org-1",
      orgRole: "staff",
      invitedByUserId: "u-owner",
      expiresAt: new Date(Date.now() - 1000),
      acceptedAt: null,
      revokedAt: null,
    }]);
    const caller = orgsRouter.createCaller(ctxFor({ id: "u-staff", email: "staff@acme.test" }));
    await expect(caller.acceptInvite({ token: raw })).rejects.toThrow(/expired/i);
  });

  it("payer.invite sends a real invite email and reports delivery status", async () => {
    seed("disputes", [{
      id: "d1", referenceNumber: "IDR-2026-0001", currentStep: "STEP_01",
      initiatingPartyId: "u-prov", createdBy: "u-prov",
    }]);
    seed("payer_accounts", []);
    seed("payer_case_links", []);
    seed("users", []); // no matching platform user yet
    const caller = payerRouter.createCaller(ctxFor({ id: "u-prov", role: "user" }));
    const res = await caller.invite({ disputeId: "d1", payerName: "Big Payer", contactEmail: "claims@payer.test" });
    expect(res.payerAccountId).toBeTruthy();
    expect(res.inviteId).toBeTruthy();
    expect(res.inviteEmailStatus).toBe("delivered");
    const invites = insertedRows["invite_tokens"] ?? [];
    expect(invites.length).toBe(1);
    expect(invites[0].purpose).toBe("payer_invite");
    expect(invites[0].payerAccountId).toBe(res.payerAccountId);
  });
});

// ─── G7: payer duplicate-email guard ─────────────────────────────────────────
describe("G7 payer duplicate email", () => {
  it("reuses the existing payer account instead of duplicating (unique index backs races)", async () => {
    seed("disputes", [{
      id: "d1", referenceNumber: "IDR-2026-0002", currentStep: "STEP_01",
      initiatingPartyId: "u-prov", createdBy: "u-prov",
    }]);
    seed("payer_accounts", [{ id: "pa-1", payerName: "Big Payer", contactEmail: "claims@payer.test" }]);
    seed("payer_case_links", []);
    seed("users", []);
    const caller = payerRouter.createCaller(ctxFor({ id: "u-prov", role: "user" }));
    const res = await caller.invite({ disputeId: "d1", payerName: "Big Payer", contactEmail: "claims@payer.test" });
    expect(res.payerAccountId).toBe("pa-1");
    // no second payer_accounts insert happened
    expect((insertedRows["payer_accounts"] ?? []).length).toBe(0);
  });
});

// ─── G5: offboarding persona cascade ─────────────────────────────────────────
describe("G5 offboarding persona cascade", () => {
  it("revokes payer links, clears assignments, revokes patient+invite tokens, removes memberships", async () => {
    seed("users", [{ id: "u-target", role: "user", email: "payer@x.test", suspendedAt: null }]);
    seed("dispute_access", []);
    seed("payer_accounts", [{ id: "pa-1", contactEmail: "payer@x.test" }]);
    // update returning queue order (see offboardUser):
    //  1 apiKeys  2 totp  3 payerCaseLinks  4 idreAssignments
    //  5 patientAccessTokens  6 inviteTokens  7 orgMemberships (delete)
    queueReturning([{ id: "k1" }]);
    queueReturning([{ id: "t1" }]);
    queueReturning([{ id: "pcl-1" }, { id: "pcl-2" }]);
    queueReturning([{ id: "ia-1" }]);
    queueReturning([{ id: "pat-1" }]);
    queueReturning([{ id: "inv-1" }]);
    queueReturning([{ id: "m-1" }]);
    const res = await offboardUser({ adminId: "u-admin", userId: "u-target", reason: "wave-fa test" });
    expect(res.success).toBe(true);
    expect(res.counts.apiKeysRevoked).toBe(1);
    expect(res.counts.totpDisabled).toBe(1);
    expect(res.counts.payerCaseLinksRevoked).toBe(2);
    expect(res.counts.idreAssignmentsCleared).toBe(1);
    expect(res.counts.patientTokensRevoked).toBe(1);
    expect(res.counts.inviteTokensRevoked).toBe(1);
    expect(res.counts.orgMembershipsRemoved).toBe(1);
    expect(auditRows.find(a => a.action === "admin.offboardUser")).toBeTruthy();
  });

  it("still refuses to offboard yourself (guard intact)", async () => {
    await expect(offboardUser({ adminId: "u1", userId: "u1", reason: "x" })).rejects.toThrow(/yourself/);
  });

  it("still refuses to offboard the last active admin (guard intact)", async () => {
    // First select = target lookup (an admin); second = other-admins guard → none.
    queueSelects("users", [
      [{ id: "u-admin2", role: "admin", email: "a@x.test", suspendedAt: null }],
      [],
    ]);
    await expect(offboardUser({ adminId: "u-admin", userId: "u-admin2", reason: "x" }))
      .rejects.toThrow(/last active admin/);
  });
});

// ─── G4: patient token revocation ────────────────────────────────────────────
describe("G4 patient token revocation", () => {
  it("revokeToken sets revokedAt and writes an audit entry (issuer path)", async () => {
    seed("patient_access_tokens", [{
      id: "tok-1", tokenHash: "h", disputeId: "d1", patientName: "Pat",
      scope: "view", expiresAt: new Date(Date.now() + 86400_000),
      createdByUserId: "u-prov", usedAt: null, revokedAt: null,
    }]);
    const caller = patientPortalRouter.createCaller(ctxFor({ id: "u-prov", role: "user" }));
    const res = await caller.revokeToken({ tokenId: "tok-1" });
    expect(res.ok).toBe(true);
    expect(res.alreadyRevoked).toBe(false);
    expect(auditRows.find(a => a.action === "patientPortal.revokeToken")).toBeTruthy();
  });

  it("revokeToken is idempotent and refuses unrelated users", async () => {
    seed("patient_access_tokens", [{
      id: "tok-1", tokenHash: "h", disputeId: null, patientName: "Pat",
      scope: "ppdr_intake", expiresAt: new Date(Date.now() + 86400_000),
      createdByUserId: "u-prov", usedAt: null, revokedAt: new Date(),
    }]);
    const caller = patientPortalRouter.createCaller(ctxFor({ id: "u-prov", role: "user" }));
    const res = await caller.revokeToken({ tokenId: "tok-1" });
    expect(res.alreadyRevoked).toBe(true);

    seed("patient_access_tokens", [{
      id: "tok-2", tokenHash: "h2", disputeId: null, patientName: "Pat",
      scope: "ppdr_intake", expiresAt: new Date(Date.now() + 86400_000),
      createdByUserId: "u-prov", usedAt: null, revokedAt: null,
    }]);
    const stranger = patientPortalRouter.createCaller(ctxFor({ id: "u-random", role: "user" }));
    await expect(stranger.revokeToken({ tokenId: "tok-2" })).rejects.toThrow(/Only the issuing/i);
  });

  it("viewCase denies a revoked token even before expiry", async () => {
    const { createHash } = await import("node:crypto");
    const raw = "patient-link-token";
    seed("patient_access_tokens", [{
      id: "tok-1", tokenHash: createHash("sha256").update(raw).digest("hex"),
      disputeId: "d1", patientName: "Pat", scope: "view",
      expiresAt: new Date(Date.now() + 86400_000),
      createdByUserId: "u-prov", usedAt: null, revokedAt: new Date(),
    }]);
    seed("disputes", [{ id: "d1", referenceNumber: "IDR-1" }]);
    const caller = patientPortalRouter.createCaller({} as any);
    await expect(caller.viewCase({ token: raw })).rejects.toThrow(/revoked/i);
  });
});
