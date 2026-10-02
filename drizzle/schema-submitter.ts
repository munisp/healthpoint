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
  numeric,
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
    // ── Phase 18: per-client billing configuration (submitter invoicing) ──
    /** "flat" (per-determined-dispute flat fee) or "contingency" (pct of awards). */
    billingModel: varchar("billingModel", { length: 16 }).notNull().default("flat"),
    /** Contingency percentage of awards (0–100) when billingModel=contingency. */
    contingencyPct: numeric("contingencyPct", { precision: 5, scale: 2 }),
    /** Flat per-dispute fee in USD when billingModel=flat. */
    flatFeeUsd: numeric("flatFeeUsd", { precision: 12, scale: 2 }),
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
    // ── Phase 20: BPR/TRN payment-instrument header capture ──
    /** BPR04 raw payment method code (CHK/ACH/NON/...). */
    paymentMethodCode: varchar("paymentMethodCode", { length: 8 }),
    /** Normalized bucket: check | ach | other | nonpayment. */
    paymentMethod: varchar("paymentMethod", { length: 16 }),
    /** BPR02 total actual provider payment, integer cents. */
    totalPaymentCents: integer("totalPaymentCents"),
    /** TRN02 check/EFT trace number (payer's payment reference). */
    paymentTraceNumber: varchar("paymentTraceNumber", { length: 64 }),
    /** BPR16 payment effective date (YYYY-MM-DD). */
    paymentEffectiveDate: varchar("paymentEffectiveDate", { length: 10 }),
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
    // ── Phase 20: propagated header payment context ──
    paymentMethodCode: varchar("paymentMethodCode", { length: 8 }),
    paymentTraceNumber: varchar("paymentTraceNumber", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    index("remittance_lines_file_idx").on(t.fileId),
    index("remittance_lines_claim_idx").on(t.claimId),
    index("remittance_lines_mapped_idx").on(t.mappedDisputeId),
    index("remittance_lines_trace_idx").on(t.paymentTraceNumber),
  ]
);
export type RemittanceLine = typeof remittanceLines.$inferSelect;

// ─── Phase 18: submitter invoicing ───────────────────────────────────────────
export const SUBMITTER_BILLING_MODEL = ["flat", "contingency"] as const;
export type SubmitterBillingModel = (typeof SUBMITTER_BILLING_MODEL)[number];
export const SUBMITTER_INVOICE_STATUS = ["draft", "sent", "paid", "void"] as const;
export type SubmitterInvoiceStatus = (typeof SUBMITTER_INVOICE_STATUS)[number];

/**
 * Per-client invoices generated FROM platform determination data
 * (disputes.determinationWinner/determinationAmount). No payment processing:
 * the lifecycle is draft -> sent -> paid (or void) and nothing here moves
 * money — paid status is recorded manually by the submitter.
 */
export const submitterInvoices = pgTable(
  "submitter_invoices",
  {
    id: varchar("id", { length: 64 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    submitterClientId: varchar("submitterClientId", { length: 64 }).notNull(),
    invoiceNumber: varchar("invoiceNumber", { length: 48 }).notNull(),
    billingModel: varchar("billingModel", { length: 16 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("draft"),
    periodStart: timestamp("periodStart").notNull(),
    periodEnd: timestamp("periodEnd").notNull(),
    totalUsd: numeric("totalUsd", { precision: 12, scale: 2 }).notNull().default("0"),
    lineCount: integer("lineCount").notNull().default(0),
    /** Snapshot of computation inputs/notes (honesty + audit trail). */
    computationNotes: jsonb("computationNotes").$type<string[]>().notNull().default([]),
    issuedAt: timestamp("issuedAt"),
    paidAt: timestamp("paidAt"),
    voidedAt: timestamp("voidedAt"),
    // ── Phase 20-C: Stripe Checkout collection (additive) ──
    // paidAt above already exists (Phase 18-BE); the verified Stripe webhook
    // WRITES to it — this phase does not re-add it.
    /** Stripe Checkout Session id (cs_…) when Stripe collection was used. */
    stripeSessionId: varchar("stripeSessionId", { length: 128 }),
    /** Reserved/null under the Checkout design (stripeInvoiceId, in_…) — kept
     *  so a future Stripe-Invoicing transport needs no schema change. */
    stripeInvoiceId: varchar("stripeInvoiceId", { length: 128 }),
    /** Last VERIFIED Stripe payment state: unpaid | paid | expired | canceled.
     *  Set ONLY from signature-verified webhooks or a live session retrieve —
     *  never inferred locally. Null when Stripe collection was never used. */
    stripeStatus: varchar("stripeStatus", { length: 24 }),
    createdByUserId: varchar("createdByUserId", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("submitter_invoices_number_idx").on(t.submitterClientId, t.invoiceNumber),
    index("submitter_invoices_client_idx").on(t.submitterClientId),
    index("submitter_invoices_status_idx").on(t.status),
    index("submitter_invoices_stripe_session_idx").on(t.stripeSessionId),
  ]
);
export type SubmitterInvoice = typeof submitterInvoices.$inferSelect;

export const submitterInvoiceLines = pgTable(
  "submitter_invoice_lines",
  {
    id: varchar("id", { length: 64 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    invoiceId: varchar("invoiceId", { length: 64 }).notNull(),
    disputeId: varchar("disputeId", { length: 64 }).notNull(),
    referenceNumber: varchar("referenceNumber", { length: 32 }),
    /** Award (determinationAmount) the charge was computed from, when known. */
    awardUsd: numeric("awardUsd", { precision: 12, scale: 2 }),
    chargeUsd: numeric("chargeUsd", { precision: 12, scale: 2 }).notNull(),
    description: text("description").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    index("submitter_invoice_lines_invoice_idx").on(t.invoiceId),
    uniqueIndex("submitter_invoice_lines_dispute_idx").on(t.invoiceId, t.disputeId),
  ]
);
export type SubmitterInvoiceLine = typeof submitterInvoiceLines.$inferSelect;

// ─── Phase 20-A: manual check postings (paper check bookkeeping) ─────────────
/**
 * Manual check postings are BOOKKEEPING RECORDS ONLY (honesty label 5.3.4):
 * PAYMENT_EXECUTION_MODE remains disabled/sandbox — no payment is initiated
 * and no TigerBeetle ledger entry is written. Lifecycle:
 * posted → matched → deposited → reconciled. The "reconciled" state is
 * reserved for a later back-office close-out (bank statement confirmation);
 * Phase 20 exposes it in the enum but NO public procedure transitions to it.
 */
export const CHECK_POSTING_STATUS = ["posted", "matched", "deposited", "reconciled"] as const;
export type CheckPostingStatus = (typeof CHECK_POSTING_STATUS)[number];

export const manualCheckPostings = pgTable(
  "manual_check_postings",
  {
    id: varchar("id", { length: 64 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: varchar("orgId", { length: 64 }).notNull(),
    checkNumber: varchar("checkNumber", { length: 64 }).notNull(),
    amountCents: integer("amountCents").notNull(),
    payerName: varchar("payerName", { length: 255 }).notNull(),
    /** YYYY-MM-DD — paper artifact date. */
    receivedDate: varchar("receivedDate", { length: 10 }).notNull(),
    /** Set by markCheckDeposited. */
    depositDate: varchar("depositDate", { length: 10 }),
    matchedRemittanceLineIds: jsonb("matchedRemittanceLineIds").$type<string[]>().notNull().default([]),
    /** Set when matched against an 835 carrying TRN02 — links paper to ERA. */
    matchedPaymentTraceNumber: varchar("matchedPaymentTraceNumber", { length: 64 }),
    status: varchar("status", { length: 16 }).notNull().default("posted"),
    createdBy: varchar("createdBy", { length: 64 }).notNull(),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => [
    index("manual_check_postings_org_idx").on(t.orgId),
    uniqueIndex("manual_check_postings_org_check_idx").on(t.orgId, t.checkNumber, t.payerName),
  ]
);
export type ManualCheckPosting = typeof manualCheckPostings.$inferSelect;

// ─── Phase 20-C: Stripe Checkout collection for platform invoices ────────────
/**
 * Fee policy (user-locked): the platform ABSORBS Stripe processing fees;
 * ACH (us_bank_account) is the preferred rail; there is deliberately NO
 * surcharge/pass-through flag anywhere in this schema or API.
 */

export const stripeWebhookEvents = pgTable(
  "stripe_webhook_events",
  {
    /** Stripe event id (evt_…) — primary key, the idempotency key. */
    id: varchar("id", { length: 128 }).primaryKey(),
    type: varchar("type", { length: 64 }).notNull(),
    /** Full verified event payload for audit/replay forensics. */
    payload: jsonb("payload").notNull(),
    /** Null until the handler committed; duplicate deliveries no-op. */
    processedAt: timestamp("processedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("stripe_webhook_events_type_idx").on(t.type)]
);
export type StripeWebhookEvent = typeof stripeWebhookEvents.$inferSelect;
