/**
 * drizzle/schema-practice-claims.ts
 *
 * Phase 17: practice claims staging + eligibility score persistence.
 *
 * Purpose: normalized claim staging ("practice_claims") fed by every claim
 * ingestion path — FHIR R4 bulk $export ndjson (server/emr/bulk-import.ts),
 * X12 837P (server/edi/claim837.ts), FHIR single-patient pull — so the NSA
 * eligibility engine (server/eligibility/engine.ts) has the eligibility-
 * critical fields the audit identified as non-ingestible (E6): plan type,
 * network/participation status, place of service, notice/consent status,
 * initial payment/denial date, service dates, service codes, payer/plan
 * identifiers, NPIs/TIN, and state codes.
 *
 * Field-level provenance (sourceProvenance) reuses the W6 convention
 * (server/emr/provenance.ts): per-field { source: "emr" | "manual", ... } —
 * manual edits are never overwritten by re-ingestion at the dispute level;
 * staging rows are idempotent by content hash (orgId + contentSha256 unique)
 * so replays of the same 837 file or bulk export are no-ops.
 *
 * Verdict semantics (CRITICAL HONESTY CONSTRAINT): scores are deterministic
 * RULE VERDICTS (QUALIFIES / BLOCKED / NEEDS_REVIEW) with CFR citations —
 * never a guarantee of IDR outcome. Any outcome probability is a statistical
 * estimate and is labeled as such at the API layer.
 *
 * Separate module (not appended to drizzle/schema.ts) to avoid
 * concurrent-edit conflicts, matching the schema-submitter.ts precedent.
 * Applied by the hand-written migration drizzle/migrations/0050_wave_p17.sql.
 */

import {
  pgTable,
  varchar,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Ingestion path that produced the staging row. */
export type PracticeClaimSource = "fhir_bulk" | "fhir_pull" | "x12_837" | "csv";

export interface FieldProvenanceEntry {
  source: "emr" | "edi" | "manual" | "derived";
  detail?: string;
}

export const practiceClaims = pgTable(
  "practice_claims",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    orgId: varchar("orgId", { length: 64 }).notNull(),
    emrConnectionId: varchar("emrConnectionId", { length: 64 }),
    source: varchar("source", { length: 16 }).notNull(), // fhir_bulk | fhir_pull | x12_837 | csv
    /** Bulk export job id, remittance/claim file id, or upload reference. */
    sourceRef: varchar("sourceRef", { length: 128 }),
    /** Idempotency: sha256 of canonical source content (per org). */
    contentSha256: varchar("contentSha256", { length: 64 }).notNull(),

    // Claim identity
    claimId: varchar("claimId", { length: 128 }), // payer claim id / patient control number
    patientRef: varchar("patientRef", { length: 128 }), // FHIR Patient id or 837 subscriber/patient ref

    // Eligibility-critical fields (E6)
    planType: varchar("planType", { length: 32 }), // FULLY_INSURED | SELF_FUNDED | FEHB (null = unknown; never defaulted)
    serviceCategory: varchar("serviceCategory", { length: 32 }), // EMERGENCY | NON_EMERGENCY | POST_STABILIZATION | AIR_AMBULANCE
    patientState: varchar("patientState", { length: 2 }),
    facilityState: varchar("facilityState", { length: 2 }),
    serviceDate: varchar("serviceDate", { length: 10 }), // ISO YYYY-MM-DD
    serviceEndDate: varchar("serviceEndDate", { length: 10 }),
    placeOfService: varchar("placeOfService", { length: 8 }), // CMS POS code
    networkStatus: varchar("networkStatus", { length: 16 }), // out_of_network | in_network (null = unknown)
    noticeConsentStatus: varchar("noticeConsentStatus", { length: 24 }), // none | signed | waived_exception (null = unknown)
    initialPaymentDate: varchar("initialPaymentDate", { length: 10 }), // anchors §149.510 clocks
    denialDate: varchar("denialDate", { length: 10 }),
    priorPaymentDeterminationDate: varchar("priorPaymentDeterminationDate", { length: 10 }), // cooling-off anchor

    // Codes & parties
    cptCodes: jsonb("cptCodes").$type<string[]>().notNull().default([]),
    modifiers: jsonb("modifiers").$type<string[]>().notNull().default([]),
    diagnoses: jsonb("diagnoses").$type<string[]>().notNull().default([]), // ICD-10-CM
    payerId: varchar("payerId", { length: 64 }),
    payerName: varchar("payerName", { length: 255 }),
    planIdentifier: varchar("planIdentifier", { length: 128 }), // group/plan number
    renderingNpi: varchar("renderingNpi", { length: 10 }),
    billingNpi: varchar("billingNpi", { length: 10 }),
    tin: varchar("tin", { length: 16 }),

    // Amounts (integer cents)
    billedCents: bigint("billedCents", { mode: "number" }),
    allowedCents: bigint("allowedCents", { mode: "number" }),
    paidCents: bigint("paidCents", { mode: "number" }),

    /** Per-field provenance, W6 convention ({ field: { source, detail? } }). */
    sourceProvenance: jsonb("sourceProvenance").$type<Record<string, FieldProvenanceEntry>>().notNull().default({}),
    /** Raw source resource/segment ids used to build this row (auditing). */
    sourceResourceRefs: jsonb("sourceResourceRefs").$type<string[]>().notNull().default([]),

    createdAt: timestamp("createdAt").defaultNow(),
    updatedAt: timestamp("updatedAt").defaultNow(),
  },
  (t) => [
    uniqueIndex("practice_claims_org_hash_idx").on(t.orgId, t.contentSha256),
    index("practice_claims_org_idx").on(t.orgId),
    index("practice_claims_connection_idx").on(t.emrConnectionId),
    index("practice_claims_claimid_idx").on(t.claimId),
    index("practice_claims_service_date_idx").on(t.serviceDate),
  ]
);
export type PracticeClaim = typeof practiceClaims.$inferSelect;
export type InsertPracticeClaim = typeof practiceClaims.$inferInsert;

/** Deterministic eligibility verdict (rule-based; NOT an outcome guarantee). */
export type PracticeClaimVerdict = "QUALIFIES" | "BLOCKED" | "NEEDS_REVIEW";

export interface RuleFired {
  rule: string;
  citation: string;
  detail: string;
  effect: "block" | "review" | "info" | "pass";
}

export interface EvidenceChecklistItem {
  key: string;
  label: string;
  present: boolean;
  citation: string;
}

export const practiceClaimScores = pgTable(
  "practice_claim_scores",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    claimId: varchar("claimId", { length: 64 })
      .notNull()
      .references(() => practiceClaims.id, { onDelete: "cascade" }),
    /** Deterministic rule verdict — eligibility only, never a win assurance. */
    verdict: varchar("verdict", { length: 16 }).notNull(),
    rulesFired: jsonb("rulesFired").$type<RuleFired[]>().notNull().default([]),
    missingFields: jsonb("missingFields").$type<string[]>().notNull().default([]),
    evidenceChecklist: jsonb("evidenceChecklist").$type<EvidenceChecklistItem[]>().notNull().default([]),
    completenessPct: integer("completenessPct").notNull().default(0),
    /** 'FEDERAL' | 'STATE' | 'BIFURCATED_SPLIT' | null when not resolvable. */
    jurisdiction: varchar("jurisdiction", { length: 24 }),
    /**
     * OutcomeNet P(provider-favorable determination) for this claim when
     * computed — STATISTICAL ESTIMATE ONLY (model trained on synthetic data;
     * see ml/data/synthetic_platform_data.py). Never a guarantee of outcome.
     * Null when the model was not consulted.
     */
    winProbabilityStatisticalEstimate: varchar("winProbabilityStatisticalEstimate", { length: 16 }),
    scoredAt: timestamp("scoredAt").defaultNow(),
  },
  (t) => [
    uniqueIndex("practice_claim_scores_claim_idx").on(t.claimId),
    index("practice_claim_scores_verdict_idx").on(t.verdict),
  ]
);
export type PracticeClaimScore = typeof practiceClaimScores.$inferSelect;
