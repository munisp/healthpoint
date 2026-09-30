/**
 * server/routers/submitter.ts
 *
 * Phase 16: third-party-submitter (delegated representative) surface.
 *
 * Statutory basis: CMS-9897-F, 45 CFR 149.510(b)(2)(ii)(A)(3) as amended —
 * a third party representing a disputing party must be identified and an
 * attestation of authority must accompany IDR initiation; the attestation
 * may allocate administrative-fee debt. RARC N830 / eligible CARCs on 835
 * remittances signal NSA/IDR eligibility.
 *
 * AuthZ: every procedure asserts org_memberships membership of the caller in
 * the relevant submitter (or client) org; org suspension blocks mutations
 * (same policy as server/routers/personas.ts).
 *
 * Registered via rootRouter merge in server/app-router.ts (routers.ts is a
 * shared-ownership file).
 */
import crypto from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { createAuditEntry, createDispute } from "../db";
import { disputes } from "../../drizzle/schema";
import { organizations, orgMemberships } from "../../drizzle/schema-personas";
import {
  delegationAttestations,
  remittance835Files,
  remittanceLines,
  submitterClients,
  type DelegationAttestation,
} from "../../drizzle/schema-submitter";
import { parse835, hashRemittanceContent, Remittance835ParseError } from "../edi/remittance835";
import { getAdminFeeFromDb } from "../fee-schedule";
import { getEffectiveIDRParameters } from "../idr/clocks-2026/params-2026";
import { requireDb } from "../personas/guards";

/** Phase13-FA invite policy: delegation invite links live 14 days. */
const DELEGATION_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

type Db = Awaited<ReturnType<typeof requireDb>>;

async function assertOrgMember(db: Db, userId: string, orgId: string, roles: string[] = ["owner", "staff"]) {
  const rows = await db
    .select()
    .from(orgMemberships)
    .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)))
    .limit(1);
  const m = rows[0];
  if (!m || !roles.includes(m.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You are not an authorized member of this organization" });
  }
  const org = (await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1))[0];
  if (!org) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
  if (org.status !== "active") {
    throw new TRPCError({ code: "FORBIDDEN", message: `Organization "${org.name}" is ${org.status}; mutations blocked` });
  }
  return { membership: m, org };
}

async function loadClientLink(db: Db, submitterClientId: string) {
  const rows = await db.select().from(submitterClients).where(eq(submitterClients.id, submitterClientId)).limit(1);
  const link = rows[0];
  if (!link) throw new TRPCError({ code: "NOT_FOUND", message: "Submitter client link not found" });
  return link;
}

function scopeCovers(scope: string, needed: "claims" | "idr"): boolean {
  return scope === "both" || scope === needed;
}

/**
 * Resolve the currently valid attestation for a submitter client link:
 * status active, not revoked, within the effective window, scope covering
 * `needed`. Returns null when none qualifies (fail-closed).
 */
async function resolveValidAttestation(db: Db, submitterClientId: string, needed: "claims" | "idr", now = new Date()) {
  const rows = await db
    .select()
    .from(delegationAttestations)
    .where(and(eq(delegationAttestations.submitterClientId, submitterClientId), eq(delegationAttestations.status, "active")));
  const valid = rows.filter(a =>
    !a.revokedAt &&
    scopeCovers(a.scope, needed) &&
    new Date(a.effectiveFrom) <= now &&
    (!a.expiresAt || new Date(a.expiresAt) > now)
  );
  // Most recent wins.
  valid.sort((a, b) => new Date(b.attestedAt).getTime() - new Date(a.attestedAt).getTime());
  return valid[0] ?? null;
}

/** Canonical artifact string for the tamper-evident attestation hash. */
function canonicalAttestationArtifact(a: {
  id: string;
  submitterClientId: string;
  scope: string;
  authorityText: string;
  attestedByUserId: string;
  attestedAt: string;
  effectiveFrom: string;
  expiresAt: string | null;
  adminFeeDebtAccepted: boolean;
}): string {
  return JSON.stringify({
    id: a.id,
    submitterClientId: a.submitterClientId,
    scope: a.scope,
    authorityText: a.authorityText,
    attestedByUserId: a.attestedByUserId,
    attestedAt: a.attestedAt,
    effectiveFrom: a.effectiveFrom,
    expiresAt: a.expiresAt,
    adminFeeDebtAccepted: a.adminFeeDebtAccepted,
  });
}

function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

const npiSchema = z.string().regex(/^\d{10}$/, "NPI must be 10 digits");
const tinSchema = z.string().regex(/^\d{9}$/, "TIN must be 9 digits");

export const submitterRouter = router({
  // ── Client links ──────────────────────────────────────────────────────────
  listClients: protectedProcedure
    .input(z.object({ submitterOrgId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.submitterOrgId, ["owner", "staff", "viewer"]);
      return db.select().from(submitterClients).where(eq(submitterClients.submitterOrgId, input.submitterOrgId));
    }),

  /**
   * Invite a provider client org to delegate submission authority. Creates a
   * pending submitter_clients row and returns the raw bearer token ONCE —
   * only its sha256 persists (Phase-13 invite-token pattern).
   */
  inviteClient: protectedProcedure
    .input(z.object({
      submitterOrgId: z.string().min(1),
      label: z.string().min(1).max(255),
      clientOrgId: z.string().min(1).optional(),
      npis: z.array(npiSchema).max(500).default([]),
      tins: z.array(tinSchema).max(100).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.submitterOrgId);
      if (input.clientOrgId) {
        // The client org must exist when pre-bound.
        const clientOrg = (await db.select().from(organizations).where(eq(organizations.id, input.clientOrgId)).limit(1))[0];
        if (!clientOrg) throw new TRPCError({ code: "NOT_FOUND", message: "Client organization not found" });
        const existing = await db.select().from(submitterClients).where(
          and(eq(submitterClients.submitterOrgId, input.submitterOrgId), eq(submitterClients.clientOrgId, input.clientOrgId))
        ).limit(1);
        if (existing.length) {
          throw new TRPCError({ code: "CONFLICT", message: "A submitter-client link already exists for this org pair" });
        }
      }
      const rawToken = crypto.randomBytes(32).toString("base64url");
      const id = crypto.randomUUID();
      await db.insert(submitterClients).values({
        id,
        submitterOrgId: input.submitterOrgId,
        clientOrgId: input.clientOrgId ?? null,
        label: input.label,
        npis: input.npis,
        tins: input.tins,
        status: "pending",
        inviteTokenHash: sha256Hex(rawToken),
      });
      await createAuditEntry({
        userId: ctx.user.id,
        action: "submitter.inviteClient",
        entityType: "submitter_client",
        entityId: id,
        oldValue: null,
        newValue: JSON.stringify({ submitterOrgId: input.submitterOrgId, label: input.label, clientOrgId: input.clientOrgId ?? null }),
        ipAddress: null,
        userAgent: null,
      });
      return { submitterClientId: id, inviteToken: rawToken, status: "pending" as const, expiresInDays: 14 };
    }),

  /**
   * Accept a delegation invite. The caller must be a member of the client org
   * (when the link is pre-bound) — acceptance activates the link, binds the
   * caller's org when unbound, and burns the single-use token.
   */
  acceptDelegation: protectedProcedure
    .input(z.object({ token: z.string().min(1).max(256) }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const hash = sha256Hex(input.token);
      const rows = await db.select().from(submitterClients).where(eq(submitterClients.inviteTokenHash, hash)).limit(1);
      const link = rows[0];
      if (!link) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid delegation invite token" });
      if (link.status !== "pending") {
        throw new TRPCError({ code: "CONFLICT", message: "Delegation invite has already been consumed or is not pending" });
      }
      if (Date.now() - new Date(link.createdAt).getTime() > DELEGATION_INVITE_TTL_MS) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Delegation invite token has expired (14-day TTL)" });
      }
      // Resolve the caller's provider org to bind as the client.
      const memberships = await db.select().from(orgMemberships).where(eq(orgMemberships.userId, ctx.user.id));
      let clientOrgId = link.clientOrgId;
      if (clientOrgId) {
        const ok = memberships.some(m => m.orgId === clientOrgId && ["owner", "staff"].includes(m.role));
        if (!ok) throw new TRPCError({ code: "FORBIDDEN", message: "You are not an authorized member of the invited client organization" });
      } else {
        const providerMembership = memberships.find(m => ["owner", "staff"].includes(m.role));
        if (!providerMembership) throw new TRPCError({ code: "FORBIDDEN", message: "You must belong to an organization to accept a delegation invite" });
        clientOrgId = providerMembership.orgId;
      }
      await db.update(submitterClients).set({
        clientOrgId,
        status: "active",
        inviteTokenHash: null, // single-use: burn the token
        updatedAt: new Date(),
      }).where(eq(submitterClients.id, link.id));
      await createAuditEntry({
        userId: ctx.user.id,
        action: "submitter.acceptDelegation",
        entityType: "submitter_client",
        entityId: link.id,
        oldValue: JSON.stringify({ status: "pending", clientOrgId: link.clientOrgId }),
        newValue: JSON.stringify({ status: "active", clientOrgId }),
        ipAddress: null,
        userAgent: null,
      });
      return { submitterClientId: link.id, clientOrgId, status: "active" as const };
    }),

  updateClientStatus: protectedProcedure
    .input(z.object({
      submitterClientId: z.string().min(1),
      status: z.enum(["active", "suspended", "terminated"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const link = await loadClientLink(db, input.submitterClientId);
      await assertOrgMember(db, ctx.user.id, link.submitterOrgId);
      await db.update(submitterClients).set({ status: input.status, updatedAt: new Date() })
        .where(eq(submitterClients.id, input.submitterClientId));
      return { submitterClientId: input.submitterClientId, status: input.status };
    }),

  updateClientRoster: protectedProcedure
    .input(z.object({
      submitterClientId: z.string().min(1),
      npis: z.array(npiSchema).max(500),
      tins: z.array(tinSchema).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const link = await loadClientLink(db, input.submitterClientId);
      await assertOrgMember(db, ctx.user.id, link.submitterOrgId);
      await db.update(submitterClients).set({ npis: input.npis, tins: input.tins, updatedAt: new Date() })
        .where(eq(submitterClients.id, input.submitterClientId));
      return { submitterClientId: input.submitterClientId, npis: input.npis, tins: input.tins };
    }),

  // ── Delegation attestations (hash-chained, tamper-evident) ────────────────
  issueAttestation: protectedProcedure
    .input(z.object({
      submitterClientId: z.string().min(1),
      scope: z.enum(["claims", "idr", "both"]),
      authorityText: z.string().min(10).max(10000),
      effectiveFrom: z.coerce.date().optional(),
      expiresAt: z.coerce.date().optional(),
      adminFeeDebtAccepted: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const link = await loadClientLink(db, input.submitterClientId);
      if (link.status !== "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Submitter client link is ${link.status}; attestations require an active delegation` });
      }
      // Caller must be authorized on either side of the delegation.
      const submitterSide = await db.select().from(orgMemberships)
        .where(and(eq(orgMemberships.orgId, link.submitterOrgId), eq(orgMemberships.userId, ctx.user.id))).limit(1);
      const clientSide = link.clientOrgId
        ? await db.select().from(orgMemberships)
          .where(and(eq(orgMemberships.orgId, link.clientOrgId), eq(orgMemberships.userId, ctx.user.id))).limit(1)
        : [];
      if (!submitterSide.length && !clientSide.length) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only members of the submitter or client organization may attest" });
      }
      const now = new Date();
      const effectiveFrom = input.effectiveFrom ?? now;
      if (input.expiresAt && input.expiresAt <= effectiveFrom) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "expiresAt must be after effectiveFrom" });
      }
      const id = crypto.randomUUID();
      const artifact = canonicalAttestationArtifact({
        id,
        submitterClientId: link.id,
        scope: input.scope,
        authorityText: input.authorityText,
        attestedByUserId: ctx.user.id,
        attestedAt: now.toISOString(),
        effectiveFrom: effectiveFrom.toISOString(),
        expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null,
        adminFeeDebtAccepted: input.adminFeeDebtAccepted,
      });
      // Hash chain: prevHash = artifact hash of the latest attestation for
      // this link (zeros for the first), like consent signature artifacts.
      const prior = await db.select().from(delegationAttestations)
        .where(eq(delegationAttestations.submitterClientId, link.id));
      prior.sort((a, b) => new Date(b.attestedAt).getTime() - new Date(a.attestedAt).getTime());
      const prevHash = prior[0]?.artifactSha256 ?? "0".repeat(64);
      const artifactSha256 = sha256Hex(artifact + prevHash);
      await db.insert(delegationAttestations).values({
        id,
        submitterClientId: link.id,
        scope: input.scope,
        authorityText: input.authorityText,
        attestedByUserId: ctx.user.id,
        attestedAt: now,
        effectiveFrom,
        expiresAt: input.expiresAt ?? null,
        adminFeeDebtAccepted: input.adminFeeDebtAccepted,
        artifactSha256,
        prevHash,
        status: "active",
      });
      await createAuditEntry({
        userId: ctx.user.id,
        action: "submitter.issueAttestation",
        entityType: "delegation_attestation",
        entityId: id,
        oldValue: null,
        newValue: JSON.stringify({ submitterClientId: link.id, scope: input.scope, adminFeeDebtAccepted: input.adminFeeDebtAccepted }),
        ipAddress: null,
        userAgent: null,
      });
      return { attestationId: id, artifactSha256, prevHash, status: "active" as const };
    }),

  /** Verify artifact integrity + chain continuity for one attestation. */
  verifyAttestation: protectedProcedure
    .input(z.object({ attestationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const rows = await db.select().from(delegationAttestations).where(eq(delegationAttestations.id, input.attestationId)).limit(1);
      const att = rows[0] as DelegationAttestation | undefined;
      if (!att) throw new TRPCError({ code: "NOT_FOUND", message: "Attestation not found" });
      const link = await loadClientLink(db, att.submitterClientId);
      // Read access: member of either org (or admin).
      const memberOrgs = (await db.select().from(orgMemberships).where(eq(orgMemberships.userId, ctx.user.id))).map(m => m.orgId);
      if (ctx.user.role !== "admin" && !memberOrgs.includes(link.submitterOrgId) && !(link.clientOrgId && memberOrgs.includes(link.clientOrgId))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No access to this attestation" });
      }
      const recomputed = sha256Hex(canonicalAttestationArtifact({
        id: att.id,
        submitterClientId: att.submitterClientId,
        scope: att.scope,
        authorityText: att.authorityText,
        attestedByUserId: att.attestedByUserId,
        attestedAt: new Date(att.attestedAt).toISOString(),
        effectiveFrom: new Date(att.effectiveFrom).toISOString(),
        expiresAt: att.expiresAt ? new Date(att.expiresAt).toISOString() : null,
        adminFeeDebtAccepted: att.adminFeeDebtAccepted,
      }) + att.prevHash);
      const artifactValid = recomputed === att.artifactSha256;
      // Chain continuity: prevHash equals the artifact hash of the latest
      // attestation issued BEFORE this one (or zeros when first).
      const siblings = await db.select().from(delegationAttestations)
        .where(eq(delegationAttestations.submitterClientId, att.submitterClientId));
      const earlier = siblings
        .filter(s => s.id !== att.id && new Date(s.attestedAt) < new Date(att.attestedAt))
        .sort((a, b) => new Date(b.attestedAt).getTime() - new Date(a.attestedAt).getTime());
      const expectedPrev = earlier[0]?.artifactSha256 ?? "0".repeat(64);
      const chainValid = att.prevHash === expectedPrev;
      const now = new Date();
      const currentlyValid =
        artifactValid && chainValid && att.status === "active" && !att.revokedAt &&
        new Date(att.effectiveFrom) <= now && (!att.expiresAt || new Date(att.expiresAt) > now);
      return {
        attestationId: att.id,
        artifactValid,
        chainValid,
        currentlyValid,
        status: att.status,
        scope: att.scope,
        expiresAt: att.expiresAt,
      };
    }),

  revokeAttestation: protectedProcedure
    .input(z.object({ attestationId: z.string().min(1), reason: z.string().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const rows = await db.select().from(delegationAttestations).where(eq(delegationAttestations.id, input.attestationId)).limit(1);
      const att = rows[0];
      if (!att) throw new TRPCError({ code: "NOT_FOUND", message: "Attestation not found" });
      const link = await loadClientLink(db, att.submitterClientId);
      await assertOrgMember(db, ctx.user.id, link.submitterOrgId);
      if (att.revokedAt || att.status === "revoked") {
        throw new TRPCError({ code: "CONFLICT", message: "Attestation is already revoked" });
      }
      await db.update(delegationAttestations).set({
        status: "revoked",
        revokedAt: new Date(),
        revokedByUserId: ctx.user.id,
      }).where(eq(delegationAttestations.id, att.id));
      await createAuditEntry({
        userId: ctx.user.id,
        action: "submitter.revokeAttestation",
        entityType: "delegation_attestation",
        entityId: att.id,
        oldValue: JSON.stringify({ status: att.status }),
        newValue: JSON.stringify({ status: "revoked", reason: input.reason }),
        ipAddress: null,
        userAgent: null,
      });
      return { attestationId: att.id, status: "revoked" as const };
    }),

  // ── Submitter-scoped dispute creation ──────────────────────────────────────
  /**
   * Create a dispute on behalf of a provider client. Requires an active
   * delegation attestation covering the "idr" scope; the dispute records the
   * submitter client link, the attestation id, and the eligibility-attestation
   * timestamp (45 CFR 149.510(b)(2)(ii)(A)(3); eligibility integrity trail).
   */
  createDelegatedDispute: protectedProcedure
    .input(z.object({
      submitterClientId: z.string().min(1),
      initiatingPartyType: z.enum(["provider", "facility", "oqp"] as const),
      initiatingPartyName: z.string().min(1),
      initiatingPartyNpi: z.string().optional(),
      respondingPartyType: z.enum(["payer"] as const).optional(),
      respondingPartyName: z.string().optional(),
      serviceType: z.enum(["emergency_medicine", "anesthesiology", "pathology", "radiology", "neonatology", "assistant_surgeon", "hospitalist", "intensivist", "air_ambulance", "ground_ambulance", "other"]),
      serviceDate: z.string().datetime(),
      patientState: z.string().length(2),
      facilityState: z.string().length(2),
      cptCodes: z.array(z.string()).min(1),
      billedAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
      initialPaymentDate: z.string().datetime().optional(),
      notes: z.string().optional(),
      /** Explicit eligibility attestation: the submitter asserts it screened
       *  federal IDR eligibility for these items (anti-mass-filing control). */
      eligibilityAttested: z.literal(true),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const link = await loadClientLink(db, input.submitterClientId);
      if (link.status !== "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Submitter client link is ${link.status}; dispute creation requires an active delegation` });
      }
      await assertOrgMember(db, ctx.user.id, link.submitterOrgId);
      const attestation = await resolveValidAttestation(db, link.id, "idr");
      if (!attestation) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "No valid (active, unexpired, IDR-scope) delegation attestation exists for this " +
            "submitter client. 45 CFR 149.510(b)(2)(ii)(A)(3) requires an authority attestation " +
            "before a representative may submit on a party's behalf.",
        });
      }
      // NPI roster enforcement: when the link declares NPIs, the dispute's NPI
      // must be on the roster (eligibility-integrity control).
      const npis = Array.isArray(link.npis) ? (link.npis as string[]) : [];
      if (npis.length > 0 && input.initiatingPartyNpi && !npis.includes(input.initiatingPartyNpi)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `NPI ${input.initiatingPartyNpi} is not on the delegation roster for this client link` });
      }
      const dispute = await createDispute({
        initiatingPartyType: input.initiatingPartyType,
        initiatingPartyName: input.initiatingPartyName,
        initiatingPartyNpi: input.initiatingPartyNpi ?? null,
        initiatingPartyId: ctx.user.id,
        respondingPartyType: input.respondingPartyType ?? null,
        respondingPartyName: input.respondingPartyName ?? null,
        serviceType: input.serviceType,
        serviceDate: new Date(input.serviceDate),
        initialPaymentDate: input.initialPaymentDate ? new Date(input.initialPaymentDate) : undefined,
        patientState: input.patientState,
        facilityState: input.facilityState,
        cptCodes: input.cptCodes,
        billedAmount: input.billedAmount,
        notes: input.notes ?? null,
        createdBy: ctx.user.id,
        submitterClientId: link.id,
        delegationAttestationId: attestation.id,
        eligibilityAttestedAt: new Date(),
      } as Parameters<typeof createDispute>[0]);
      await createAuditEntry({
        userId: ctx.user.id,
        action: "submitter.createDelegatedDispute",
        entityType: "dispute",
        entityId: dispute.id,
        oldValue: null,
        newValue: JSON.stringify({ submitterClientId: link.id, delegationAttestationId: attestation.id, referenceNumber: dispute.referenceNumber }),
        ipAddress: null,
        userAgent: null,
      });
      return {
        id: dispute.id,
        referenceNumber: dispute.referenceNumber,
        submitterClientId: link.id,
        delegationAttestationId: attestation.id,
      };
    }),

  /** List disputes created under a submitter client link. */
  listClientDisputes: protectedProcedure
    .input(z.object({ submitterClientId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const link = await loadClientLink(db, input.submitterClientId);
      await assertOrgMember(db, ctx.user.id, link.submitterOrgId, ["owner", "staff", "viewer"]);
      return db.select().from(disputes).where(eq(disputes.submitterClientId, input.submitterClientId));
    }),

  /** Per-client rollup: counts, win rate, avg award, outstanding admin fees. */
  clientAnalytics: protectedProcedure
    .input(z.object({ submitterClientId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const link = await loadClientLink(db, input.submitterClientId);
      await assertOrgMember(db, ctx.user.id, link.submitterOrgId, ["owner", "staff", "viewer"]);
      const result = await db.execute(sql`
        SELECT COUNT(*)::int AS total,
               SUM(CASE WHEN "determinationWinner" IS NOT NULL THEN 1 ELSE 0 END)::int AS determined,
               SUM(CASE WHEN "determinationWinner" = 'initiating_party' THEN 1 ELSE 0 END)::int AS wins,
               AVG(CASE WHEN "determinationWinner" = 'initiating_party' THEN "determinationAmount" END) AS "avgAward",
               COALESCE(SUM(CASE WHEN "status" NOT IN ('closed','payment_complete') THEN COALESCE("adminFeeAmount", 0) ELSE 0 END), 0) AS "outstandingFees"
        FROM disputes
        WHERE "submitterClientId" = ${input.submitterClientId}
      `);
      const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as Array<Record<string, unknown>>;
      const r = rows[0] ?? { total: 0, determined: 0, wins: 0, avgAward: null, outstandingFees: 0 };
      const determined = Number(r.determined ?? 0);
      return {
        submitterClientId: input.submitterClientId,
        totalDisputes: Number(r.total ?? 0),
        determinedDisputes: determined,
        wins: Number(r.wins ?? 0),
        winRate: determined > 0 ? Math.round((Number(r.wins ?? 0) / determined) * 100) : null,
        avgAwardUsd: r.avgAward != null ? Math.round(Number(r.avgAward) * 100) / 100 : null,
        outstandingFeesUsd: Number(r.outstandingFees ?? 0),
      };
    }),

  // ── 835 remittance ingestion ───────────────────────────────────────────────
  /**
   * Ingest an X12 835 ERA scoped to an org (submitter or provider) the caller
   * belongs to. Content-hash dedupe per org; lines map to disputes whose
   * reference number or id matches the CLP01 claim id.
   */
  ingest835: protectedProcedure
    .input(z.object({
      orgId: z.string().min(1),
      fileName: z.string().min(1).max(255),
      content: z.string().min(1).max(5_000_000),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await assertOrgMember(db, ctx.user.id, input.orgId);
      const contentSha256 = hashRemittanceContent(input.content);
      const dup = await db.select().from(remittance835Files)
        .where(and(eq(remittance835Files.orgId, input.orgId), eq(remittance835Files.contentSha256, contentSha256)))
        .limit(1);
      if (dup.length) {
        return { fileId: dup[0].id, duplicate: true, lineCount: dup[0].lineCount, status: dup[0].status };
      }
      const fileId = crypto.randomUUID();
      let parsed;
      try {
        parsed = parse835(input.content);
      } catch (err) {
        if (err instanceof Remittance835ParseError) {
          await db.insert(remittance835Files).values({
            id: fileId, orgId: input.orgId, fileName: input.fileName, contentSha256,
            lineCount: 0, status: "failed", parseError: err.message,
          });
          throw new TRPCError({ code: "BAD_REQUEST", message: `835 parse failed: ${err.message}` });
        }
        throw err;
      }
      await db.insert(remittance835Files).values({
        id: fileId, orgId: input.orgId, fileName: input.fileName, contentSha256,
        lineCount: parsed.length, status: "parsed",
      });
      let mapped = 0;
      for (const line of parsed) {
        // Map to a dispute whose reference number or id equals the claim id.
        const match = await db.select({ id: disputes.id }).from(disputes)
          .where(sql`(${disputes.referenceNumber} = ${line.claimId} OR ${disputes.id} = ${line.claimId})`)
          .limit(1);
        const mappedDisputeId = match[0]?.id ?? null;
        if (mappedDisputeId) mapped++;
        await db.insert(remittanceLines).values({
          id: crypto.randomUUID(),
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
        });
      }
      await createAuditEntry({
        userId: ctx.user.id,
        action: "submitter.ingest835",
        entityType: "remittance_835_file",
        entityId: fileId,
        oldValue: null,
        newValue: JSON.stringify({ orgId: input.orgId, fileName: input.fileName, lineCount: parsed.length, mapped }),
        ipAddress: null,
        userAgent: null,
      });
      return { fileId, duplicate: false, lineCount: parsed.length, mapped, status: "parsed" as const };
    }),

  listRemittanceLines: protectedProcedure
    .input(z.object({ fileId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const file = (await db.select().from(remittance835Files).where(eq(remittance835Files.id, input.fileId)).limit(1))[0];
      if (!file) throw new TRPCError({ code: "NOT_FOUND", message: "Remittance file not found" });
      await assertOrgMember(db, ctx.user.id, file.orgId, ["owner", "staff", "viewer"]);
      return db.select().from(remittanceLines).where(eq(remittanceLines.fileId, input.fileId));
    }),

  // ── Breakeven analysis ─────────────────────────────────────────────────────
  /**
   * Expected-value / breakeven for a prospective dispute. Fee constants are
   * DB-first (fee_schedules, per server/fee-schedule.ts) with params-2026
   * fallback; IDRE fee ranges ($200–$840 single / $268–$1,173 batched,
   * unchanged by CMS-9897-F) are statutory constants; win rate comes from
   * platform determination data (honestly null when no data).
   */
  breakevenAnalysis: protectedProcedure
    .input(z.object({
      expectedAwardUsd: z.number().positive(),
      batched: z.boolean().default(false),
      lineItemCount: z.number().int().min(1).max(50).default(1),
      /** Override platform win rate (0..1) for sensitivity analysis. */
      winRateOverride: z.number().min(0).max(1).optional(),
      asOf: z.coerce.date().optional(),
    }))
    .query(async ({ input }) => {
      const asOf = input.asOf ?? new Date();
      const params = getEffectiveIDRParameters(asOf);
      const dbRow = await getAdminFeeFromDb(input.batched ? "batched" : "single", asOf);
      const adminFeeUsd = dbRow ? Number(dbRow.amountUsd) : params.adminFeeUsd;
      const feeSource = dbRow ? "fee_schedules(DB)" : "params-2026(fallback)";
      // Statutory certified-IDRE fee ranges (CMS Dec 2023 fee rule; unchanged
      // by CMS-9897-F). Loser pays; prevailing party refunded.
      const idreRange = input.batched ? { min: 268, max: 1173 } : { min: 200, max: 840 };
      // Platform win rate (initiating party = provider side) from real data.
      let winRate: number | null = null;
      let sampleSize = 0;
      try {
        const db = await requireDb();
        const res = await db.execute(sql`
          SELECT COUNT(*)::int AS total,
                 SUM(CASE WHEN "determinationWinner" = 'initiating_party' THEN 1 ELSE 0 END)::int AS wins
          FROM disputes WHERE "determinationWinner" IS NOT NULL
        `);
        const rows = (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? []) as Array<Record<string, unknown>>;
        const total = Number(rows[0]?.total ?? 0);
        sampleSize = total;
        if (total > 0) winRate = Number(rows[0]?.wins ?? 0) / total;
      } catch {
        winRate = null;
      }
      const pWin = input.winRateOverride ?? winRate;
      const expectedNet =
        pWin === null
          ? null
          : Math.round((pWin * input.expectedAwardUsd - adminFeeUsd - (1 - pWin) * idreRange.min) * 100) / 100;
      const breakevenAward =
        pWin === null || pWin <= 0
          ? null
          : Math.round(((adminFeeUsd + (1 - pWin) * idreRange.min) / pWin) * 100) / 100;
      return {
        asOf: asOf.toISOString().slice(0, 10),
        adminFeeUsd,
        adminFeeSource: feeSource,
        idreFeeRangeUsd: idreRange,
        batched: input.batched,
        lineItemCount: input.lineItemCount,
        platformWinRate: winRate === null ? null : Math.round(winRate * 1000) / 1000,
        platformSampleSize: sampleSize,
        winRateUsed: pWin,
        expectedNetUsd: expectedNet,
        breakevenAwardUsd: breakevenAward,
        notes: [
          "Administrative fee is per party per dispute and non-refundable after final IDRE selection (CMS-9897-F, disputes initiated on/after 2026-06-11).",
          "Certified IDRE fee is paid at offer submission and refunded to the prevailing party; expected value uses the range minimum as the at-risk amount when losing.",
          "Win rate is the platform-wide initiating-party determination rate; segment by service type/payer for sharper estimates.",
        ],
        citations: [...params.citations],
      };
    }),
});

export type SubmitterRouter = typeof submitterRouter;
