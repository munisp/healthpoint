/**
 * drizzle/schema-idr-compliance.ts
 *
 * NSA / Federal IDR compliance tables (deadline ledger, fee schedules,
 * fee assessments, attestations).
 *
 * These tables are defined in a separate module (not appended to
 * drizzle/schema.ts) to avoid concurrent-edit conflicts on the shared schema
 * file. They are applied by the hand-written migration
 * drizzle/migrations/0028_idr_compliance_tables.sql.
 *
 * NOTE for drizzle-kit users: drizzle.config.ts points at ./drizzle/schema.ts
 * only. To include these tables in future `drizzle-kit generate` output, add
 * `export * from "./schema-idr-compliance";` to drizzle/schema.ts (see
 * server/routers/REGISTER-idr-compliance.md).
 *
 * Money convention: ALL amounts are INTEGER cents (matching the ledger tables'
 * balanceCents/amountCents convention). Fee dollar amounts are NEVER
 * hardcoded as statutory constants — 45 CFR fee schedules change via
 * rulemaking and litigation (TMA v. HHS); they live in idr_fee_schedules
 * (effective-dated) and are seeded from environment variables.
 */

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

// ─── IDR Deadline Events (statutory deadline ledger) ─────────────────────────
// One row per (dispute, deadlineType): the computed statutory deadline, its
// CFR basis, its status, and which escalation alerts (T-5 BD / T-1 BD /
// overdue) have been emitted. Written/updated by the deadline scheduler
// (server/scheduled/idrDeadlineCheck.ts) and the idr-compliance router.

export const IDR_DEADLINE_TYPE = [
  "open_negotiation_end", // 45 CFR § 149.510(b)(1) — 30 BD from ON notice
  "idr_initiation_window_end", // § 149.510(b)(2)(i) — 4 BD after ON ends
  "idre_selection", // § 149.510(c)(1) — 3 BD after IDR initiation
  "offer_submission", // § 149.510(c)(3)(i) — 10 BD after IDRE selection
  "determination_due", // § 149.510(c)(4)(ii) — 30 BD after IDRE selection
  "payment_due", // PHSA § 2799A-1(c)(6) — 30 calendar days after determination
] as const;
export type IDRDeadlineType = (typeof IDR_DEADLINE_TYPE)[number];

export const idrDeadlineEvents = pgTable(
  "idr_deadline_events",
  {
    id: varchar("id", { length: 64 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    disputeId: varchar("disputeId", { length: 64 }).notNull(),
    deadlineType: varchar("deadlineType", { length: 48 }).notNull(),
    // Anchor date the deadline was computed from (e.g. ON notice date).
    basisDate: timestamp("basisDate"),
    computedDeadline: timestamp("computedDeadline").notNull(),
    // Day count applied: business days for BD deadlines, calendar days for payment_due.
    dayCount: integer("dayCount").notNull(),
    dayKind: varchar("dayKind", { length: 16 }).notNull().default("business"), // business | calendar
    cfrReference: varchar("cfrReference", { length: 96 }).notNull(),
    // open = clock running; met = obligation satisfied in time; overdue = past
    // deadline without satisfaction; waived = administratively excused (audited).
    status: varchar("status", { length: 24 }).notNull().default("open"),
    metAt: timestamp("metAt"),
    // Escalation alert timestamps — null means not yet emitted (dedupe keys).
    tMinus5SentAt: timestamp("tMinus5SentAt"),
    tMinus1SentAt: timestamp("tMinus1SentAt"),
    overdueSentAt: timestamp("overdueSentAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("idr_deadline_events_dispute_type_idx").on(t.disputeId, t.deadlineType),
    index("idr_deadline_events_deadline_idx").on(t.computedDeadline),
    index("idr_deadline_events_status_idx").on(t.status),
  ]
);
export type IDRDeadlineEvent = typeof idrDeadlineEvents.$inferSelect;
export type InsertIDRDeadlineEvent = typeof idrDeadlineEvents.$inferInsert;

// ─── IDR Fee Schedules (effective-dated) ─────────────────────────────────────
// The federal IDR administrative fee (per party, per determination,
// non-refundable) and certified IDR entity fee ranges are set by annual
// Departments of HHS/Labor/Treasury guidance under 45 CFR § 149.510(d) and
// change over time (e.g. after TMA litigation). Amounts therefore live in
// this effective-dated table, NEVER in code. Seed via environment variables
// (server/idr/fees.ts) or the idr-compliance router's admin procedures.

export const idrFeeSchedules = pgTable(
  "idr_fee_schedules",
  {
    id: varchar("id", { length: 64 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    effectiveFrom: timestamp("effectiveFrom").notNull(),
    effectiveTo: timestamp("effectiveTo"), // null = currently in effect
    // Administrative fee — per party, per determination, non-refundable
    // (45 CFR § 149.510(d)(1)). Integer cents.
    adminFeeCents: integer("adminFeeCents").notNull(),
    // Certified IDR entity fee — allowable ranges set by the Departments
    // (45 CFR § 149.510(d)(2)). Single dispute and batched dispute ranges.
    idreFeeSingleMinCents: integer("idreFeeSingleMinCents"),
    idreFeeSingleMaxCents: integer("idreFeeSingleMaxCents"),
    idreFeeBatchedMinCents: integer("idreFeeBatchedMinCents"),
    idreFeeBatchedMaxCents: integer("idreFeeBatchedMaxCents"),
    // Batching policy values (§ 149.510(c)(3)) — configurable caps, not law-in-code.
    batchingMaxLineItems: integer("batchingMaxLineItems"),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    // Where the schedule came from, e.g. "CMS calendar-year guidance" + URL,
    // or "env:IDR_ADMIN_FEE_CENTS" for environment-seeded rows.
    source: varchar("source", { length: 255 }),
    notes: text("notes"),
    createdBy: varchar("createdBy", { length: 64 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    index("idr_fee_schedules_effective_idx").on(t.effectiveFrom),
  ]
);
export type IDRFeeSchedule = typeof idrFeeSchedules.$inferSelect;
export type InsertIDRFeeSchedule = typeof idrFeeSchedules.$inferInsert;

// ─── IDR Fee Assessments ─────────────────────────────────────────────────────
// One assessed fee per (dispute, feeType, partyRole). The unique index makes
// assessment idempotent; payment-status columns track collection state.

export const IDR_FEE_TYPE = ["administrative", "idre_single", "idre_batched"] as const;
export type IDRFeeType = (typeof IDR_FEE_TYPE)[number];

export const IDR_FEE_STATUS = [
  "assessed", // fee computed and recorded; not yet invoiced
  "invoiced",
  "paid",
  "waived", // e.g. administrative-fee waiver; requires notes + actor
  "refunded", // IDRE fee must be refunded if dispute found ineligible (§ 149.510(d)(2)(iv))
  "void",
] as const;
export type IDRFeeStatus = (typeof IDR_FEE_STATUS)[number];

export const idrFeeAssessments = pgTable(
  "idr_fee_assessments",
  {
    id: varchar("id", { length: 64 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    disputeId: varchar("disputeId", { length: 64 }).notNull(),
    feeScheduleId: varchar("feeScheduleId", { length: 64 }).notNull(),
    feeType: varchar("feeType", { length: 24 }).notNull(),
    partyRole: varchar("partyRole", { length: 24 }).notNull(), // initiating_party | responding_party
    partyId: varchar("partyId", { length: 64 }),
    amountCents: integer("amountCents").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    status: varchar("status", { length: 16 }).notNull().default("assessed"),
    assessedAt: timestamp("assessedAt").defaultNow().notNull(),
    assessedBy: varchar("assessedBy", { length: 64 }).notNull(), // user id or "system"
    invoicedAt: timestamp("invoicedAt"),
    paidAt: timestamp("paidAt"),
    paymentReference: varchar("paymentReference", { length: 128 }), // external receipt/portal ref
    statusReason: text("statusReason"),
    idempotencyKey: varchar("idempotencyKey", { length: 191 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("idr_fee_assessments_idem_idx").on(t.idempotencyKey),
    uniqueIndex("idr_fee_assessments_dispute_type_party_idx").on(t.disputeId, t.feeType, t.partyRole),
    index("idr_fee_assessments_dispute_idx").on(t.disputeId),
    index("idr_fee_assessments_status_idx").on(t.status),
  ]
);
export type IDRFeeAssessment = typeof idrFeeAssessments.$inferSelect;
export type InsertIDRFeeAssessment = typeof idrFeeAssessments.$inferInsert;

// ─── IDR Attestations ────────────────────────────────────────────────────────
// Parties attest to the completeness and accuracy of submitted information
// at IDR initiation and at offer submission (45 CFR § 149.510(b)(2)(ii) and
// (c)(3)(i)(C) require submission of accurate information; the attestation is
// the platform's evidentiary record of that affirmation). Immutable rows;
// corrections are recorded as a new attestation that supersedes the old one.

export const IDR_ATTESTATION_TYPE = ["idr_initiation", "offer_submission"] as const;
export type IDRAttestationType = (typeof IDR_ATTESTATION_TYPE)[number];

export const idrAttestations = pgTable(
  "idr_attestations",
  {
    id: varchar("id", { length: 64 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    disputeId: varchar("disputeId", { length: 64 }).notNull(),
    attestationType: varchar("attestationType", { length: 32 }).notNull(),
    partyRole: varchar("partyRole", { length: 24 }).notNull(), // initiating_party | responding_party
    attestedBy: varchar("attestedBy", { length: 64 }).notNull(), // user id
    attestedByName: varchar("attestedByName", { length: 255 }).notNull(),
    attestationText: text("attestationText").notNull(),
    informationComplete: boolean("informationComplete").notNull(),
    informationAccurate: boolean("informationAccurate").notNull(),
    // active | superseded | withdrawn — supersededBy points at the replacement row.
    status: varchar("status", { length: 16 }).notNull().default("active"),
    supersededBy: varchar("supersededBy", { length: 64 }),
    ipAddress: varchar("ipAddress", { length: 64 }),
    userAgent: text("userAgent"),
    attestedAt: timestamp("attestedAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    index("idr_attestations_dispute_idx").on(t.disputeId),
    index("idr_attestations_type_idx").on(t.disputeId, t.attestationType),
    index("idr_attestations_status_idx").on(t.status),
  ]
);
export type IDRAttestation = typeof idrAttestations.$inferSelect;
export type InsertIDRAttestation = typeof idrAttestations.$inferInsert;
