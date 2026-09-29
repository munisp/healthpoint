/**
 * drizzle/schema-submitter.ts
 *
 * Phase 16: third-party-submitter (delegated representative) tables.
 *
 * Statutory basis (CMS-9897-F, Federal Independent Dispute Resolution
 * Operations Final Rule, 91 FR 33900; 45 CFR 149.510(b)(2)(ii)(A)(3) as
 * amended): a notice of IDR initiation submitted by a third-party
 * representative must identify the representative and include an attestation
 * that the representative has authority to act on behalf of the party it
 * represents; the attestation may allocate administrative-fee debt.
 *
 * Tables:
 *  - submitter_clients:        submitter org ↔ provider client org link
 *                              (NPI/TIN rosters, lifecycle status).
 *  - delegation_attestations:  hash-chained authority attestations
 *                              (artifact sha256 + prevHash, tamper-evident
 *                              like consent signatures).
 *  - remittance_835_files / remittance_lines: X12 835 ERA ingestion with
 *                              CARC/RARC extraction; RARC N830 (or eligible
 *                              CARC) flags NSA/IDR-eligible underpayments.
 *
 * Separate module (not appended to drizzle/schema.ts) to avoid
 * concurrent-edit conflicts on the shared schema file, matching the
 * schema-personas.ts / schema-idr-compliance.ts precedent. Applied by the
 * hand-written migration drizzle/migrations/0049_wave_p16.sql.
 */

import crypto from "node:crypto";
import {
  pgTable,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─── Submitter ↔ client links ────────────────────────────────────────────────
export const SUBMITTER_CLIENT_STATUS = ["pending", "active", "suspended", "terminated"] as const;
export type SubmitterClientStatus = (typeof SUBMITTER_CLIENT_STATUS)[number];

export const submitterClients = pgTable(
  "submitter_clients",
  {
    id: varchar("id", { length: 64 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    /** The third-party submitter (biller/RCM/clearinghouse) organization. */
    submitterOrgId: varchar("submitterOrgId", { length: 64 }).notNull(),
    /** The provider client organization. Null until the invite is accepted. */
    clientOrgId: varchar("clientOrgId", { length: 64 }),
    label: varchar("label", { length: 255 }).notNull(),
    /** Provider NPIs covered by the engagement (JSON array of strings). */
    npis: jsonb("npis").$type<string[]>().notNull().default([]),
    /** Billing TINs covered by the engagement (JSON array of strings). */
    tins: jsonb("tins").$type<string[]>().notNull().default([]),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    /** sha256 of the invite token that created this link (accept audit). */
    inviteTokenHash: varchar("inviteTokenHash", { length: 128 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("submitter_clients_org_pair_idx").on(t.submitterOrgId, t.clientOrgId),
    index("submitter_clients_submitter_idx").on(t.submitterOrgId),
    index("submitter_clients_client_idx").on(t.clientOrgId),
  ]
);
export type SubmitterClient = typeof submitterClients.$inferSelect;

// ─── Delegation attestations ─────────────────────────────────────────────────
export const DELEGATION_SCOPE = ["claims", "idr", "both"] as const;
export type DelegationScope = (typeof DELEGATION_SCOPE)[number];
export const DELEGATION_ATTESTATION_STATUS = ["active", "expired", "revoked"] as const;
export type DelegationAttestationStatus = (typeof DELEGATION_ATTESTATION_STATUS)[number];

export const delegationAttestations = pgTable(
  "delegation_attestations",
  {
    id: varchar("id", { length: 64 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    submitterClientId: varchar("submitterClientId", { length: 64 }).notNull(),
    scope: varchar("scope", { length: 16 }).notNull(),
    /** Free-text statement of delegated authority (the attestation text). */
    authorityText: text("authorityText").notNull(),
    attestedByUserId: varchar("attestedByUserId", { length: 64 }).notNull(),
    attestedAt: timestamp("attestedAt").notNull(),
    effectiveFrom: timestamp("effectiveFrom").notNull(),
    expiresAt: timestamp("expiresAt"),
    /**
     * 45 CFR 149.510(b)(2)(ii)(A)(3): the attestation may indicate that the
     * representative entity is obligated to pay the administrative fee and
     * incurs the debt for nonpayment.
     */
    adminFeeDebtAccepted: boolean("adminFeeDebtAccepted").notNull().default(false),
    /** sha256 hex of the canonical attestation artifact (tamper-evident). */
    artifactSha256: varchar("artifactSha256", { length: 64 }).notNull(),
    /** sha256 hex of the previous attestation artifact in the chain
     *  ("0".repeat(64) for the first), like consent signature artifacts. */
    prevHash: varchar("prevHash", { length: 64 }).notNull(),
    revokedAt: timestamp("revokedAt"),
    revokedByUserId: varchar("revokedByUserId", { length: 64 }),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    index("delegation_attestations_client_idx").on(t.submitterClientId),
    index("delegation_attestations_status_idx").on(t.status),
  ]
);
export type DelegationAttestation = typeof delegationAttestations.$inferSelect;

// ─── 835 remittance ingestion ────────────────────────────────────────────────
export const REMITTANCE_FILE_STATUS = ["received", "parsed", "failed", "duplicate"] as const;
export type RemittanceFileStatus = (typeof REMITTANCE_FILE_STATUS)[number];

export const remittance835Files = pgTable(
  "remittance_835_files",
  {
    id: varchar("id", { length: 64 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    /** Owning org (submitter org or provider org) that ingested the file. */
    orgId: varchar("orgId", { length: 64 }).notNull(),
    fileName: varchar("fileName", { length: 255 }).notNull(),
    /** sha256 hex of the raw file content — dedupe key. */
    contentSha256: varchar("contentSha256", { length: 64 }).notNull(),
    receivedAt: timestamp("receivedAt").defaultNow().notNull(),
    lineCount: integer("lineCount").notNull().default(0),
    status: varchar("status", { length: 16 }).notNull().default("received"),
    parseError: text("parseError"),
  },
  (t) => [
    uniqueIndex("remittance_835_files_org_hash_idx").on(t.orgId, t.contentSha256),
    index("remittance_835_files_org_idx").on(t.orgId),
  ]
);
export type Remittance835File = typeof remittance835Files.$inferSelect;

export const remittanceLines = pgTable(
  "remittance_lines",
  {
    id: varchar("id", { length: 64 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    fileId: varchar("fileId", { length: 64 }).notNull(),
    /** Patient Control Number / claim id (CLP01). */
    claimId: text("claimId").notNull(),
    payerId: varchar("payerId", { length: 64 }),
    /** Rendering/billing NPI when present on the claim (NM1*82/CLP-level REF). */
    npi: varchar("npi", { length: 20 }),
    cptCode: varchar("cptCode", { length: 16 }),
    billedCents: integer("billedCents"),
    allowedCents: integer("allowedCents"),
    carcCodes: text("carcCodes").array(),
    rarcCodes: text("rarcCodes").array(),
    /**
     * NSA/IDR eligibility signal: true when the remittance carries RARC N830
     * ("Alert: The claim was processed as out-of-network ... No Surprises
     * Act") or an eligible CARC adjustment (e.g. CARC 45/PR-1/PR-2 variants
     * marking an OON underpayment subject to federal IDR).
     */
    idrEligibleFlag: boolean("idrEligibleFlag").notNull().default(false),
    /** Dispute this line was mapped to (claimId match), when applicable. */
    mappedDisputeId: varchar("mappedDisputeId", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    index("remittance_lines_file_idx").on(t.fileId),
    index("remittance_lines_claim_idx").on(t.claimId),
    index("remittance_lines_mapped_idx").on(t.mappedDisputeId),
  ]
);
export type RemittanceLine = typeof remittanceLines.$inferSelect;
