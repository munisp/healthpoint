import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  varchar,
  integer,
  numeric,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Core user table backing auth flow.
 */
export const roleEnum = pgEnum("role", ["user", "admin"]);
export const users = pgTable("users", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow(),
});
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── NSA IDR 19-Step Workflow ────────────────────────────────────────────────
export const IDR_STEP = [
  "STEP_01_OPEN_NEGOTIATION_INITIATED",
  "STEP_02_OPEN_NEGOTIATION_PERIOD",
  "STEP_03_OPEN_NEGOTIATION_FAILED",
  "STEP_04_IDR_INITIATED",
  "STEP_05_IDR_NOTICE_SENT",
  "STEP_06_IDR_ENTITY_SELECTION",
  "STEP_07_IDR_ENTITY_SELECTED",
  "STEP_08_ELIGIBILITY_REVIEW",
  "STEP_09_OFFER_SUBMISSION",
  "STEP_10_QPA_DISCLOSURE",
  "STEP_11_ADDITIONAL_INFORMATION",
  "STEP_12_ARBITRATION_REVIEW",
  "STEP_13_DETERMINATION_ISSUED",
  "STEP_14_PAYMENT_DETERMINATION",
  "STEP_15_PAYMENT_MADE",
  "STEP_16_ADMINISTRATIVE_FEE_PAID",
  "STEP_17_DISPUTE_CLOSED",
  "STEP_18_APPEAL_FILED",
  "STEP_19_APPEAL_RESOLVED",
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
  "assistant_surgeon",
  "hospitalist",
  "intensivist",
  "air_ambulance",
  "ground_ambulance",
  "other",
] as const;

// ─── PG Enums ─────────────────────────────────────────────────────────────────
export const idrStepEnum = pgEnum("idr_step", IDR_STEP);
export const disputeStatusEnum = pgEnum("dispute_status", DISPUTE_STATUS);
export const partyTypeEnum = pgEnum("party_type", PARTY_TYPE);
export const serviceTypeEnum = pgEnum("service_type", SERVICE_TYPE);
export const offerTypeEnum = pgEnum("offer_type", ["initiating_party", "responding_party", "qpa", "determination"]);

// ─── Disputes ─────────────────────────────────────────────────────────────────
export const disputes = pgTable(
  "disputes",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    referenceNumber: varchar("referenceNumber", { length: 32 }).notNull().unique(),
    // Parties
    initiatingPartyId: varchar("initiatingPartyId", { length: 64 }).notNull(),
    initiatingPartyType: partyTypeEnum("initiatingPartyType").notNull(),
    initiatingPartyName: varchar("initiatingPartyName", { length: 255 }).notNull(),
    initiatingPartyNpi: varchar("initiatingPartyNpi", { length: 20 }),
    respondingPartyId: varchar("respondingPartyId", { length: 64 }),
    respondingPartyType: partyTypeEnum("respondingPartyType"),
    respondingPartyName: varchar("respondingPartyName", { length: 255 }),
    respondingPartyNpi: varchar("respondingPartyNpi", { length: 20 }),
    // Service details
    serviceType: serviceTypeEnum("serviceType").notNull(),
    serviceDate: timestamp("serviceDate").notNull(),
    patientState: varchar("patientState", { length: 2 }).notNull(),
    facilityState: varchar("facilityState", { length: 2 }).notNull(),
    cptCodes: jsonb("cptCodes").$type<string[]>().notNull(),
    icd10Codes: jsonb("icd10Codes").$type<string[]>(),
    // Financial
    billedAmount: numeric("billedAmount", { precision: 12, scale: 2 }).notNull(),
    qpaAmount: numeric("qpaAmount", { precision: 12, scale: 2 }),
    initiatingPartyOffer: numeric("initiatingPartyOffer", { precision: 12, scale: 2 }),
    respondingPartyOffer: numeric("respondingPartyOffer", { precision: 12, scale: 2 }),
    determinationAmount: numeric("determinationAmount", { precision: 12, scale: 2 }),
    adminFeeAmount: numeric("adminFeeAmount", { precision: 12, scale: 2 }),
    // Workflow state
    currentStep: idrStepEnum("currentStep").notNull().default("STEP_01_OPEN_NEGOTIATION_INITIATED"),
    status: disputeStatusEnum("status").notNull().default("open_negotiation"),
    idrEntityId: varchar("idrEntityId", { length: 64 }),
    idrEntityName: varchar("idrEntityName", { length: 255 }),
    // Deadlines
    openNegotiationDeadline: timestamp("openNegotiationDeadline"),
    idrInitiationDeadline: timestamp("idrInitiationDeadline"),
    entitySelectionDeadline: timestamp("entitySelectionDeadline"),
    eligibilityDeadline: timestamp("eligibilityDeadline"),
    offerSubmissionDeadline: timestamp("offerSubmissionDeadline"),
    additionalInfoDeadline: timestamp("additionalInfoDeadline"),
    determinationDeadline: timestamp("determinationDeadline"),
    paymentDeadline: timestamp("paymentDeadline"),
    // Metadata
    isEligible: boolean("isEligible"),
    ineligibilityReason: text("ineligibilityReason"),
    determinationBasis: text("determinationBasis"),
    notes: text("notes"),
    createdBy: varchar("createdBy", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow(),
    updatedAt: timestamp("updatedAt").defaultNow(),
    closedAt: timestamp("closedAt"),
  },
  (t) => [
    index("disputes_status_idx").on(t.status),
    index("disputes_step_idx").on(t.currentStep),
    index("disputes_initiating_idx").on(t.initiatingPartyId),
    index("disputes_responding_idx").on(t.respondingPartyId),
    uniqueIndex("disputes_ref_idx").on(t.referenceNumber),
  ]
);
export type Dispute = typeof disputes.$inferSelect;
export type InsertDispute = typeof disputes.$inferInsert;

// ─── Dispute Events ───────────────────────────────────────────────────────────
export const disputeEvents = pgTable(
  "dispute_events",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    disputeId: varchar("disputeId", { length: 64 }).notNull(),
    step: idrStepEnum("step").notNull(),
    previousStep: idrStepEnum("previousStep"),
    eventType: varchar("eventType", { length: 64 }).notNull(),
    description: text("description").notNull(),
    performedBy: varchar("performedBy", { length: 64 }),
    performedByName: varchar("performedByName", { length: 255 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow(),
  },
  (t) => [
    index("events_dispute_idx").on(t.disputeId),
    index("events_step_idx").on(t.step),
  ]
);
export type DisputeEvent = typeof disputeEvents.$inferSelect;

// ─── Dispute Offers ───────────────────────────────────────────────────────────
export const disputeOffers = pgTable(
  "dispute_offers",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    disputeId: varchar("disputeId", { length: 64 }).notNull(),
    offerType: offerTypeEnum("offerType").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    rationale: text("rationale"),
    supportingDocIds: jsonb("supportingDocIds").$type<string[]>(),
    submittedBy: varchar("submittedBy", { length: 64 }),
    submittedAt: timestamp("submittedAt").defaultNow(),
    isAccepted: boolean("isAccepted").default(false),
  },
  (t) => [
    index("offers_dispute_idx").on(t.disputeId),
  ]
);
export type DisputeOffer = typeof disputeOffers.$inferSelect;

// ─── Dispute Documents ────────────────────────────────────────────────────────
export const disputeDocuments = pgTable(
  "dispute_documents",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    disputeId: varchar("disputeId", { length: 64 }).notNull(),
    documentType: varchar("documentType", { length: 64 }).notNull(),
    fileName: varchar("fileName", { length: 255 }).notNull(),
    fileSize: integer("fileSize"),
    mimeType: varchar("mimeType", { length: 128 }),
    s3Key: varchar("s3Key", { length: 512 }),
    uploadedBy: varchar("uploadedBy", { length: 64 }),
    uploadedAt: timestamp("uploadedAt").defaultNow(),
    description: text("description"),
  },
  (t) => [
    index("docs_dispute_idx").on(t.disputeId),
  ]
);
export type DisputeDocument = typeof disputeDocuments.$inferSelect;

// ─── IDR Entities ─────────────────────────────────────────────────────────────
export const idrEntities = pgTable("idr_entities", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  certificationNumber: varchar("certificationNumber", { length: 64 }).unique(),
  certificationExpiry: timestamp("certificationExpiry"),
  specialties: jsonb("specialties").$type<string[]>(),
  states: jsonb("states").$type<string[]>(),
  contactEmail: varchar("contactEmail", { length: 320 }),
  contactPhone: varchar("contactPhone", { length: 20 }),
  website: varchar("website", { length: 512 }),
  avgResolutionDays: integer("avgResolutionDays"),
  totalCasesHandled: integer("totalCasesHandled").default(0),
  maxConcurrentCases: integer("maxConcurrentCases").default(50),
  currentActiveCases: integer("currentActiveCases").default(0),
  isActive: boolean("isActive").default(true),
  createdAt: timestamp("createdAt").defaultNow(),
});
export type IDREntity = typeof idrEntities.$inferSelect;

// ─── Notifications ────────────────────────────────────────────────────────────
export const notifications = pgTable(
  "notifications",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    disputeId: varchar("disputeId", { length: 64 }).notNull(),
    userId: varchar("userId", { length: 64 }),
    notificationType: varchar("notificationType", { length: 64 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    message: text("message").notNull(),
    dueDate: timestamp("dueDate"),
    isRead: boolean("isRead").default(false),
    createdAt: timestamp("createdAt").defaultNow(),
  },
  (t) => [
    index("notif_dispute_idx").on(t.disputeId),
    index("notif_user_idx").on(t.userId),
    index("notif_read_idx").on(t.isRead),
  ]
);
export type Notification = typeof notifications.$inferSelect;

// ─── Dispute Drafts ───────────────────────────────────────────────────────────
export const disputeDrafts = pgTable("dispute_drafts", {
  id: varchar("id", { length: 64 }).primaryKey(),
  userId: varchar("userId", { length: 64 }).notNull(),
  formData: jsonb("formData").$type<Record<string, unknown>>().notNull(),
  currentStep: integer("currentStep").default(1),
  lastSavedAt: timestamp("lastSavedAt").defaultNow(),
  createdAt: timestamp("createdAt").defaultNow(),
});
export type DisputeDraft = typeof disputeDrafts.$inferSelect;
export type InsertDisputeDraft = typeof disputeDrafts.$inferInsert;

// ─── CMS Submission Drafts ────────────────────────────────────────────────────
export const cmsDraftStatusEnum = pgEnum("cms_draft_status", ["draft", "submitted", "determined", "withdrawn"]);

export const cmsDrafts = pgTable(
  "cms_drafts",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    disputeId: varchar("disputeId", { length: 64 }).notNull(),
    createdBy: varchar("createdBy", { length: 64 }).notNull(),
    status: cmsDraftStatusEnum("status").default("draft").notNull(),
    // Eligibility result
    isEligible: boolean("isEligible").notNull(),
    eligibilityReason: text("eligibilityReason").notNull(),
    missingRequirements: jsonb("missingRequirements").$type<string[]>().notNull(),
    warnings: jsonb("warnings").$type<string[]>().notNull(),
    estimatedDeadline: varchar("estimatedDeadline", { length: 64 }),
    regulatoryBasis: jsonb("regulatoryBasis").$type<string[]>(),
    // Draft content
    formFields: jsonb("formFields").$type<Record<string, string>>().notNull(),
    attachmentChecklist: jsonb("attachmentChecklist").$type<Array<{ item: string; status: string; required?: boolean }>>().notNull(),
    submissionNarrative: text("submissionNarrative").notNull(),
    draftRegulatoryBasis: jsonb("draftRegulatoryBasis").$type<string[]>(),
    estimatedOutcome: text("estimatedOutcome").notNull(),
    nextSteps: jsonb("nextSteps").$type<string[]>().notNull(),
    // Agent metadata
    additionalContext: text("additionalContext"),
    processingTimeSeconds: numeric("processingTimeSeconds", { precision: 6, scale: 2 }),
    agentTrace: jsonb("agentTrace").$type<string[]>(),
    // Timestamps
    submittedAt: timestamp("submittedAt"),
    createdAt: timestamp("createdAt").defaultNow(),
    updatedAt: timestamp("updatedAt").defaultNow(),
  },
  (t) => [
    index("cms_drafts_dispute_idx").on(t.disputeId),
    index("cms_drafts_user_idx").on(t.createdBy),
    index("cms_drafts_status_idx").on(t.status),
  ]
);
export type CMSDraft = typeof cmsDrafts.$inferSelect;
export type InsertCMSDraft = typeof cmsDrafts.$inferInsert;

// ─── EMR Connections ─────────────────────────────────────────────────────────
export const emrStatusEnum = pgEnum("emr_status", ["active", "inactive", "error", "testing"]);

export const emrConnections = pgTable(
  "emr_connections",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    emrSystem: varchar("emrSystem", { length: 64 }).notNull(),   // epic, cerner, meditech, etc.
    authType: varchar("authType", { length: 32 }).notNull(),     // oauth2, apikey, bearer
    baseUrl: text("baseUrl").notNull(),
    fhirVersion: varchar("fhirVersion", { length: 8 }).default("R4"),
    // Credentials stored as encrypted JSON (never returned to client)
    credentialsEncrypted: text("credentialsEncrypted"),
    // Field mappings: IDR field → FHIR path
    fieldMappings: jsonb("fieldMappings").$type<Record<string, string>>().notNull(),
    // Status & health
    status: emrStatusEnum("status").default("inactive").notNull(),
    lastTestAt: timestamp("lastTestAt"),
    lastTestSuccess: boolean("lastTestSuccess"),
    lastTestMessage: text("lastTestMessage"),
    aiConfidenceScore: numeric("aiConfidenceScore", { precision: 4, scale: 3 }),
    resourcesFound: jsonb("resourcesFound").$type<string[]>(),
    // Ownership
    createdBy: varchar("createdBy", { length: 64 }).notNull(),
    // Timestamps
    createdAt: timestamp("createdAt").defaultNow(),
    updatedAt: timestamp("updatedAt").defaultNow(),
  },
  (t) => [
    index("emr_connections_user_idx").on(t.createdBy),
    index("emr_connections_status_idx").on(t.status),
    index("emr_connections_system_idx").on(t.emrSystem),
  ]
);
export type EMRConnection = typeof emrConnections.$inferSelect;
export type InsertEMRConnection = typeof emrConnections.$inferInsert;

// ─── EMR Sync Logs ────────────────────────────────────────────────────────────────────────────────
export const emrSyncTriggerEnum = pgEnum("emr_sync_trigger", ["manual", "dispute_pull", "heartbeat", "test"]);
export const emrSyncStatusEnum = pgEnum("emr_sync_status", ["success", "partial", "failed", "timeout"]);

export const emrSyncLogs = pgTable(
  "emr_sync_logs",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    connectionId: varchar("connectionId", { length: 64 }).notNull(),
    triggeredBy: varchar("triggeredBy", { length: 64 }),
    triggerType: emrSyncTriggerEnum("triggerType").default("manual").notNull(),
    status: emrSyncStatusEnum("status").default("success").notNull(),
    fieldsExtracted: integer("fieldsExtracted").default(0),
    fhirResourcesAccessed: jsonb("fhirResourcesAccessed").$type<string[]>(),
    patientId: varchar("patientId", { length: 128 }),
    claimId: varchar("claimId", { length: 128 }),
    disputeId: varchar("disputeId", { length: 64 }),
    durationMs: integer("durationMs"),
    errorMessage: text("errorMessage"),
    warnings: jsonb("warnings").$type<string[]>(),
    fieldConfidence: jsonb("fieldConfidence").$type<Record<string, number>>(),
    summary: text("summary"),
    createdAt: timestamp("createdAt").defaultNow(),
  },
  (t) => [
    index("emr_sync_logs_conn_idx").on(t.connectionId),
    index("emr_sync_logs_created_idx").on(t.createdAt),
  ]
);

export type EMRSyncLog = typeof emrSyncLogs.$inferSelect;
export type InsertEMRSyncLog = typeof emrSyncLogs.$inferInsert;

// ── Dispute Templates ─────────────────────────────────────────────────────────
export const disputeTemplates = pgTable(
  "dispute_templates",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    createdBy: varchar("createdBy", { length: 64 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    serviceType: varchar("serviceType", { length: 64 }),
    initiatingPartyName: varchar("initiatingPartyName", { length: 255 }),
    initiatingPartyType: varchar("initiatingPartyType", { length: 64 }),
    respondingPartyName: varchar("respondingPartyName", { length: 255 }),
    respondingPartyType: varchar("respondingPartyType", { length: 64 }),
    billedAmount: varchar("billedAmount", { length: 32 }),
    qpaAmount: varchar("qpaAmount", { length: 32 }),
    dateOfService: varchar("dateOfService", { length: 32 }),
    patientName: varchar("patientName", { length: 255 }),
    claimNumber: varchar("claimNumber", { length: 128 }),
    cptCodes: jsonb("cptCodes").$type<string[]>(),
    icdCodes: jsonb("icdCodes").$type<string[]>(),
    notes: text("notes"),
    usageCount: integer("usageCount").default(0),
    createdAt: timestamp("createdAt").defaultNow(),
    updatedAt: timestamp("updatedAt").defaultNow(),
  },
  (t) => [
    index("dispute_templates_user_idx").on(t.createdBy),
    index("dispute_templates_created_idx").on(t.createdAt),
  ]
);
export type DisputeTemplate = typeof disputeTemplates.$inferSelect;
export type InsertDisputeTemplate = typeof disputeTemplates.$inferInsert;

// ─── User Profiles (onboarding data) ─────────────────────────────────────────
export const stakeholderRoleEnum = pgEnum("stakeholder_role", [
  "provider",
  "facility",
  "payer",
  "idr_entity",
  "other",
]);

export const userProfiles = pgTable(
  "user_profiles",
  {
    id: varchar("id", { length: 64 }).primaryKey(), // same as users.id (FK)
    orgName: varchar("orgName", { length: 255 }),
    orgType: varchar("orgType", { length: 128 }),
    stakeholderRole: stakeholderRoleEnum("stakeholderRole").default("provider"),
    npi: varchar("npi", { length: 32 }),
    taxId: varchar("taxId", { length: 32 }),
    phone: varchar("phone", { length: 32 }),
    preferredContact: varchar("preferredContact", { length: 64 }),
    onboardingCompleted: boolean("onboardingCompleted").default(false),
    onboardingCompletedAt: timestamp("onboardingCompletedAt"),
    createdAt: timestamp("createdAt").defaultNow(),
    updatedAt: timestamp("updatedAt").defaultNow(),
  },
  (t) => [
    index("user_profiles_role_idx").on(t.stakeholderRole),
  ]
);
export type UserProfile = typeof userProfiles.$inferSelect;
export type InsertUserProfile = typeof userProfiles.$inferInsert;

// ─── Marketing Leads (lead-capture form from landing page) ────────────────────
export const leadStatusEnum = pgEnum("lead_status", [
  "new",
  "contacted",
  "qualified",
  "converted",
  "disqualified",
]);

export const marketingLeads = pgTable(
  "marketing_leads",
  {
    id: varchar("id", { length: 64 }).primaryKey().$defaultFn(() =>
      `lead_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    ),
    firstName: varchar("firstName", { length: 128 }),
    lastName: varchar("lastName", { length: 128 }),
    email: varchar("email", { length: 320 }).notNull(),
    orgName: varchar("orgName", { length: 255 }),
    orgType: varchar("orgType", { length: 128 }),
    stakeholderRole: varchar("stakeholderRole", { length: 64 }),
    phone: varchar("phone", { length: 32 }),
    message: text("message"),
    source: varchar("source", { length: 128 }).default("landing_page"),
    utmSource: varchar("utmSource", { length: 128 }),
    utmMedium: varchar("utmMedium", { length: 128 }),
    utmCampaign: varchar("utmCampaign", { length: 128 }),
    status: leadStatusEnum("status").default("new").notNull(),
    convertedUserId: varchar("convertedUserId", { length: 64 }),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow(),
    updatedAt: timestamp("updatedAt").defaultNow(),
  },
  (t) => [
    index("marketing_leads_email_idx").on(t.email),
    index("marketing_leads_status_idx").on(t.status),
    index("marketing_leads_role_idx").on(t.stakeholderRole),
  ]
);
export type MarketingLead = typeof marketingLeads.$inferSelect;
export type InsertMarketingLead = typeof marketingLeads.$inferInsert;

// ─── Audit Log ────────────────────────────────────────────────────────────────
export const auditLog = pgTable(
  "audit_log",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: varchar("userId", { length: 64 }).notNull(),
    action: varchar("action", { length: 128 }).notNull(),
    entityType: varchar("entityType", { length: 64 }).notNull(),
    entityId: varchar("entityId", { length: 64 }),
    oldValue: text("oldValue"),
    newValue: text("newValue"),
    ipAddress: varchar("ipAddress", { length: 64 }),
    userAgent: text("userAgent"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    index("audit_log_userId_idx").on(t.userId),
    index("audit_log_entityType_entityId_idx").on(t.entityType, t.entityId),
    index("audit_log_createdAt_idx").on(t.createdAt),
  ]
);
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type InsertAuditLogEntry = typeof auditLog.$inferInsert;
// ─── Webhooks ─────────────────────────────────────────────────────────────────
export const webhookStatusEnum = pgEnum("webhook_status", ["active", "paused", "failed"]);
export const webhooks = pgTable(
  "webhooks",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: varchar("userId", { length: 64 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    url: text("url").notNull(),
    secret: varchar("secret", { length: 128 }).notNull(),
    events: text("events").notNull(),
    status: webhookStatusEnum().default("active").notNull(),
    lastTriggeredAt: timestamp("lastTriggeredAt"),
    failureCount: integer("failureCount").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => [
    index("webhooks_userId_idx").on(t.userId),
    index("webhooks_status_idx").on(t.status),
  ]
);
export type Webhook = typeof webhooks.$inferSelect;
export type InsertWebhook = typeof webhooks.$inferInsert;
// ─── Outcome Predictions ──────────────────────────────────────────────────────
export const outcomePredictions = pgTable(
  "outcome_predictions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    disputeId: varchar("disputeId", { length: 64 }).notNull(),
    winProbability: integer("winProbability").notNull(),
    confidenceScore: integer("confidenceScore").notNull(),
    keyFactors: text("keyFactors").notNull(),
    recommendation: text("recommendation").notNull(),
    modelVersion: varchar("modelVersion", { length: 32 }).default("v1").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => [
    index("outcome_predictions_disputeId_idx").on(t.disputeId),
  ]
);
export type OutcomePrediction = typeof outcomePredictions.$inferSelect;
export type InsertOutcomePrediction = typeof outcomePredictions.$inferInsert;
// ─── Document Analysis ────────────────────────────────────────────────────────
export const documentAnalysisStatusEnum = pgEnum("doc_analysis_status", ["pending", "processing", "completed", "failed"]);
export const documentAnalyses = pgTable(
  "document_analyses",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    disputeId: varchar("disputeId", { length: 64 }),
    userId: varchar("userId", { length: 64 }).notNull(),
    fileName: varchar("fileName", { length: 256 }).notNull(),
    fileType: varchar("fileType", { length: 64 }).notNull(),
    s3Key: varchar("s3Key", { length: 512 }),
    status: documentAnalysisStatusEnum().default("pending").notNull(),
    ocrText: text("ocrText"),
    extractedFields: jsonb("extractedFields"),
    confidence: integer("confidence").default(0),
    processingTimeMs: integer("processingTimeMs"),
    errorMessage: text("errorMessage"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => [
    index("doc_analyses_disputeId_idx").on(t.disputeId),
    index("doc_analyses_userId_idx").on(t.userId),
    index("doc_analyses_status_idx").on(t.status),
  ]
);
export type DocumentAnalysis = typeof documentAnalyses.$inferSelect;
export type InsertDocumentAnalysis = typeof documentAnalyses.$inferInsert;
