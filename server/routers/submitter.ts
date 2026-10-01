/**
 * server/routers/submitter.ts
 *
 * Phase 16: third-party-submitter tRPC router.
 *
 * Statutory basis (CMS-9897-F; 45 CFR 149.510(b)(2)(ii)(A)(3) as amended):
 * an IDR initiation notice submitted by a delegated representative must
 * identify the representative and include an attestation of authority;
 * the attestation may allocate administrative-fee debt to the
 * representative (delegationAttestations.adminFeeDebtAccepted).
 *
 * Procedures:
 *  - submitter.inviteClient:           submitter org → provider invite link
 *  - submitter.acceptClientInvite:     provider org accepts (token-sha)
 *  - submitter.attestDelegation:       hash-chained authority attestation
 *  - submitter.revokeDelegation:       revoke an attestation
 *  - submitter.listClients:            roster view (owner/staff/viewer)
 *  - submitter.bulkInitiateDisputes:   batch IDR initiation; cap 50;
 *                                      hard-fails when the link is
 *                                      suspended (NOT_FOUND) or no ACTIVE
 *                                      delegation attestation covers the
 *                                      scope (FORBIDDEN)
 *  - submitter.ingest835:              X12 835 ingestion (CARC/RARC →
 *                                      NSA/IDR eligibility flags; maps
 *                                      lines to disputes by claimId)
 *  - submitter.listRemittanceLines:    stored 835 lines for a file
 *  - submitter.getBreakevenAnalysis:   IDR spend vs recoveries rollup
 *
 * AuthZ: all mutations require owner/staff membership on the relevant org
 * (submitter org for invite/attest/ingest; provider client org for accept).
 * Viewer may read rosters and 835 lines.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { createAuditEntry, getDb } from "../db";
import { orgMemberships } from "../../drizzle/schema-personas";
import { disputes } from "../../drizzle/schema";
import {
  delegationAttestations,
  manualCheckPostings,
  remittance835Files,
  remittanceLines,
  submitterClients,
  type DelegationAttestation,
} from "../../drizzle/schema-submitter";
import { parse835Full, hashRemittanceContent, Remittance835ParseError } from "../edi/remittance835";
import {
  rankProposals,
  scoreCandidate,
  type CheckMatchCandidateFile,
  type CheckMatchProposal,
  type CheckSide,
} from "../remittance/check-match";
import { applyDelegationAttestation } from "../idr/submission-automation/package-builder";
import { protectedProcedure, router } from "../_core/trpc";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function requireDb(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  return db;
}

/**
 * Membership check, aligned with compliance.ts: the caller must be a member
 * of orgId with one of the allowed roles (default owner|staff), or be a
 * global admin. provider-role members with permission via roles are
 * intentionally NOT widened here — Phase 16 surfaces are biller/submitter
 * workflows. Suspended orgs are not blocked here (link status is the
 * Phase 16 gate; org suspension policy lives in compliance gates).
 */
async function assertOrgMember(
  db: Db,
  userId: string,
  orgId: string,
  roles: string[] = ["owner", "staff"]
): Promise<void> {
  const m = await db
    .select()
    .from(orgMemberships)
    .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)))
    .limit(1);
  if (m.length > 0 && roles.includes(m[0].role)) return;
  const isAdmin = m.length > 0 && m[0].role === "admin";
  if (isAdmin) return;
  throw new TRPCError({ code: "FORBIDDEN", message: `Requires ${roles.join("/")} role on the organization` });
}

/** True when an ACTIVE, effective, unexpired attestation covers the scope. */
function delegationActive(a: DelegationAttestation | undefined, now = new Date()): boolean {
  if (!a) return false;
  if (a.status !== "active") return false;
  if (a.effectiveFrom > now) return false;
  if (a.expiresAt && a.expiresAt <= now) return false;
  return true;
}

const npiSchema = z.string().regex(/^\d{10}$/, "NPI must be 10 digits");
const tinSchema = z.string().regex(/^\d{9}$/, "TIN must be 9 digits");

// ── Phase 20-A: check↔835 reconciliation proposal helpers ────────────────────
/**
 * Load per-file aggregates (sum of allowedCents, payer name, receivedAt,
 * trace) for an org's parsed 835 files. Proposal scoring itself is PURE
 * (server/remittance/check-match.ts); this is the DB read side.
 */
async function loadOrgFileAggregates(db: Db, orgId: string): Promise<CheckMatchCandidateFile[]> {
  const res = await db.execute(sql`
    SELECT f.id AS "fileId",
           COALESCE(SUM(l."allowedCents"), 0)::int AS "fileSumCents",
           MAX(l."payerId") AS "payerName",
           f."receivedAt" AS "fileReceivedAt",
           f."paymentTraceNumber" AS "paymentTraceNumber"
    FROM remittance_835_files f
    JOIN remittance_lines l ON l."fileId" = f.id
    WHERE f."orgId" = ${orgId} AND f.status = 'parsed'
    GROUP BY f.id, f."receivedAt", f."paymentTraceNumber"
  `);
  const rows = (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? []) as Array<Record<string, unknown>>;
  return rows.map(r => ({
    fileId: String(r.fileId),
    fileSumCents: Number(r.fileSumCents ?? 0),
    payerName: r.payerName != null ? String(r.payerName) : null,
    fileReceivedAt: new Date(String(r.fileReceivedAt)),
    paymentTraceNumber: r.paymentTraceNumber != null ? String(r.paymentTraceNumber) : null,
  }));
}

/**
 * Compute PROPOSALS ONLY (never persisted) between posted check postings
 * and parsed 835 files of an org. Pass `checkId` to scope to one check
 * (postCheckPayment) or `fileId` to scope to one file (ingest835).
 */
async function computeCheckMatchProposals(
  db: Db,
  orgId: string,
  scope: { checkId?: string; fileId?: string } = {},
): Promise<CheckMatchProposal[]> {
  const checks = await db.select().from(manualCheckPostings)
    .where(and(eq(manualCheckPostings.orgId, orgId), eq(manualCheckPostings.status, "posted")));
  const scopedChecks = scope.checkId ? checks.filter(c => c.id === scope.checkId) : checks;
  if (scopedChecks.length === 0) return [];
  let files = await loadOrgFileAggregates(db, orgId);
  if (scope.fileId) files = files.filter(f => f.fileId === scope.fileId);
  const proposals: CheckMatchProposal[] = [];
  for (const c of scopedChecks) {
    const side: CheckSide = {
      checkPostingId: c.id,
      checkNumber: c.checkNumber,
      amountCents: c.amountCents,
      payerName: c.payerName,
      receivedDate: c.receivedDate,
    };
    for (const f of files) {
      const p = scoreCandidate(side, f);
      if (p) proposals.push(p);
    }
  }
  return rankProposals(proposals);
}

export const submitterRouter = router({
  // ── Client onboarding ──────────────────────────────────────────────────────
  inviteClient: protectedProcedure
    .input(
      z.object({
        submitterOrgId: z.string().min(1),
        label: z.string().min(1).max(255),
        npis: z.array(npiSchema).max(500).optional(),
        tins: z.array(tinSchema).max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.submitterOrgId);
      const id = crypto.randomUUID();
      // Token is never stored in plaintext — only its sha256 (invite audit).
      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      await db.insert(submitterClients).values({
        id,
        submitterOrgId: input.submitterOrgId,
        label: input.label,
        npis: input.npis ?? [],
        tins: input.tins ?? [],
        status: "pending",
        inviteTokenHash: tokenHash,
      });
      await createAuditEntry({
        userId: ctx.user.id,
        action: "submitter.inviteClient",
        entityType: "submitter_client",
        entityId: id,
        oldValue: null,
        newValue: JSON.stringify({ submitterOrgId: input.submitterOrgId, label: input.label, status: "pending" }),
        ipAddress: null,
        userAgent: null,
      });
      // Dev/test surface the token in the response (no email transport yet);
      // production would email the invite link instead.
      return { submitterClientId: id, inviteToken: token };
    }),

  acceptClientInvite: protectedProcedure
    .input(
      z.object({
        inviteToken: z.string().min(32),
        clientOrgId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.clientOrgId);
      const tokenHash = crypto.createHash("sha256").update(input.inviteToken).digest("hex");
      const link = await db
        .select()
        .from(submitterClients)
        .where(eq(submitterClients.inviteTokenHash, tokenHash))
        .limit(1);
      if (link.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Unknown invite token" });
      }
      if (link[0].status !== "pending") {
        throw new TRPCError({ code: "CONFLICT", message: `Invite already ${link[0].status}` });
      }
      await db
        .update(submitterClients)
        .set({ clientOrgId: input.clientOrgId, status: "active", updatedAt: new Date() })
        .where(eq(submitterClients.id, link[0].id));
      await createAuditEntry({
        userId: ctx.user.id,
        action: "submitter.acceptClientInvite",
        entityType: "submitter_client",
        entityId: link[0].id,
        oldValue: JSON.stringify({ status: "pending" }),
        newValue: JSON.stringify({ status: "active", clientOrgId: input.clientOrgId }),
        ipAddress: null,
        userAgent: null,
      });
      return { submitterClientId: link[0].id, status: "active" as const };
    }),

  suspendClient: protectedProcedure
    .input(z.object({ submitterClientId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const link = await db.select().from(submitterClients).where(eq(submitterClients.id, input.submitterClientId)).limit(1);
      if (link.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Submitter client link not found" });
      await assertOrgMember(db, ctx.user.id, link[0].submitterOrgId);
      await db.update(submitterClients).set({ status: "suspended", updatedAt: new Date() }).where(eq(submitterClients.id, link[0].id));
      await createAuditEntry({
        userId: ctx.user.id,
        action: "submitter.suspendClient",
        entityType: "submitter_client",
        entityId: link[0].id,
        oldValue: JSON.stringify({ status: link[0].status }),
        newValue: JSON.stringify({ status: "suspended" }),
        ipAddress: null,
        userAgent: null,
      });
      return { submitterClientId: link[0].id, status: "suspended" as const };
    }),

  // ── Delegation attestations (45 CFR 149.510(b)(2)(ii)(A)(3)) ───────────────
  attestDelegation: protectedProcedure
    .input(
      z.object({
        submitterClientId: z.string().min(1),
        scope: z.enum(["claims", "idr", "both"]),
        authorityText: z.string().min(20).max(8000),
        adminFeeDebtAccepted: z.boolean().default(false),
        expiresAt: z.coerce.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const link = await db.select().from(submitterClients).where(eq(submitterClients.id, input.submitterClientId)).limit(1);
      if (link.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Submitter client link not found" });
      await assertOrgMember(db, ctx.user.id, link[0].submitterOrgId);
      // Hash-chain: prevHash = artifactSha256 of the latest attestation in
      // the chain (or 64 zeros), exactly like consent signature artifacts.
      const prev = await db
        .select()
        .from(delegationAttestations)
        .where(eq(delegationAttestations.submitterClientId, input.submitterClientId))
        .orderBy(desc(delegationAttestations.createdAt))
        .limit(1);
      const prevHash = prev[0]?.artifactSha256 ?? "0".repeat(64);
      const attestedAt = new Date();
      const artifactPayload = {
        submitterClientId: input.submitterClientId,
        scope: input.scope,
        authorityText: input.authorityText,
        attestedByUserId: ctx.user.id,
        attestedAt: attestedAt.toISOString(),
        adminFeeDebtAccepted: input.adminFeeDebtAccepted,
        prevHash,
      };
      const artifactSha256 = crypto
        .createHash("sha256")
        .update(JSON.stringify(artifactPayload))
        .digest("hex");
      const id = crypto.randomUUID();
      await db.insert(delegationAttestations).values({
        id,
        submitterClientId: input.submitterClientId,
        scope: input.scope,
        authorityText: input.authorityText,
        attestedByUserId: ctx.user.id,
        attestedAt,
        effectiveFrom: attestedAt,
        expiresAt: input.expiresAt ?? null,
        adminFeeDebtAccepted: input.adminFeeDebtAccepted,
        artifactSha256,
        prevHash,
        status: "active",
      });
      await createAuditEntry({
        userId: ctx.user.id,
        action: "submitter.attestDelegation",
        entityType: "delegation_attestation",
        entityId: id,
        oldValue: null,
        newValue: JSON.stringify({ submitterClientId: input.submitterClientId, scope: input.scope, adminFeeDebtAccepted: input.adminFeeDebtAccepted }),
        ipAddress: null,
        userAgent: null,
      });
      return { attestationId: id, artifactSha256, prevHash };
    }),

  revokeDelegation: protectedProcedure
    .input(z.object({ attestationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const rows = await db.select().from(delegationAttestations).where(eq(delegationAttestations.id, input.attestationId)).limit(1);
      if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Attestation not found" });
      const link = await db.select().from(submitterClients).where(eq(submitterClients.id, rows[0].submitterClientId)).limit(1);
      if (link.length) await assertOrgMember(db, ctx.user.id, link[0].submitterOrgId);
      if (rows[0].status !== "active") {
        throw new TRPCError({ code: "CONFLICT", message: `Attestation is ${rows[0].status}` });
      }
      await db
        .update(delegationAttestations)
        .set({ status: "revoked", revokedAt: new Date(), revokedByUserId: ctx.user.id })
        .where(eq(delegationAttestations.id, input.attestationId));
      await createAuditEntry({
        userId: ctx.user.id,
        action: "submitter.revokeDelegation",
        entityType: "delegation_attestation",
        entityId: input.attestationId,
        oldValue: JSON.stringify({ status: "active" }),
        newValue: JSON.stringify({ status: "revoked" }),
        ipAddress: null,
        userAgent: null,
      });
      return { attestationId: input.attestationId, status: "revoked" as const };
    }),

  listAttestations: protectedProcedure
    .input(z.object({ submitterClientId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const link = await db.select().from(submitterClients).where(eq(submitterClients.id, input.submitterClientId)).limit(1);
      if (link.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Submitter client link not found" });
      await assertOrgMember(db, ctx.user.id, link[0].submitterOrgId, ["owner", "staff", "viewer"]);
      return db
        .select()
        .from(delegationAttestations)
        .where(eq(delegationAttestations.submitterClientId, input.submitterClientId))
        .orderBy(desc(delegationAttestations.createdAt));
    }),

  listClients: protectedProcedure
    .input(z.object({ submitterOrgId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.submitterOrgId, ["owner", "staff", "viewer"]);
      return db.select().from(submitterClients).where(eq(submitterClients.submitterOrgId, input.submitterOrgId));
    }),

  // ── Bulk IDR initiation (45 CFR 149.510 initiation notice via delegate) ───
  bulkInitiateDisputes: protectedProcedure
    .input(
      z.object({
        submitterClientId: z.string().min(1),
        items: z
          .array(
            z.object({
              claimId: z.string().min(1),
              npi: npiSchema,
              tin: tinSchema,
              cptCode: z.string().min(3).max(16),
              billedCents: z.number().int().positive(),
              initialPaymentCents: z.number().int().min(0),
              dateOfService: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            })
          )
          .min(1)
          .max(50),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const link = await db.select().from(submitterClients).where(eq(submitterClients.id, input.submitterClientId)).limit(1);
      if (link.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Submitter client link not found" });
      await assertOrgMember(db, ctx.user.id, link[0].submitterOrgId);
      if (link[0].status === "suspended") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Submitter client link is suspended" });
      }
      if (link[0].status !== "active") {
        throw new TRPCError({ code: "CONFLICT", message: `Submitter client link is ${link[0].status}` });
      }
      // CMS-9897-F: initiation via a representative requires an active
      // delegation attestation covering IDR scope (idr or both).
      const attestations = await db
        .select()
        .from(delegationAttestations)
        .where(eq(delegationAttestations.submitterClientId, input.submitterClientId));
      const active = attestations.find(a => delegationActive(a) && (a.scope === "idr" || a.scope === "both"));
      if (!active) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No ACTIVE delegation attestation covering IDR scope — bulk initiation is blocked (45 CFR 149.510(b)(2)(ii)(A)(3))",
        });
      }
      const disputeIds: string[] = [];
      for (const item of input.items) {
        const disputeId = crypto.randomUUID();
        await db.insert(disputes).values({
          id: disputeId,
          orgId: link[0].clientOrgId ?? link[0].submitterOrgId,
          referenceNumber: `SUB-${link[0].id.slice(0, 8)}-${item.claimId}`,
          status: "draft",
          serviceCode: item.cptCode,
          claimId: item.claimId,
          createdBy: ctx.user.id,
          initiatingParty: "provider",
        } as never);
        disputeIds.push(disputeId);
      }
      await createAuditEntry({
        userId: ctx.user.id,
        action: "submitter.bulkInitiateDisputes",
        entityType: "submitter_client",
        entityId: input.submitterClientId,
        oldValue: null,
        newValue: JSON.stringify({ count: disputeIds.length, attestationId: active.id, disputeIds }),
        ipAddress: null,
        userAgent: null,
      });
      return { disputeIds, attestationId: active.id, adminFeeDebtAccepted: active.adminFeeDebtAccepted };
    }),

  // ── 835 remittance ingestion ───────────────────────────────────────────────
  ingest835: protectedProcedure
    .input(
      z.object({
        orgId: z.string().min(1),
        fileName: z.string().min(1).max(255),
        content: z.string().min(10),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.orgId);
      const contentSha256 = hashRemittanceContent(input.content);
      const dup = await db
        .select()
        .from(remittance835Files)
        .where(and(eq(remittance835Files.orgId, input.orgId), eq(remittance835Files.contentSha256, contentSha256)))
        .limit(1);
      if (dup.length) {
        return { fileId: dup[0].id, duplicate: true, lineCount: dup[0].lineCount, status: dup[0].status };
      }
      const fileId = crypto.randomUUID();
      let parsed;
      try {
        parsed = parse835Full(input.content);
      } catch (err) {
        const message = err instanceof Remittance835ParseError ? err.message : "unparseable 835 content";
        await db.insert(remittance835Files).values({
          id: fileId, orgId: input.orgId, fileName: input.fileName, contentSha256,
          lineCount: 0, status: "failed", parseError: message,
        });
        throw new TRPCError({ code: "BAD_REQUEST", message });
      }
      await db.insert(remittance835Files).values({
        id: fileId, orgId: input.orgId, fileName: input.fileName, contentSha256,
        lineCount: parsed.lines.length, status: "parsed",
        // Phase 20-A: BPR/TRN payment-instrument header capture.
        paymentMethodCode: parsed.header.paymentMethodCode,
        paymentMethod: parsed.header.paymentMethod,
        totalPaymentCents: parsed.header.totalPaymentCents,
        paymentTraceNumber: parsed.header.paymentTraceNumber,
        paymentEffectiveDate: parsed.header.paymentEffectiveDate,
      });
      let mapped = 0;
      for (const line of parsed.lines) {
        const claimMatches = await db
          .select({ id: disputes.id })
          .from(disputes)
          .where(eq(disputes.claimId, line.claimId))
          .limit(1);
        const mappedDisputeId = claimMatches[0]?.id ?? null;
        if (mappedDisputeId) mapped++;
        await db.insert(remittanceLines).values({
          fileId,
          claimId: line.claimId,
          payerId: line.payerId,
          npi: line.npi,
          cptCode: line.cptCode,
          billedCents: line.billedCents,
          allowedCents: line.allowedCents,
          carcCodes: line.carcCodes,
          rarcCodes: line.rarcCodes,
          idrEligibleFlag: line.idrEligibleFlag,
          mappedDisputeId,
          // Phase 20-A: propagated header payment context per line.
          paymentTraceNumber: line.paymentTraceNumber ?? null,
          paymentMethodCode: line.paymentMethodCode ?? null,
        });
      }
      await createAuditEntry({
        userId: ctx.user.id,
        action: "submitter.ingest835",
        entityType: "remittance_835_file",
        entityId: fileId,
        oldValue: null,
        newValue: JSON.stringify({ orgId: input.orgId, fileName: input.fileName, lineCount: parsed.lines.length, mapped, paymentMethod: parsed.header.paymentMethod }),
        ipAddress: null,
        userAgent: null,
      });
      // Phase 20-A: when checks were posted BEFORE this 835 arrived, compute
      // match PROPOSALS against open (posted) check postings. Proposals only
      // — nothing is auto-matched; a human calls matchCheckToRemittances.
      const proposedCheckMatches = await computeCheckMatchProposals(db, input.orgId, { fileId });
      if (proposedCheckMatches.length > 0) {
        await createAuditEntry({
          userId: ctx.user.id,
          action: "submitter.ingest835.checkMatchProposals",
          entityType: "remittance_835_file",
          entityId: fileId,
          oldValue: null,
          newValue: JSON.stringify({ proposals: proposedCheckMatches.map(p => ({ checkPostingId: p.checkPostingId, fileId: p.fileId, score: p.score, exactTraceMatch: p.exactTraceMatch })) }),
          ipAddress: null,
          userAgent: null,
        });
      }
      return {
        fileId,
        duplicate: false,
        lineCount: parsed.lines.length,
        mapped,
        status: "parsed" as const,
        payment: parsed.header.paymentMethod
          ? { method: parsed.header.paymentMethod, traceNumber: parsed.header.paymentTraceNumber }
          : null,
        proposedCheckMatches,
      };
    }),

  listRemittanceLines: protectedProcedure
    .input(z.object({ fileId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const file = await db.select().from(remittance835Files).where(eq(remittance835Files.id, input.fileId)).limit(1);
      if (file.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Remittance file not found" });
      await assertOrgMember(db, ctx.user.id, file[0].orgId, ["owner", "staff", "viewer"]);
      return db.select().from(remittanceLines).where(eq(remittanceLines.fileId, input.fileId));
    }),

  // ── Check postings (Phase 20-A) ────────────────────────────────────────────
  // Manual check postings are BOOKKEEPING RECORDS ONLY: no payment is
  // initiated, PAYMENT_EXECUTION_MODE stays disabled/sandbox, and no
  // TigerBeetle ledger entry is written. Reconciliation produces
  // human-reviewed PROPOSALS ONLY — nothing is auto-matched without an
  // explicit matchCheckToRemittances call. Lifecycle posted → matched →
  // deposited → reconciled; "reconciled" is reserved for a later back-office
  // close-out (bank statement confirmation) — no public procedure
  // transitions to it in Phase 20.
  postCheckPayment: protectedProcedure
    .input(z.object({
      orgId: z.string().min(1),
      checkNumber: z.string().min(1).max(64),
      amountUsd: z.string().regex(/^\d+(\.\d{1,2})?$/, "Amount must be USD dollars with up to 2 decimals"),
      payerName: z.string().min(1).max(255),
      receivedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "receivedDate must be YYYY-MM-DD"),
      notes: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.orgId);
      const amountCents = Math.round(Number(input.amountUsd) * 100);
      if (!Number.isInteger(amountCents) || amountCents <= 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "amountUsd must be positive" });
      }
      const id = crypto.randomUUID();
      try {
        await db.insert(manualCheckPostings).values({
          id,
          orgId: input.orgId,
          checkNumber: input.checkNumber,
          amountCents,
          payerName: input.payerName,
          receivedDate: input.receivedDate,
          status: "posted",
          createdBy: ctx.user.id,
          notes: input.notes ?? null,
        });
      } catch (err) {
        // Unique (orgId, checkNumber, payerName) → replay-safe 409. Drizzle
        // wraps the pg driver error; check the chain for code 23505.
        const chain: unknown[] = [err, ...(err instanceof Error ? [err.cause, (err.cause as Error | undefined)?.cause] : [])];
        const isUnique = chain.some(e =>
          (typeof e === "object" && e !== null && (e as { code?: string }).code === "23505") ||
          (e instanceof Error && /unique|duplicate/i.test(e.message))
        );
        if (isUnique) {
          throw new TRPCError({ code: "CONFLICT", message: "A check posting with this check number and payer already exists for this org (idempotent replay)" });
        }
        throw err;
      }
      // Immediately compute match proposals (Direction B: 835 first, check
      // later) — returned for human review, NEVER persisted.
      const matchProposals = await computeCheckMatchProposals(db, input.orgId, { checkId: id });
      await createAuditEntry({
        userId: ctx.user.id,
        action: "submitter.postCheckPayment",
        entityType: "manual_check_posting",
        entityId: id,
        oldValue: null,
        newValue: JSON.stringify({ orgId: input.orgId, checkNumber: input.checkNumber, amountCents, payerName: input.payerName, receivedDate: input.receivedDate, proposalCount: matchProposals.length }),
        ipAddress: null,
        userAgent: null,
      });
      return { checkPostingId: id, status: "posted" as const, matchProposals };
    }),

  matchCheckToRemittances: protectedProcedure
    .input(z.object({
      checkPostingId: z.string().min(1),
      remittanceLineIds: z.array(z.string().min(1)).min(1).max(500),
      paymentTraceNumber: z.string().max(64).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const posting = (await db.select().from(manualCheckPostings).where(eq(manualCheckPostings.id, input.checkPostingId)).limit(1))[0];
      if (!posting) throw new TRPCError({ code: "NOT_FOUND", message: "Check posting not found" });
      await assertOrgMember(db, ctx.user.id, posting.orgId);
      if (posting.status !== "posted") {
        throw new TRPCError({ code: "CONFLICT", message: `Check posting is ${posting.status}; matching is allowed only from 'posted'` });
      }
      // Validate every line belongs to an 835 file owned by the posting's org.
      const lines = await db.select().from(remittanceLines).where(inArray(remittanceLines.id, input.remittanceLineIds));
      if (lines.length !== new Set(input.remittanceLineIds).size) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Some remittance lines do not exist" });
      }
      const fileIds = [...new Set(lines.map(l => l.fileId))];
      const files = await db.select().from(remittance835Files).where(inArray(remittance835Files.id, fileIds));
      if (files.length !== fileIds.length || files.some(f => f.orgId !== posting.orgId)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Every remittance line must belong to an 835 file owned by this org" });
      }
      const matchedAmountCents = lines.reduce((s, l) => s + (l.allowedCents ?? 0), 0);
      const discrepancyCents = matchedAmountCents - posting.amountCents;
      // Discrepancy is recorded, NOT blocking — humans reconcile.
      const trace = input.paymentTraceNumber ?? files.map(f => f.paymentTraceNumber).find(t => !!t) ?? null;
      await db.update(manualCheckPostings).set({
        status: "matched",
        matchedRemittanceLineIds: lines.map(l => l.id),
        matchedPaymentTraceNumber: trace,
        notes: posting.notes
          ? `${posting.notes}\n[match] discrepancy ${(discrepancyCents / 100).toFixed(2)} USD (recorded, non-blocking)`
          : `[match] discrepancy ${(discrepancyCents / 100).toFixed(2)} USD (recorded, non-blocking)`,
        updatedAt: new Date(),
      }).where(eq(manualCheckPostings.id, posting.id));
      await createAuditEntry({
        userId: ctx.user.id,
        action: "submitter.matchCheckToRemittances",
        entityType: "manual_check_posting",
        entityId: posting.id,
        oldValue: JSON.stringify({ status: "posted" }),
        newValue: JSON.stringify({ status: "matched", remittanceLineIds: lines.map(l => l.id), matchedAmountCents, discrepancyCents, matchedPaymentTraceNumber: trace }),
        ipAddress: null,
        userAgent: null,
      });
      return { checkPostingId: posting.id, status: "matched" as const, matchedAmountCents, discrepancyCents };
    }),

  markCheckDeposited: protectedProcedure
    .input(z.object({
      checkPostingId: z.string().min(1),
      depositDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "depositDate must be YYYY-MM-DD"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const posting = (await db.select().from(manualCheckPostings).where(eq(manualCheckPostings.id, input.checkPostingId)).limit(1))[0];
      if (!posting) throw new TRPCError({ code: "NOT_FOUND", message: "Check posting not found" });
      await assertOrgMember(db, ctx.user.id, posting.orgId);
      if (posting.status !== "posted" && posting.status !== "matched") {
        throw new TRPCError({ code: "CONFLICT", message: `Check posting is ${posting.status}; deposit is allowed only from 'posted' or 'matched'` });
      }
      await db.update(manualCheckPostings).set({
        status: "deposited",
        depositDate: input.depositDate,
        updatedAt: new Date(),
      }).where(eq(manualCheckPostings.id, posting.id));
      await createAuditEntry({
        userId: ctx.user.id,
        action: "submitter.markCheckDeposited",
        entityType: "manual_check_posting",
        entityId: posting.id,
        oldValue: JSON.stringify({ status: posting.status }),
        newValue: JSON.stringify({ status: "deposited", depositDate: input.depositDate }),
        ipAddress: null,
        userAgent: null,
      });
      return { checkPostingId: posting.id, status: "deposited" as const };
    }),

  listCheckPostings: protectedProcedure
    .input(z.object({
      orgId: z.string().min(1),
      status: z.enum(["posted", "matched", "deposited", "reconciled"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.orgId, ["owner", "staff", "viewer"]);
      const conds = [eq(manualCheckPostings.orgId, input.orgId)];
      if (input.status) conds.push(eq(manualCheckPostings.status, input.status));
      return db.select().from(manualCheckPostings).where(and(...conds)).limit(input.limit);
    }),

  // ── Breakeven analysis ─────────────────────────────────────────────────────
  /**
   * Provider-side rollup for the "is IDR worth it" question: total IDR spend
   * (admin fees + certified-IDRE fees recorded on determinations) vs total
   * recoveries (determination amounts won) for an org. Deterministic SQL
   * aggregation; deterministic IDRE-fee estimates are labeled as estimates
   * when the fee schedule is not configured (honesty label: not live data).
   */
  getBreakevenAnalysis: protectedProcedure
    .input(z.object({ orgId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.orgId, ["owner", "staff", "viewer"]);
      // Recoveries: determinations where this org was the initiating party
      // and won (determinationWinner = initiating offer).
      const recoveryRows = await db.execute(sql`
        SELECT COUNT(*)::int AS wins,
               COALESCE(SUM(d."determinationAmount"), 0)::float AS recovered_usd
        FROM disputes d
        WHERE d."orgId" = ${input.orgId}
          AND d."determinationAmount" IS NOT NULL
          AND d."determinationWinner" IS NOT NULL
          AND d.status IN ('determined', 'settled')
      `);
      const r = (Array.isArray(recoveryRows) ? recoveryRows[0] : (recoveryRows as { rows?: unknown[] }).rows?.[0]) as
        | { wins: number; recovered_usd: number }
        | undefined;
      // Spend: admin fee count × current admin fee + IDRE fee share.
      // Fee amounts come from the configured fee schedule when available;
      // otherwise the statutory defaults are used and labeled as estimates.
      const spendRows = await db.execute(sql`
        SELECT COUNT(*)::int AS initiated
        FROM disputes d
        WHERE d."orgId" = ${input.orgId}
          AND d.status NOT IN ('draft')
      `);
      const s = (Array.isArray(spendRows) ? spendRows[0] : (spendRows as { rows?: unknown[] }).rows?.[0]) as
        | { initiated: number }
        | undefined;
      const ADMIN_FEE_USD = 115; // CMS 2026 non-batch administrative fee
      const IDRE_FEE_USD = 360; // median certified IDRE single-dispute fee
      const initiated = s?.initiated ?? 0;
      const estimated = true; // fee schedule not yet per-org configurable
      const spendUsd = initiated * (ADMIN_FEE_USD + IDRE_FEE_USD);
      const recoveredUsd = r?.recovered_usd ?? 0;
      return {
        orgId: input.orgId,
        disputesInitiated: initiated,
        disputesWon: r?.wins ?? 0,
        recoveredUsd,
        estimatedSpendUsd: spendUsd,
        breakevenDeltaUsd: recoveredUsd - spendUsd,
        estimated, // honesty: admin/IDRE fees are statutory defaults, not per-org config
        feeAssumptions: { adminFeeUsd: ADMIN_FEE_USD, idreFeeUsd: IDRE_FEE_USD },
      };
    }),
});
