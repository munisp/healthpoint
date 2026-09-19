/**
 * server/journeys/catalog/admin.ts
 *
 * Admin and operational journeys (8-13, 19-21): case status snapshots,
 * feature-flag round trip, broadcast to multiple recipients, deterministic
 * notification seed, audit-log export CSV/PDF, API key lifecycle, Temporal
 * workflow handoff, idempotency retry-replay safety.
 *
 * J21 idempotency: uses Idempotency-Key "healthpoint-temporal-j21" on both
 * sends and then proves replay-safety by asserting the second send created no
 * new audit_log rows (sends are audit-logged, so a duplicated second POST
 * would be visible).
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { and, desc, eq } from "drizzle-orm";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "../../db";
import {
  adminBroadcasts,
  adminCaseStatusSnapshots,
  apiKeys,
  auditLog,
  disputes,
  notifications,
  userNotificationPreferences,
} from "../../../drizzle/schema";
import { seedNotification } from "../../notification-broadcast";
import { enqueueEmail } from "../../temporal";
import type { Journey, JourneyContext } from "../runner";

const require = createRequire(import.meta.url);

export const JOURNEYS: Journey[] = [
  {
    id: "j8-admin-case-status-snapshot",
    name: "Admin updates case status snapshot (admin case snapshot journey)",
    requires: ["admin", "providerDispute"],
    async run(ctx) {
      const disputed = await ctx.providerDispute!();
      const adminCaller = ctx.admin;
      const providerCaller = ctx.provider;

      await adminCaller.admin.saveCaseStatusSnapshot({
        disputeId: disputed.disputeId,
        status: "under_review",
        summary: `journey snapshot ${ctx.ns("j8")}`,
      });

      const auditRows = await ctx.admin.admin.listAudit({
        entityType: "dispute",
        entityId: disputed.disputeId,
        action: "admin.case_status_snapshot",
        limit: 10,
        offset: 0,
      });
      ctx.assert(
        auditRows.rows.some((row) => {
          try {
            const payload = JSON.parse(row.newValue ?? "{}") as { status?: string };
            return payload.status === "under_review";
          } catch {
            return false;
          }
        }),
        "admin.case_status_snapshot audit row recorded"
      );

      const providerView = await providerCaller.disputes.get({ id: disputed.disputeId });
      ctx.assert(providerView.dispute.status === "payment_negotiation", "provider-visible dispute status unchanged by admin-only snapshot");
    },
  },
  {
    id: "j9-admin-feature-flag-roundtrip",
    name: "Admin toggles feature flag (feature flag journey)",
    requires: ["admin", "providerDispute"],
    async run(ctx) {
      const disputed = await ctx.providerDispute!();
      const disputeId = disputed.disputeId;
      const featureKey = "beta.documents";
      const before = await ctx.admin.featureFlags.get({ disputeId, featureKey });
      ctx.assert(before.enabled === false, "flag starts disabled");
      await ctx.admin.featureFlags.set({ disputeId, featureKey, enabled: true, reason: ctx.ns("j9") });
      const after = await ctx.admin.featureFlags.get({ disputeId, featureKey });
      ctx.assert(after.enabled === true, "flag enabled");
      ctx.assert(after.updatedBy === "admin-journey", "admin attribution recorded");
      const auditRows = await ctx.admin.admin.listAudit({
        entityType: "feature_flag",
        entityId: disputeId,
        action: "feature_flag.set",
        limit: 10,
        offset: 0,
      });
      ctx.assert(auditRows.rows.length >= 1, "feature_flag.set audit row recorded");
      await ctx.admin.featureFlags.set({ disputeId, featureKey, enabled: false, reason: `${ctx.ns("j9")}-cleanup` });
    },
  },
  {
    id: "j10-admin-broadcast-to-provider-and-payer",
    name: "Admin broadcasts a notification (notification broadcast journey)",
    requires: ["admin"],
    async run(ctx) {
      const result = await ctx.admin.admin.broadcastNotification({
        recipientIds: ["provider-journey", "payer-journey"],
        type: "admin_broadcast",
        title: `journey broadcast ${ctx.ns("j10")}`,
        message: "admin action journey coverage",
        priority: "normal",
      });
      ctx.assert(result.recipientCount === 2, "broadcast sent to both recipients");
      const rows = await ctx.provider.notifications.list({ limit: 10, unreadOnly: true });
      ctx.assert(rows.some((row) => row.title.includes(ctx.ns("j10"))), "provider inbox received broadcast");
      ctx.assert(rows[0].readAt == null, "notification remains unread until opened");
    },
  },
  {
    id: "j11-admin-seed-notification-determinism",
    name: "Admin seeds a deterministic notification (seeded notification journey)",
    requires: ["admin"],
    async run(ctx) {
      const result = await seedNotification({
        userId: "provider-journey",
        type: "admin_seeded",
        title: `deterministic seed ${ctx.ns("j11")}`,
        message: "fixed seed",
        priority: "high",
      });
      ctx.assert(result.ok, "seed succeeded");
      const rows = await ctx.provider.notifications.list({ limit: 10, unreadOnly: true });
      ctx.assert(rows.some((row) => row.title === `deterministic seed ${ctx.ns("j11")}` && row.priority === "high"), "seeded notification is listed");
    },
  },
  {
    id: "j12-admin-audit-export-csv",
    name: "Admin exports audit log to CSV (audit export journey)",
    requires: ["admin"],
    async run(ctx) {
      const csv = await ctx.admin.admin.exportAuditLog({ format: "csv", limit: 200 });
      ctx.assert(csv.includes("id,userId,action,entityType,entityId,createdAt"), "csv header present");
      ctx.assert(csv.includes("journey") || csv.includes("admin"), "csv contains journey or admin actions");
    },
  },
  {
    id: "j13-admin-audit-export-pdf",
    name: "Admin exports audit log to PDF (audit export journey)",
    requires: ["admin"],
    async run(ctx) {
      const base64 = await ctx.admin.admin.exportAuditLog({ format: "pdf", limit: 50 });
      const bytes = Buffer.from(base64, "base64");
      ctx.assert(bytes.subarray(0, 5).toString("utf8") === "%PDF-", "pdf header bytes present");
    },
  },
  {
    id: "j19-api-keys-lifecycle",
    name: "API key lifecycle (create / list / revoke)",
    requires: ["provider"],
    async run(ctx) {
      // phase13-fc (G9): keys are org-bound — create an org context first.
      const org = await ctx.provider.orgs.create({
        name: `j19-org-${ctx.ns("j19")}`.slice(0, 255),
        type: "provider",
      });
      const created = await ctx.provider.apiKeys.create({
        name: `journey-key-${ctx.ns("j19")}`.slice(0, 100),
        scopes: ["read"],
        orgId: org.orgId,
      });
      ctx.assert(created.key.startsWith("hp_"), "raw key returned once");
      ctx.assert(created.orgId === org.orgId, "key bound to org");
      const listed = await ctx.provider.apiKeys.list();
      const row = listed.find(k => k.keyPrefix === created.prefix);
      ctx.assert(Boolean(row), "key listed");
      ctx.assert(!("keyHash" in (row as object)), "hash never exposed");
      ctx.assert(!("key" in (row as object)), "raw key not re-exposed");
      const keyId = (row as { id: string }).id;
      const revoked = await ctx.provider.apiKeys.revoke({ id: keyId });
      ctx.assert(revoked.ok === true, "revoke ok");
      const after = await ctx.provider.apiKeys.list();
      ctx.assert(Boolean(after.find(k => k.id === keyId)?.revokedAt), "revokedAt set after revoke");
    },
  },
  {
    id: "j20-temporal-workflow-handoff",
    name: "Temporal workflow handoff",
    requires: ["providerDispute"],
    async run(ctx) {
      const disputed = await ctx.providerDispute!();
      const sendResult = await ctx.provider.idrCompliance.sendCaseLetter({
        disputeId: disputed.disputeId,
        recipientEmail: "journey-recipient@example.com",
      });
      ctx.assert(sendResult.ok === true, "case letter sent");

      const { client, taskQueue } = await ctx.temporal();
      const handle = client!.workflow.getHandle(`send-email:${ctx.runId}:j20-case-letter:${disputed.disputeId}`);
      const status = await handle.describe();
      ctx.assert(status.status.name === "COMPLETED", "mock workflow completed");
      const result = await handle.result() as { sent?: boolean; to?: string; disputeId?: string };
      ctx.assert(result.sent === true && result.to === "journey-recipient@example.com" && result.disputeId === disputed.disputeId, "workflow result matches dispatch");
      ctx.assert(taskQueue === "healthpoint-journeys", "uses isolated task queue");
    },
  },
  {
    id: "j21-idempotency-replay-safety",
    name: "Idempotency retry-replay safety",
    requires: ["providerDispute"],
    async run(ctx) {
      const disputed = await ctx.providerDispute!();
      const idemKey = "healthpoint-temporal-j21";
      const first = await ctx.provider.idrCompliance.sendCaseLetter({
        disputeId: disputed.disputeId,
        recipientEmail: "journey-idem@example.com",
        idempotencyKey: idemKey,
      });
      const second = await ctx.provider.idrCompliance.sendCaseLetter({
        disputeId: disputed.disputeId,
        recipientEmail: "journey-idem@example.com",
        idempotencyKey: idemKey,
      });
      ctx.assert(second.alreadySent === true, "second dispatch replayed as already-sent");
      ctx.assert(first.auditId === second.auditId, "same audit row id returned");

      const db = await getDb();
      const auditRows = await db!
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "idrCompliance.sendCaseLetter"),
            eq(auditLog.entityId, disputed.disputeId),
          ),
        )
        .orderBy(desc(auditLog.id));
      ctx.assert(auditRows.length === 1, "exactly one audit row for replayed send");
    },
  },
];
