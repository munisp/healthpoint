/**
 * server/tests/authz-registry.test.ts
 *
 * Unit tests for the central object-level authorization registry
 * (server/authz-registry.ts) and its enforcement entry point used by the
 * protectedProcedure middleware in server/_core/trpc.ts.
 *
 * The DB layer is mocked with an in-memory fake (same approach as
 * server/authz-idor.test.ts); no live infrastructure is required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ── In-memory database state (hoisted so the mock factory can see it) ────────
const state = vi.hoisted(() => ({
  dbAvailable: true,
  disputes: [] as Array<{ id: string; initiatingPartyId: string; createdBy: string }>,
  grants: [] as Array<{ disputeId: string; userId: string; permission: string }>,
  documents: [] as Array<{ id: string; disputeId: string; fileName: string }>,
  comments: [] as Array<{ id: string; disputeId: string; authorId: string }>,
  analyses: [] as Array<{ id: string; disputeId: string | null; userId: string }>,
  emrConnections: [] as Array<{ id: string; createdBy: string }>,
  notifications: [] as Array<{ id: string; userId: string }>,
  webhooks: [] as Array<{ id: string; userId: string }>,
  payerContacts: [] as Array<{ id: string; createdBy: string }>,
  narratives: [] as Array<{ id: string; disputeId: string }>,
  escalations: [] as Array<{ id: string; disputeId: string }>,
  expiryAlerts: [] as Array<{ id: string; disputeId: string }>,
  smartTokens: [] as Array<{ id: string; userId: string; emrConnectionId: string }>,
  bulkJobs: [] as Array<{ id: string; initiatedBy: string }>,
  cdsHooks: [] as Array<{ id: string; emrConnectionId: string }>,
}));

vi.mock("../db", async () => {
  // Pure factory mock (no importOriginal): the registry and authz helpers only
  // need getDb, and skipping the real db.ts keeps its infra deps (redis,
  // opensearch, mysql2…) out of the test process.
  const schema = await vi.importActual<typeof import("../../drizzle/schema")>("../../drizzle/schema");

  const rowsFor = (table: unknown): unknown[] => {
    if (table === schema.disputes) return state.disputes;
    if (table === schema.disputeAccess) return state.grants;
    if (table === schema.disputeDocuments) return state.documents;
    if (table === schema.disputeComments) return state.comments;
    if (table === schema.documentAnalyses) return state.analyses;
    if (table === schema.emrConnections) return state.emrConnections;
    if (table === schema.notifications) return state.notifications;
    if (table === schema.webhooks) return state.webhooks;
    if (table === schema.payerContacts) return state.payerContacts;
    if (table === schema.disputeNarratives) return state.narratives;
    if (table === schema.disputeEscalations) return state.escalations;
    if (table === schema.documentExpiryAlerts) return state.expiryAlerts;
    if (table === schema.smartTokens) return state.smartTokens;
    if (table === schema.bulkFhirExportJobs) return state.bulkJobs;
    if (table === schema.cdsHooks) return state.cdsHooks;
    return [];
  };

  // Minimal chainable query builder: tests seed at most one row per table, so
  // unfiltered rows are the correct result for the registry's
  // `.where(eq(id, …)).limit(1)` lookups.
  const makeQuery = (rows: unknown[]): any => ({
    where: () => makeQuery(rows),
    orderBy: () => makeQuery(rows),
    limit: (n: number) => Promise.resolve(rows.slice(0, n)),
    then: (onFulfilled: any, onRejected: any) => Promise.resolve(rows).then(onFulfilled, onRejected),
  });

  const fakeDb = {
    select: () => ({ from: (table: unknown) => makeQuery(rowsFor(table)) }),
  };

  return {
    getDb: async () => (state.dbAvailable ? (fakeDb as any) : null),
  };
});

import {
  authzCheckers,
  enforcePathAuthz,
  resetAuthzAuditLog,
  type AuthzRequestContext,
} from "../authz-registry";

// ── Helpers ───────────────────────────────────────────────────────────────────
const OWNER = "user-owner";
const STRANGER = "user-stranger";
const REVIEWER = "user-reviewer";
const ADMIN = "user-admin";
const DISPUTE_ID = "dispute-1";

const asUser = (id: string): AuthzRequestContext => ({ user: { id, role: "user" } });
const asAdmin = (id = ADMIN): AuthzRequestContext => ({ user: { id, role: "admin" } });

function seedDispute(ownerId = OWNER) {
  state.disputes = [{ id: DISPUTE_ID, initiatingPartyId: ownerId, createdBy: ownerId }];
}

async function expectForbidden(p: Promise<unknown>) {
  await expect(p).rejects.toMatchObject({ code: "FORBIDDEN" });
}

beforeEach(() => {
  state.dbAvailable = true;
  state.disputes = [];
  state.grants = [];
  state.documents = [];
  state.comments = [];
  state.analyses = [];
  state.emrConnections = [];
  state.notifications = [];
  state.webhooks = [];
  state.payerContacts = [];
  state.narratives = [];
  state.escalations = [];
  state.expiryAlerts = [];
  state.smartTokens = [];
  state.bulkJobs = [];
  state.cdsHooks = [];
  resetAuthzAuditLog();
});

// ── Part 1: registry map coverage ────────────────────────────────────────────
describe("registry coverage", () => {
  // Every money-bearing or PHI-bearing procedure path identified by the audit
  // that is enforceable via the procedure input must have a registered checker.
  const EXPECTED_PATHS = [
    // dispute mutations
    "disputes.findDuplicates",
    "disputes.rejectOffer",
    "disputes.sendNotification",
    "disputes.clone",
    "disputes.merge",
    // documents (PHI)
    "documents.upload",
    "documents.list",
    "documents.listVersions",
    "documents.uploadVersion",
    // AI procedures touching dispute PHI / EMR credentials
    "ai.analyzeDocument",
    "ai.generateCMSSubmission",
    "ai.askAssistant",
    "ai.pullDisputeData",
    "ai.searchPatients",
    // dispute-linked analysis / predictions / compliance
    "stateLaws.checkCompliance",
    "expertReview.request",
    "expertReview.getAnalysis",
    "predictions.get",
    "predictions.generate",
    "uscdi.getCompleteness",
    "uscdi.updateCompleteness",
    "compliance.list",
    "compliance.upsert",
    "compliance.reset",
    // document intelligence (extracted PHI)
    "docIntelligence.analyze",
    "docIntelligence.get",
    "docIntelligence.getDownloadUrl",
    // case notes / comments
    "comments.list",
    "comments.add",
    "comments.replies",
    "comments.summarize",
    // payer contact book
    "payerContacts.update",
    "payerContacts.delete",
    // SLA
    "sla.breaches",
    "sla.check",
    // bulk dispute operations
    "bulkActions.changeStatus",
    "bulkActions.addNote",
    // watchlist / escalations / appeals / narratives / doc expiry
    "watchlist.add",
    "watchlist.remove",
    "watchlist.isWatching",
    "escalations.list",
    "escalations.create",
    "escalations.resolve",
    "appeals.list",
    "appeals.create",
    "narratives.list",
    "narratives.generate",
    "narratives.approve",
    "narratives.delete",
    "docExpiry.list",
    "docExpiry.add",
    "docExpiry.dismiss",
    // SMART/FHIR integrations (connection-scoped PHI)
    "fhirCapability.fetch",
    "fhirCapability.list",
    "smartAuth.listTokens",
    "smartAuth.revokeToken",
    "bulkFhir.startExport",
    "bulkFhir.cancelJob",
    "cdsHooksRouter.list",
    "cdsHooksRouter.register",
    "cdsHooksRouter.toggleStatus",
    "daVinci.list",
    "daVinci.submitPAS",
    "fhirCache.list",
    "fhirCache.purge",
    "smartForm.extract",
    // notifications + webhooks (object ownership)
    "notifications.markRead",
    "webhooks.update",
    "webhooks.delete",
    "webhooks.test",
    // tenant-wide exports (fail-closed admin gate)
    "reports.exportCSV",
    "reports.exportPDF",
  ];

  it("has a checker for every audited money/PHI path", () => {
    for (const path of EXPECTED_PATHS) {
      expect(authzCheckers[path], `missing checker for ${path}`).toBeTypeOf("function");
    }
  });

  it("covers at least the audited path count (regression guard)", () => {
    expect(Object.keys(authzCheckers).length).toBeGreaterThanOrEqual(EXPECTED_PATHS.length);
  });
});

// ── Part 2: dispute-gated checker behavior (owner/reviewer/stranger/admin) ───
describe("dispute-gated paths", () => {
  it("owner passes a write-gated dispute mutation", async () => {
    seedDispute();
    await expect(
      enforcePathAuthz("disputes.rejectOffer", asUser(OWNER), { disputeId: DISPUTE_ID })
    ).resolves.toBeUndefined();
  });

  it("stranger is denied with FORBIDDEN (IDOR regression)", async () => {
    seedDispute();
    await expectForbidden(
      enforcePathAuthz("disputes.rejectOffer", asUser(STRANGER), { disputeId: DISPUTE_ID })
    );
  });

  it("reviewer with a write grant passes; read-only grant is denied write", async () => {
    seedDispute();
    state.grants = [{ disputeId: DISPUTE_ID, userId: REVIEWER, permission: "write" }];
    await expect(
      enforcePathAuthz("disputes.clone", asUser(REVIEWER), { disputeId: DISPUTE_ID })
    ).resolves.toBeUndefined();

    state.grants = [{ disputeId: DISPUTE_ID, userId: REVIEWER, permission: "read" }];
    await expect(
      enforcePathAuthz("disputes.clone", asUser(REVIEWER), { disputeId: DISPUTE_ID })
    ).resolves.toBeUndefined();
    await expectForbidden(
      enforcePathAuthz("predictions.generate", asUser(REVIEWER), { disputeId: DISPUTE_ID })
    );
  });

  it("admin passes regardless of ownership", async () => {
    seedDispute();
    await expect(
      enforcePathAuthz("disputes.rejectOffer", asAdmin(), { disputeId: DISPUTE_ID })
    ).resolves.toBeUndefined();
  });

  it("disputes.merge enforces write on BOTH ids", async () => {
    // NB: the fake DB returns all seeded rows regardless of WHERE, so seed a
    // single dispute per scenario (same convention as authz-idor.test.ts).
    seedDispute(STRANGER);
    await expectForbidden(
      enforcePathAuthz("disputes.merge", asUser(OWNER), {
        primaryDisputeId: DISPUTE_ID,
        secondaryDisputeId: DISPUTE_ID,
      })
    );
    seedDispute();
    await expect(
      enforcePathAuthz("disputes.merge", asUser(OWNER), {
        primaryDisputeId: DISPUTE_ID,
        secondaryDisputeId: DISPUTE_ID,
      })
    ).resolves.toBeUndefined();
  });

  it("unknown dispute ids are denied fail-closed", async () => {
    // No disputes seeded → the access check finds no row → deny.
    await expectForbidden(
      enforcePathAuthz("disputes.clone", asUser(OWNER), { disputeId: "dispute-unknown" })
    );
  });

  it("bulkActions checks every id in the array (fail closed per id)", async () => {
    seedDispute();
    await expectForbidden(
      enforcePathAuthz("bulkActions.changeStatus", asUser(STRANGER), { ids: [DISPUTE_ID], status: "closed" })
    );
    await expect(
      enforcePathAuthz("bulkActions.changeStatus", asUser(OWNER), { ids: [DISPUTE_ID], status: "closed" })
    ).resolves.toBeUndefined();
  });

  it("skips the check when the id is missing/malformed (zod rejects downstream)", async () => {
    await expect(
      enforcePathAuthz("disputes.rejectOffer", asUser(STRANGER), {})
    ).resolves.toBeUndefined();
    await expect(
      enforcePathAuthz("disputes.rejectOffer", asUser(STRANGER), { disputeId: 42 })
    ).resolves.toBeUndefined();
  });
});

// ── Part 3: nested-id resolution checkers ────────────────────────────────────
describe("nested-id resolvers", () => {
  it("documents.listVersions resolves documentId → dispute and enforces read", async () => {
    seedDispute();
    state.documents = [{ id: "doc-1", disputeId: DISPUTE_ID, fileName: "eob.pdf" }];
    await expect(
      enforcePathAuthz("documents.listVersions", asUser(OWNER), { documentId: "doc-1" })
    ).resolves.toBeUndefined();
    await expectForbidden(
      enforcePathAuthz("documents.listVersions", asUser(STRANGER), { documentId: "doc-1" })
    );
  });

  it("documents.uploadVersion denies when the document belongs to a different dispute", async () => {
    seedDispute();
    state.disputes.push({ id: "dispute-2", initiatingPartyId: OWNER, createdBy: OWNER });
    state.documents = [{ id: "doc-1", disputeId: DISPUTE_ID, fileName: "eob.pdf" }];
    await expectForbidden(
      enforcePathAuthz("documents.uploadVersion", asUser(OWNER), {
        documentId: "doc-1",
        disputeId: "dispute-2",
      })
    );
    await expect(
      enforcePathAuthz("documents.uploadVersion", asUser(OWNER), {
        documentId: "doc-1",
        disputeId: DISPUTE_ID,
      })
    ).resolves.toBeUndefined();
  });

  it("comments.replies resolves the parent comment's dispute", async () => {
    seedDispute();
    state.comments = [{ id: "comment-1", disputeId: DISPUTE_ID, authorId: OWNER }];
    await expectForbidden(
      enforcePathAuthz("comments.replies", asUser(STRANGER), { parentId: "comment-1" })
    );
    await expect(
      enforcePathAuthz("comments.replies", asUser(OWNER), { parentId: "comment-1" })
    ).resolves.toBeUndefined();
  });

  it("narratives.delete resolves narrative → dispute and requires write", async () => {
    seedDispute();
    state.narratives = [{ id: "narr-1", disputeId: DISPUTE_ID }];
    await expectForbidden(
      enforcePathAuthz("narratives.delete", asUser(STRANGER), { id: "narr-1" })
    );
    await expect(
      enforcePathAuthz("narratives.delete", asUser(OWNER), { id: "narr-1" })
    ).resolves.toBeUndefined();
  });

  it("cdsHooksRouter.toggleStatus resolves hook → EMR connection → owner", async () => {
    state.emrConnections = [{ id: "conn-1", createdBy: OWNER }];
    state.cdsHooks = [{ id: "hook-1", emrConnectionId: "conn-1" }];
    await expectForbidden(
      enforcePathAuthz("cdsHooksRouter.toggleStatus", asUser(STRANGER), { id: "hook-1", status: "active" })
    );
    await expect(
      enforcePathAuthz("cdsHooksRouter.toggleStatus", asUser(OWNER), { id: "hook-1", status: "active" })
    ).resolves.toBeUndefined();
    await expect(
      enforcePathAuthz("cdsHooksRouter.toggleStatus", asAdmin(), { id: "hook-1", status: "active" })
    ).resolves.toBeUndefined();
  });
});

// ── Part 4: ownership checkers (non-dispute resources) ───────────────────────
describe("ownership checkers", () => {
  it("notifications.markRead: only the recipient (or admin)", async () => {
    state.notifications = [{ id: "notif-1", userId: OWNER }];
    await expect(
      enforcePathAuthz("notifications.markRead", asUser(OWNER), { id: "notif-1" })
    ).resolves.toBeUndefined();
    await expectForbidden(
      enforcePathAuthz("notifications.markRead", asUser(STRANGER), { id: "notif-1" })
    );
    await expect(
      enforcePathAuthz("notifications.markRead", asAdmin(), { id: "notif-1" })
    ).resolves.toBeUndefined();
  });

  it("webhooks.delete: only the webhook owner (or admin)", async () => {
    state.webhooks = [{ id: "wh-1", userId: OWNER }];
    await expectForbidden(
      enforcePathAuthz("webhooks.delete", asUser(STRANGER), { id: "wh-1" })
    );
    await expect(
      enforcePathAuthz("webhooks.delete", asUser(OWNER), { id: "wh-1" })
    ).resolves.toBeUndefined();
  });

  it("payerContacts.update: only the creator", async () => {
    state.payerContacts = [{ id: "pc-1", createdBy: OWNER }];
    await expectForbidden(
      enforcePathAuthz("payerContacts.update", asUser(STRANGER), { id: "pc-1" })
    );
    await expect(
      enforcePathAuthz("payerContacts.update", asUser(OWNER), { id: "pc-1" })
    ).resolves.toBeUndefined();
  });

  it("docIntelligence.get: only the uploader (or admin) — PHI", async () => {
    state.analyses = [{ id: "ana-1", disputeId: null, userId: OWNER }];
    await expectForbidden(
      enforcePathAuthz("docIntelligence.get", asUser(STRANGER), { id: "ana-1" })
    );
    await expect(
      enforcePathAuthz("docIntelligence.get", asUser(OWNER), { id: "ana-1" })
    ).resolves.toBeUndefined();
  });

  it("ai.searchPatients: EMR connection belongs to its creator", async () => {
    state.emrConnections = [{ id: "conn-1", createdBy: OWNER }];
    await expectForbidden(
      enforcePathAuthz("ai.searchPatients", asUser(STRANGER), { connectionId: "conn-1", emrSystem: "epic", query: "smith" })
    );
    await expect(
      enforcePathAuthz("ai.searchPatients", asUser(OWNER), { connectionId: "conn-1", emrSystem: "epic", query: "smith" })
    ).resolves.toBeUndefined();
  });

  it("smartAuth.revokeToken / bulkFhir.cancelJob: owner or admin", async () => {
    state.smartTokens = [{ id: "tok-1", userId: OWNER, emrConnectionId: "conn-1" }];
    state.bulkJobs = [{ id: "job-1", initiatedBy: OWNER }];
    await expectForbidden(
      enforcePathAuthz("smartAuth.revokeToken", asUser(STRANGER), { tokenId: "tok-1" })
    );
    await expectForbidden(
      enforcePathAuthz("bulkFhir.cancelJob", asUser(STRANGER), { jobId: "job-1" })
    );
    await expect(
      enforcePathAuthz("bulkFhir.cancelJob", asUser(OWNER), { jobId: "job-1" })
    ).resolves.toBeUndefined();
  });
});

// ── Part 5: fail-closed behavior ─────────────────────────────────────────────
describe("fail-closed enforcement", () => {
  it("denies dispute-gated paths when the database is unavailable", async () => {
    seedDispute();
    state.dbAvailable = false;
    await expectForbidden(
      enforcePathAuthz("disputes.rejectOffer", asUser(OWNER), { disputeId: DISPUTE_ID })
    );
  });

  it("denies nested-id checks when the database is unavailable", async () => {
    state.notifications = [{ id: "notif-1", userId: OWNER }];
    state.dbAvailable = false;
    await expectForbidden(
      enforcePathAuthz("notifications.markRead", asUser(OWNER), { id: "notif-1" })
    );
  });

  it("wraps unexpected checker errors into FORBIDDEN", async () => {
    authzCheckers["test.explode"] = async () => {
      throw new Error("boom");
    };
    try {
      await expectForbidden(enforcePathAuthz("test.explode", asUser(OWNER), {}));
    } finally {
      delete authzCheckers["test.explode"];
    }
  });

  it("fhirCache.list denies non-admins without a dispute/connection filter", async () => {
    await expectForbidden(enforcePathAuthz("fhirCache.list", asUser(OWNER), {}));
    await expect(enforcePathAuthz("fhirCache.list", asAdmin(), {})).resolves.toBeUndefined();
  });

  it("reports.exportCSV/exportPDF are admin-only (cross-tenant export fail-closed)", async () => {
    await expectForbidden(enforcePathAuthz("reports.exportCSV", asUser(OWNER), {}));
    await expectForbidden(enforcePathAuthz("reports.exportPDF", asUser(OWNER), {}));
    await expect(enforcePathAuthz("reports.exportCSV", asAdmin(), {})).resolves.toBeUndefined();
  });

  it("checker errors are TRPCErrors with FORBIDDEN code", async () => {
    seedDispute();
    const err = await enforcePathAuthz("disputes.clone", asUser(STRANGER), { disputeId: DISPUTE_ID })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
  });
});

// ── Part 6: default-allow + audit observability for unmapped paths ───────────
describe("unmapped paths", () => {
  it("default-allows and logs an audit line once per path", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(enforcePathAuthz("qpa.validate", asUser(STRANGER), {})).resolves.toBeUndefined();
      await enforcePathAuthz("qpa.validate", asUser(STRANGER), {});
      const auditLines = warn.mock.calls.filter(args =>
        String(args[0]).includes('[authz-registry] AUDIT') && String(args[0]).includes('"qpa.validate"')
      );
      expect(auditLines).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("supports prefix entries (path*)", async () => {
    authzCheckers["testprefix.*"] = async () => {
      throw new TRPCError({ code: "FORBIDDEN", message: "prefix deny" });
    };
    try {
      await expectForbidden(enforcePathAuthz("testprefix.someProcedure", asUser(OWNER), {}));
    } finally {
      delete authzCheckers["testprefix.*"];
    }
  });
});
