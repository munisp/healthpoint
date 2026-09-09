/**
 * J18–J20: admin/platform journeys (admin reseed + reports/audit/SLA/webhooks/
 * bulk actions; authz + apiKeys + TOTP + orgSettings; FHIR/interop).
 */
import { generate as totpGenerate } from "otplib";
import type { Journey } from "../framework";
import { FIXTURE_USERS } from "../framework";
import { createJourneyDispute, expectTrpcError } from "./helpers";

export const j18: Journey = {
  id: "J18",
  title: "Admin reseed demo + reports/audit/SLA + webhook create/delivery/replay + bulk actions",
  actor: "platform-admin",
  description:
    "admin.reseedDemoData, reports.summary, audit.log/list, sla.summary/check, webhooks.create/test (unreachable URL → failed delivery), webhookReplay.replayAll, bulkActions.changeStatus.",
  steps: [
    {
      name: "admin-reseed-demo-data",
      async run(ctx) {
        const result = await ctx.admin.admin.reseedDemoData();
        ctx.assert(result.success === true, "demo reseed succeeded", {
          result: JSON.stringify(result).slice(0, 200),
        });
        // Admin sees the reseeded corpus; the provider fixture sees only its own.
        const adminList = await ctx.admin.admin.allDisputes({ page: 1, pageSize: 5 });
        ctx.assert(
          (adminList.total ?? 0) >= 1 || (adminList.items ?? []).length >= 1,
          "admin dispute listing non-empty after reseed"
        );
        // Non-admin cannot reseed.
        await expectTrpcError(ctx, ctx.provider.admin.reseedDemoData(), "FORBIDDEN", "non-admin reseed rejected");
        return { evidence: { total: adminList.total } };
      },
    },
    {
      name: "reports-audit-sla",
      async run(ctx) {
        const summary = await ctx.admin.reports.summary({});
        ctx.assert(typeof summary.totalDisputes === "number", "reports summary computed", {
          totalDisputes: summary.totalDisputes,
        });
        ctx.assert(summary.totalDisputes >= 1, "summary reflects reseeded data");
        const auditEntry = await ctx.admin.audit.log({
          action: "journey_probe",
          entityType: "journey",
          entityId: ctx.runId,
          newValue: "J18 verification",
        });
        ctx.assert(auditEntry !== null, "audit entry logged");
        const audit = await ctx.admin.audit.list({ entityType: "journey", limit: 10 });
        ctx.assert(
          audit.some(a => a.entityId === ctx.runId),
          "audit entry re-read by entityId"
        );
        const slaSummary = await ctx.provider.sla.summary();
        ctx.assert(typeof slaSummary.total === "number", "SLA summary computed");
        // SLA check against a journey dispute (no breach expected on fresh data).
        const d = await createJourneyDispute(ctx, "j18");
        (ctx as unknown as { _d: string })._d = d.id;
        const check = await ctx.provider.sla.check({ disputeId: d.id });
        ctx.assert(check.breached === false, "fresh dispute not in SLA breach");
        return { evidence: { totalDisputes: summary.totalDisputes, slaTotal: slaSummary.total } };
      },
    },
    {
      name: "webhook-delivery-replay-and-bulk-actions",
      async run(ctx) {
        const hook = await ctx.provider.webhooks.create({
          name: `journey-hook-${ctx.ns("j18")}`.slice(0, 128),
          url: "https://127.0.0.1:9/unreachable",
          events: ["dispute.advanced"],
        });
        ctx.assert((hook as { id: string }).id !== undefined, "webhook created");
        const test = await ctx.provider.webhooks.test({ id: String((hook as { id: string }).id) });
        ctx.assertEqual(test.success, false, "unreachable endpoint fails delivery honestly");
        const hooks = await ctx.provider.webhooks.list();
        ctx.assert(
          hooks.some(h => h.id === (hook as { id: string }).id),
          "webhook persisted in list"
        );
        const deliveries = await ctx.provider.webhookReplay.list({});
        ctx.assert(Array.isArray(deliveries), "webhook deliveries listed", { count: deliveries.length });
        const replay = await ctx.provider.webhookReplay.replayAll({ status: "failed" });
        ctx.assert(replay.queued === true, "failed deliveries re-queued for replay");
        // Bulk actions on the journey dispute.
        const disputeId = (ctx as unknown as { _d: string })._d;
        const bulk = await ctx.provider.bulkActions.changeStatus({
          ids: [disputeId], status: "open_negotiation",
        });
        ctx.assertEqual(bulk.updated, 1, "bulk status change applied");
        const full = await ctx.provider.disputes.getById({ id: disputeId });
        ctx.assertEqual(full.status, "open_negotiation", "bulk change persisted");
        return { evidence: { webhookId: (hook as { id: string }).id, deliveries: deliveries.length } };
      },
    },
  ],
};

export const j19: Journey = {
  id: "J19",
  title: "Authz grants + API keys + TOTP lifecycle + org settings",
  actor: "platform-admin",
  description:
    "authz.grantAccess/listAccess/revokeAccess (reviewer gains read), apiKeys.create/list/revoke, totp generateSecret→setup→verify→status→disable, orgSettings.upsert/get.",
  steps: [
    {
      name: "authz-grant-verify-revoke",
      async run(ctx) {
        const d = await createJourneyDispute(ctx, "j19");
        (ctx as unknown as { _d: string })._d = d.id;
        // Reviewer starts with no access.
        await expectTrpcError(
          ctx, ctx.reviewer.disputes.getById({ id: d.id }), "FORBIDDEN", "reviewer denied before grant"
        );
        await ctx.provider.authz.grantAccess({
          disputeId: d.id, userId: FIXTURE_USERS.reviewer, permission: "read",
        });
        const access = await ctx.provider.authz.listAccess({ disputeId: d.id });
        ctx.assert(access.length >= 1, "grant persisted", { grants: access.length });
        const asReviewer = await ctx.reviewer.disputes.getById({ id: d.id });
        ctx.assertEqual(asReviewer.id, d.id, "reviewer can read after grant");
        await ctx.provider.authz.revokeAccess({ disputeId: d.id, userId: FIXTURE_USERS.reviewer });
        await expectTrpcError(
          ctx, ctx.reviewer.disputes.getById({ id: d.id }), "FORBIDDEN", "reviewer denied after revoke"
        );
        return { evidence: { disputeId: d.id } };
      },
    },
    {
      name: "api-keys-lifecycle",
      async run(ctx) {
        const created = await ctx.provider.apiKeys.create({
          name: `journey-key-${ctx.ns("j19")}`.slice(0, 100),
          scopes: ["read"],
        });
        ctx.assert(created.key.startsWith("hp_"), "raw key returned once");
        ctx.assert(created.prefix.length === 8, "key prefix returned");
        const keys = await ctx.provider.apiKeys.list();
        const mine = keys.find(k => k.keyPrefix === created.prefix);
        ctx.assert(mine !== undefined, "key persisted (prefix only, no hash leak)");
        ctx.assert(!("keyHash" in (mine as object)), "list never exposes the key hash");
        await ctx.provider.apiKeys.revoke({ id: String(mine!.id) });
        const after = await ctx.provider.apiKeys.list();
        const revoked = after.find(k => k.keyPrefix === created.prefix);
        ctx.assert(revoked!.revokedAt !== null, "revocation persisted");
        return { evidence: { keyPrefix: created.prefix } };
      },
    },
    {
      name: "totp-and-org-settings",
      async run(ctx) {
        const gen = await ctx.patient.totp.generateSecret({ appName: "HealthPoint Journey" });
        ctx.assert(gen.secret.length >= 16, "TOTP secret generated");
        ctx.assert(gen.otpAuthUrl.startsWith("otpauth://"), "otpauth URI returned");
        const setup = await ctx.patient.totp.setup({ secret: gen.secret });
        ctx.assertEqual(setup.backupCodes.length, 8, "8 backup codes issued");
        // Real RFC-6238 token generated headlessly with the same library.
        const token = await totpGenerate({ secret: gen.secret });
        const verified = await ctx.patient.totp.verify({ code: token });
        ctx.assert(verified.success === true, "TOTP verify accepts valid token");
        const status = await ctx.patient.totp.status();
        ctx.assertEqual(status.status, "active", "2FA active after verify");
        const token2 = await totpGenerate({ secret: gen.secret });
        const disabled = await ctx.patient.totp.disable({ code: token2 });
        ctx.assert(disabled.success === true, "TOTP disabled with valid token");
        const after = await ctx.patient.totp.status();
        ctx.assert(after.status !== "active", "2FA no longer active");
        const upsert = await ctx.provider.orgSettings.upsert({
          orgName: `Journey Org ${ctx.ns("j19")}`.slice(0, 120),
          timezone: "America/Chicago",
          defaultPageSize: 25,
          retentionDays: 730,
        });
        ctx.assert(upsert.success === true, "org settings upserted");
        const settings = await ctx.provider.orgSettings.get();
        ctx.assertEqual(settings!.timezone, "America/Chicago", "org settings persisted");
        return { evidence: { totp: after.status, timezone: settings!.timezone } };
      },
    },
  ],
};

export const j20: Journey = {
  id: "J20",
  title: "FHIR/interop: capability fetch fail-closed, CDS hooks, USCDI, Da Vinci PAS, SMART tokens",
  actor: "provider",
  description:
    "fhirCapability.fetch against unreachable EMR → SERVICE_UNAVAILABLE (fail-closed, nothing fabricated); cdsHooks.register/list/toggle; uscdi.updateCompleteness/get; daVinci.submitPAS/list; smartAuth.listTokens.",
  steps: [
    {
      name: "emr-connection-and-fhir-capability-fail-closed",
      async run(ctx) {
        const conn = await ctx.provider.emr.create({
          name: `Journey EMR ${ctx.ns("j20")}`.slice(0, 200),
          emrSystem: "generic-fhir",
          authType: "none",
          baseUrl: "https://127.0.0.1:9/fhir",
          credentials: {},
          fieldMappings: {},
          fhirVersion: "R4",
        });
        (ctx as unknown as { _e: string })._e = String((conn as { id: string }).id);
        // Unreachable endpoint: must raise SERVICE_UNAVAILABLE and persist NOTHING.
        const msg = await expectTrpcError(
          ctx,
          ctx.provider.fhirCapability.fetch({ emrConnectionId: (conn as { id: string }).id }),
          "SERVICE_UNAVAILABLE",
          "unreachable EMR capability fetch fails closed"
        );
        ctx.assert(/metadata/i.test(msg), "error references the /metadata probe", { msg: msg.slice(0, 160) });
        const stored = await ctx.provider.fhirCapability.list({
          emrConnectionId: (conn as { id: string }).id,
        });
        ctx.assertEqual(stored.length, 0, "no fabricated capability statement persisted");
        return { evidence: { emrConnectionId: (conn as { id: string }).id } };
      },
    },
    {
      name: "cds-hooks-and-uscdi",
      async run(ctx) {
        const emrConnectionId = (ctx as unknown as { _e: string })._e;
        const hook = await ctx.provider.cdsHooksRouter.register({
          emrConnectionId,
          hookId: "order-select",
          title: "Journey CDS hook",
          description: "journey registration",
          prefetch: { patient: "Patient/{{context.patientId}}" },
        });
        ctx.assert((hook as { id: string }).id !== undefined, "CDS hook registered");
        const hooks = await ctx.provider.cdsHooksRouter.list({ emrConnectionId });
        ctx.assert(hooks.some(h => h.hookId === "order-select"), "CDS hook listed");
        await ctx.provider.cdsHooksRouter.toggleStatus({
          id: String((hook as { id: string }).id), status: "inactive",
        });
        const after = await ctx.provider.cdsHooksRouter.list({ emrConnectionId });
        ctx.assertEqual(
          after.find(h => h.hookId === "order-select")!.status, "inactive", "hook toggle persisted"
        );
        const d = await createJourneyDispute(ctx, "j20");
        (ctx as unknown as { _d: string })._d = d.id;
        const uscdi = await ctx.provider.uscdi.updateCompleteness({
          disputeId: d.id,
          elements: { patientName: true, dob: true, coverage: true, claimNumber: false },
        });
        ctx.assertEqual(uscdi.score, 75, "USCDI completeness score computed");
        ctx.assert(uscdi.missing.includes("claimNumber"), "missing elements reported");
        const reread = await ctx.provider.uscdi.getCompleteness({ disputeId: d.id });
        ctx.assertEqual(reread!.completenessScore, 75, "USCDI score persisted");
        return { evidence: { uscdiScore: uscdi.score } };
      },
    },
    {
      name: "davinci-pas-and-smart-auth",
      async run(ctx) {
        const disputeId = (ctx as unknown as { _d: string })._d;
        const emrConnectionId = (ctx as unknown as { _e: string })._e;
        const tx = await ctx.provider.daVinci.submitPAS({
          disputeId,
          emrConnectionId,
          requestPayload: { resourceType: "Bundle", type: "collection", note: ctx.runId },
        });
        ctx.assert((tx as { status: string }).status === "pending", "Da Vinci PAS transaction recorded pending");
        const txs = await ctx.provider.daVinci.list({ disputeId });
        ctx.assert(txs.some(t => t.txType === "pas_prior_auth"), "PAS transaction re-readable");
        const tokens = await ctx.provider.smartAuth.listTokens({ emrConnectionId });
        ctx.assert(Array.isArray(tokens), "SMART token list readable (empty is honest)");
        return { evidence: { pasTx: (tx as { id: string }).id, smartTokens: tokens.length } };
      },
    },
  ],
};
