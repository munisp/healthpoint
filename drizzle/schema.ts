import {
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  int,
  decimal,
  boolean,
  json,
  index,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── NSA IDR 19-Step Workflow ────────────────────────────────────────────────

/**
 * NSA IDR Dispute workflow steps per 45 CFR Part 149 / No Surprises Act.
 * Steps 1-19 map directly to the federal IDR process timeline.
 */
export const IDR_STEP = [
  "STEP_01_OPEN_NEGOTIATION_INITIATED",       // Party sends open negotiation notice
  "STEP_02_OPEN_NEGOTIATION_PERIOD",          // 30-business-day open negotiation window
  "STEP_03_OPEN_NEGOTIATION_FAILED",          // Parties failed to agree
  "STEP_04_IDR_INITIATED",                    // Either party initiates federal IDR
  "STEP_05_IDR_NOTICE_SENT",                  // CMS notified, IDR entity selection begins
  "STEP_06_IDR_ENTITY_SELECTION",             // Parties select certified IDR entity (4 business days)
  "STEP_07_IDR_ENTITY_SELECTED",              // IDR entity confirmed
  "STEP_08_ELIGIBILITY_REVIEW",               // IDR entity reviews eligibility (3 business days)
  "STEP_09_OFFER_SUBMISSION",                 // Parties submit offers (10 business days)
  "STEP_10_QPA_DISCLOSURE",                   // QPA disclosed to IDR entity
  "STEP_11_ADDITIONAL_INFORMATION",           // Additional information submission period (5 business days)
  "STEP_12_ARBITRATION_REVIEW",               // IDR entity reviews offers and information
  "STEP_13_DETERMINATION_ISSUED",             // IDR entity issues payment determination
  "STEP_14_PAYMENT_DETERMINATION",            // Losing party notified; payment due within 30 days
  "STEP_15_PAYMENT_MADE",                     // Payment transmitted
  "STEP_16_ADMINISTRATIVE_FEE_PAID",          // Administrative fee paid by losing party
  "STEP_17_DISPUTE_CLOSED",                   // Dispute formally closed
  "STEP_18_APPEAL_FILED",                     // Optional: appeal filed in federal court
  "STEP_19_APPEAL_RESOLVED",                  // Optional: appeal resolved
] as const;

export type IDRStep = (typeof IDR_STEP)[number];

export const DISPUTE_STATUS = [
  "open_negotiation",
  "idr_initiated",
  "idr_entity_selection",
  "eligibility_review",
  "offer_submission",
  "under_arbitration",
  "determination_issued",
  "payment_pending",
  "closed",
  "appealed",
  "ineligible",
] as const;

export type DisputeStatus = (typeof DISPUTE_STATUS)[number];

export const PARTY_TYPE = ["provider", "facility", "payer", "aggregator"] as const;
export const SERVICE_TYPE = [
  "emergency_medicine",
  "anesthesiology",
  "pathology",
  "radiology",
  "neonatology",
  "surgery",
  "hospitalist",
  "air_ambulance",
  "ground_ambulance",
  "other",
] as const;

/**
 * Core IDR disputes table.
 */
export const disputes = mysqlTable(
  "disputes",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    referenceNumber: varchar("referenceNumber", { length: 32 }).unique().notNull(),

    // Parties
    initiatingPartyId: varchar("initiatingPartyId", { length: 64 }).notNull(),
    initiatingPartyType: mysqlEnum("initiatingPartyType", PARTY_TYPE).notNull(),
    initiatingPartyName: varchar("initiatingPartyName", { length: 255 }).notNull(),
    initiatingPartyNpi: varchar("initiatingPartyNpi", { length: 20 }),

    respondingPartyId: varchar("respondingPartyId", { length: 64 }),
    respondingPartyType: mysqlEnum("respondingPartyType", PARTY_TYPE),
    respondingPartyName: varchar("respondingPartyName", { length: 255 }),
    respondingPartyNpi: varchar("respondingPartyNpi", { length: 20 }),

    // Service details
    serviceType: mysqlEnum("serviceType", SERVICE_TYPE).notNull(),
    serviceDate: timestamp("serviceDate").notNull(),
    patientState: varchar("patientState", { length: 2 }).notNull(),
    facilityState: varchar("facilityState", { length: 2 }).notNull(),
    cptCodes: json("cptCodes").$type<string[]>().notNull(),
    icd10Codes: json("icd10Codes").$type<string[]>(),

    // Financial
    billedAmount: decimal("billedAmount", { precision: 12, scale: 2 }).notNull(),
    qpaAmount: decimal("qpaAmount", { precision: 12, scale: 2 }),
    initiatingPartyOffer: decimal("initiatingPartyOffer", { precision: 12, scale: 2 }),
    respondingPartyOffer: decimal("respondingPartyOffer", { precision: 12, scale: 2 }),
    determinationAmount: decimal("determinationAmount", { precision: 12, scale: 2 }),
    adminFeeAmount: decimal("adminFeeAmount", { precision: 12, scale: 2 }),

    // Workflow state
    currentStep: mysqlEnum("currentStep", IDR_STEP).notNull().default("STEP_01_OPEN_NEGOTIATION_INITIATED"),
    status: mysqlEnum("status", DISPUTE_STATUS).notNull().default("open_negotiation"),
    idrEntityId: varchar("idrEntityId", { length: 64 }),
    idrEntityName: varchar("idrEntityName", { length: 255 }),

    // Deadlines (business days per NSA)
    openNegotiationDeadline: timestamp("openNegotiationDeadline"),  // +30 business days from step 1
    idrInitiationDeadline: timestamp("idrInitiationDeadline"),      // +4 business days from step 3
    entitySelectionDeadline: timestamp("entitySelectionDeadline"),  // +4 business days from step 5
    eligibilityDeadline: timestamp("eligibilityDeadline"),          // +3 business days from step 7
    offerSubmissionDeadline: timestamp("offerSubmissionDeadline"),  // +10 business days from step 8
    additionalInfoDeadline: timestamp("additionalInfoDeadline"),    // +5 business days from step 10
    determinationDeadline: timestamp("determinationDeadline"),      // +30 business days from step 9
    paymentDeadline: timestamp("paymentDeadline"),                  // +30 days from step 13

    // Metadata
    isEligible: boolean("isEligible"),
    ineligibilityReason: text("ineligibilityReason"),
    determinationBasis: text("determinationBasis"),
    notes: text("notes"),
    createdBy: varchar("createdBy", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow(),
    closedAt: timestamp("closedAt"),
  },
  (t) => ({
    statusIdx: index("disputes_status_idx").on(t.status),
    stepIdx: index("disputes_step_idx").on(t.currentStep),
    initiatingIdx: index("disputes_initiating_idx").on(t.initiatingPartyId),
    respondingIdx: index("disputes_responding_idx").on(t.respondingPartyId),
    refIdx: index("disputes_ref_idx").on(t.referenceNumber),
  })
);

export type Dispute = typeof disputes.$inferSelect;
export type InsertDispute = typeof disputes.$inferInsert;

/**
 * Dispute timeline events — one row per step transition.
 */
export const disputeEvents = mysqlTable(
  "dispute_events",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    disputeId: varchar("disputeId", { length: 64 }).notNull(),
    step: mysqlEnum("step", IDR_STEP).notNull(),
    previousStep: mysqlEnum("previousStep", IDR_STEP),
    eventType: varchar("eventType", { length: 64 }).notNull(), // step_advanced, offer_submitted, document_uploaded, etc.
    description: text("description").notNull(),
    performedBy: varchar("performedBy", { length: 64 }),
    performedByName: varchar("performedByName", { length: 255 }),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow(),
  },
  (t) => ({
    disputeIdx: index("events_dispute_idx").on(t.disputeId),
    stepIdx: index("events_step_idx").on(t.step),
  })
);

export type DisputeEvent = typeof disputeEvents.$inferSelect;

/**
 * Offers submitted during IDR process.
 */
export const disputeOffers = mysqlTable(
  "dispute_offers",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    disputeId: varchar("disputeId", { length: 64 }).notNull(),
    offerType: mysqlEnum("offerType", ["initiating_party", "responding_party", "qpa", "determination"]).notNull(),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    rationale: text("rationale"),
    supportingDocIds: json("supportingDocIds").$type<string[]>(),
    submittedBy: varchar("submittedBy", { length: 64 }),
    submittedAt: timestamp("submittedAt").defaultNow(),
    isAccepted: boolean("isAccepted").default(false),
  },
  (t) => ({
    disputeIdx: index("offers_dispute_idx").on(t.disputeId),
  })
);

export type DisputeOffer = typeof disputeOffers.$inferSelect;

/**
 * Supporting documents attached to disputes.
 */
export const disputeDocuments = mysqlTable(
  "dispute_documents",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    disputeId: varchar("disputeId", { length: 64 }).notNull(),
    documentType: varchar("documentType", { length: 64 }).notNull(), // eob, claim_form, medical_record, qpa_evidence, etc.
    fileName: varchar("fileName", { length: 255 }).notNull(),
    fileSize: int("fileSize"),
    mimeType: varchar("mimeType", { length: 128 }),
    s3Key: varchar("s3Key", { length: 512 }),
    uploadedBy: varchar("uploadedBy", { length: 64 }),
    uploadedAt: timestamp("uploadedAt").defaultNow(),
    description: text("description"),
  },
  (t) => ({
    disputeIdx: index("docs_dispute_idx").on(t.disputeId),
  })
);

export type DisputeDocument = typeof disputeDocuments.$inferSelect;

/**
 * Certified IDR entities (arbitrators).
 */
export const idrEntities = mysqlTable("idr_entities", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  certificationNumber: varchar("certificationNumber", { length: 64 }).unique(),
  certificationExpiry: timestamp("certificationExpiry"),
  specialties: json("specialties").$type<string[]>(),
  states: json("states").$type<string[]>(), // licensed states
  contactEmail: varchar("contactEmail", { length: 320 }),
  contactPhone: varchar("contactPhone", { length: 20 }),
  website: varchar("website", { length: 512 }),
  avgResolutionDays: int("avgResolutionDays"),
  totalCasesHandled: int("totalCasesHandled").default(0),
  // Capacity management
  maxConcurrentCases: int("maxConcurrentCases").default(50),
  currentActiveCases: int("currentActiveCases").default(0),
  isActive: boolean("isActive").default(true),
  createdAt: timestamp("createdAt").defaultNow(),
});

export type IDREntity = typeof idrEntities.$inferSelect;

/**
 * Deadline notifications.
 */
export const notifications = mysqlTable(
  "notifications",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    disputeId: varchar("disputeId", { length: 64 }).notNull(),
    userId: varchar("userId", { length: 64 }),
    notificationType: varchar("notificationType", { length: 64 }).notNull(), // deadline_warning, step_advanced, determination_issued
    title: varchar("title", { length: 255 }).notNull(),
    message: text("message").notNull(),
    dueDate: timestamp("dueDate"),
    isRead: boolean("isRead").default(false),
    createdAt: timestamp("createdAt").defaultNow(),
  },
  (t) => ({
    disputeIdx: index("notif_dispute_idx").on(t.disputeId),
    userIdx: index("notif_user_idx").on(t.userId),
    readIdx: index("notif_read_idx").on(t.isRead),
  })
);

export type Notification = typeof notifications.$inferSelect;

/**
 * Draft disputes — auto-saved wizard state before formal submission.
 * Keyed by userId so each user has one active draft per session.
 */
export const disputeDrafts = mysqlTable(
  "dispute_drafts",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: varchar("userId", { length: 64 }).notNull(),
    // Wizard step reached
    currentWizardStep: int("currentWizardStep").default(1).notNull(),
    // Serialised form data (all fields)
    formData: json("formData").$type<Record<string, unknown>>().notNull(),
    // QPA validation cache — last validated billed amount + result
    lastQpaValidatedAmount: decimal("lastQpaValidatedAmount", { precision: 12, scale: 2 }),
    qpaValidationResult: json("qpaValidationResult").$type<{
      qpaEstimate: number;
      withinQpaRange: boolean;
      percentageOfQpa: number;
      recommendation: string;
      cptBenchmarks: Record<string, number>;
    } | null>(),
    createdAt: timestamp("createdAt").defaultNow(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow(),
  },
  (t) => ({
    userIdx: index("drafts_user_idx").on(t.userId),
  })
);

export type DisputeDraft = typeof disputeDrafts.$inferSelect;
export type InsertDisputeDraft = typeof disputeDrafts.$inferInsert;
