import { eq, desc, and, or, like, count, sql, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  InsertUser, users,
  disputes, InsertDispute, Dispute,
  disputeEvents, DisputeEvent,
  disputeOffers, DisputeOffer,
  disputeDocuments, DisputeDocument,
  idrEntities, IDREntity,
  notifications, Notification,
  disputeDrafts, DisputeDraft, InsertDisputeDraft,
  cmsDrafts, CMSDraft, InsertCMSDraft,
  disputeTemplates, DisputeTemplate, InsertDisputeTemplate,
  userProfiles, UserProfile, InsertUserProfile,
  marketingLeads, MarketingLead, InsertMarketingLead,
  auditLog, AuditLogEntry, InsertAuditLogEntry,
  webhooks, Webhook, InsertWebhook,
  outcomePredictions, OutcomePrediction, InsertOutcomePrediction,
  documentAnalyses, DocumentAnalysis, InsertDocumentAnalysis,
  IDR_STEP, IDRStep, DISPUTE_STATUS, DisputeStatus,
} from "../drizzle/schema";
import { ENV } from './_core/env';

const LOCAL_PG_URL = "postgresql://idr_user:idr_pass123@localhost:5432/idr_demo";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db) {
    try {
      const connectionString = LOCAL_PG_URL;
      const client = postgres(connectionString, { max: 10 });
      _db = drizzle(client);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── User helpers ─────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.id) throw new Error("User ID is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }
  try {
    const values: InsertUser = { id: user.id };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role === undefined && user.id === ENV.ownerId) { user.role = 'admin'; values.role = 'admin'; updateSet.role = 'admin'; }
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onConflictDoUpdate({ target: users.id, set: updateSet });
  } catch (error) { console.error("[Database] Failed to upsert user:", error); throw error; }
}

export async function getUser(id: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Business day calculation ─────────────────────────────────────────────────

const US_FEDERAL_HOLIDAYS_2024_2025 = [
  "2024-01-01", "2024-01-15", "2024-02-19", "2024-05-27", "2024-06-19",
  "2024-07-04", "2024-09-02", "2024-10-14", "2024-11-11", "2024-11-28",
  "2024-12-25", "2025-01-01", "2025-01-20", "2025-02-17", "2025-05-26",
  "2025-06-19", "2025-07-04", "2025-09-01", "2025-10-13", "2025-11-11",
  "2025-11-27", "2025-12-25", "2026-01-01", "2026-01-19", "2026-02-16",
  "2026-05-25", "2026-06-19", "2026-07-04", "2026-09-07",
];

export function addBusinessDays(startDate: Date, businessDays: number): Date {
  const holidays = new Set(US_FEDERAL_HOLIDAYS_2024_2025);
  let current = new Date(startDate);
  let added = 0;
  while (added < businessDays) {
    current.setDate(current.getDate() + 1);
    const dayOfWeek = current.getDay();
    const dateStr = current.toISOString().split('T')[0];
    if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidays.has(dateStr)) {
      added++;
    }
  }
  return current;
}

export function generateReferenceNumber(): string {
  const year = new Date().getFullYear();
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `IDR-${year}-${rand}`;
}

// ─── Dispute helpers ──────────────────────────────────────────────────────────

export async function createDispute(data: InsertDispute): Promise<Dispute> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const now = new Date();
  const id = crypto.randomUUID();
  const referenceNumber = generateReferenceNumber();
  // Calculate NSA-mandated deadlines
  const openNegotiationDeadline = addBusinessDays(now, 30);
  const insertData: InsertDispute = {
    ...data,
    id,
    referenceNumber,
    currentStep: "STEP_01_OPEN_NEGOTIATION_INITIATED",
    status: "open_negotiation",
    openNegotiationDeadline,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(disputes).values(insertData);
  // Create initial timeline event
  await createDisputeEvent({
    id: crypto.randomUUID(),
    disputeId: id,
    step: "STEP_01_OPEN_NEGOTIATION_INITIATED",
    eventType: "dispute_created",
    description: "Open negotiation notice initiated under NSA §2799A-1",
    performedBy: data.createdBy ?? null,
    performedByName: data.initiatingPartyName,
    metadata: { referenceNumber, openNegotiationDeadline: openNegotiationDeadline.toISOString() },
  });
  const result = await db.select().from(disputes).where(eq(disputes.id, id)).limit(1);
  return result[0];
}

export async function getDisputeById(id: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(disputes).where(eq(disputes.id, id)).limit(1);
  if (result.length === 0) return null;
  const dispute = result[0];
  // Fetch related data
  const [events, offers, documents] = await Promise.all([
    db.select().from(disputeEvents).where(eq(disputeEvents.disputeId, id)).orderBy(disputeEvents.createdAt),
    db.select().from(disputeOffers).where(eq(disputeOffers.disputeId, id)).orderBy(disputeOffers.submittedAt),
    db.select().from(disputeDocuments).where(eq(disputeDocuments.disputeId, id)).orderBy(disputeDocuments.uploadedAt),
  ]);
  return { ...dispute, events, offers, documents };
}

export async function listDisputes(opts: {
  userId?: string;
  status?: DisputeStatus;
  serviceType?: string;
  search?: string;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };
  const { limit = 20, offset = 0, status, serviceType, search } = opts;
  const conditions = [];
  if (status) conditions.push(eq(disputes.status, status));
  if (serviceType) conditions.push(sql`${disputes.serviceType} = ${serviceType}`);
  if (search) {
    conditions.push(
      or(
        like(disputes.referenceNumber, `%${search}%`),
        like(disputes.initiatingPartyName, `%${search}%`),
        like(disputes.respondingPartyName, `%${search}%`)
      )
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [items, totalResult] = await Promise.all([
    db.select().from(disputes).where(where).orderBy(desc(disputes.createdAt)).limit(limit).offset(offset),
    db.select({ count: count() }).from(disputes).where(where),
  ]);
  return { items, total: totalResult[0]?.count ?? 0 };
}

export async function advanceDisputeStep(
  disputeId: string,
  newStep: IDRStep,
  newStatus: DisputeStatus,
  performedBy: string,
  performedByName: string,
  description: string,
  additionalData?: Partial<InsertDispute>
): Promise<Dispute> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db.select().from(disputes).where(eq(disputes.id, disputeId)).limit(1);
  if (existing.length === 0) throw new Error("Dispute not found");
  const now = new Date();
  // Calculate step-specific deadlines
  const deadlineUpdates: Partial<InsertDispute> = {};
  if (newStep === "STEP_04_IDR_INITIATED") {
    deadlineUpdates.idrInitiationDeadline = addBusinessDays(now, 4);
  } else if (newStep === "STEP_06_IDR_ENTITY_SELECTION") {
    deadlineUpdates.entitySelectionDeadline = addBusinessDays(now, 4);
  } else if (newStep === "STEP_08_ELIGIBILITY_REVIEW") {
    deadlineUpdates.eligibilityDeadline = addBusinessDays(now, 3);
  } else if (newStep === "STEP_09_OFFER_SUBMISSION") {
    deadlineUpdates.offerSubmissionDeadline = addBusinessDays(now, 10);
    deadlineUpdates.determinationDeadline = addBusinessDays(now, 30);
  } else if (newStep === "STEP_11_ADDITIONAL_INFORMATION") {
    deadlineUpdates.additionalInfoDeadline = addBusinessDays(now, 5);
  } else if (newStep === "STEP_14_PAYMENT_DETERMINATION") {
    deadlineUpdates.paymentDeadline = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  } else if (newStep === "STEP_17_DISPUTE_CLOSED") {
    deadlineUpdates.closedAt = now;
  }
  await db.update(disputes).set({
    currentStep: newStep,
    status: newStatus,
    updatedAt: now,
    ...deadlineUpdates,
    ...additionalData,
  }).where(eq(disputes.id, disputeId));
  await createDisputeEvent({
    id: crypto.randomUUID(),
    disputeId,
    step: newStep,
    previousStep: existing[0].currentStep,
    eventType: "step_advanced",
    description,
    performedBy,
    performedByName,
    metadata: { newStatus, ...deadlineUpdates },
  });
  const updated = await db.select().from(disputes).where(eq(disputes.id, disputeId)).limit(1);
  return updated[0];
}

export async function getDashboardStats(userId: string | undefined) {
  const db = await getDb();
  if (!db) return null;
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  // 5 business days ≈ 7 calendar days (conservative)
  const fiveBusinessDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const [
    totalResult,
    openResult,
    idrResult,
    closedResult,
    overdueResult,
    dueSoonResult,
    recentDisputes,
  ] = await Promise.all([
    db.select({ count: count() }).from(disputes),
    db.select({ count: count() }).from(disputes).where(eq(disputes.status, "open_negotiation")),
    db.select({ count: count() }).from(disputes).where(inArray(disputes.status, ["idr_initiated", "idr_entity_selection", "eligibility_review", "offer_submission", "under_arbitration"])),
    db.select({ count: count() }).from(disputes).where(and(eq(disputes.status, "closed"), sql`${disputes.closedAt} >= ${thirtyDaysAgo}`)),
    db.select({ count: count() }).from(disputes).where(and(
      sql`${disputes.status} NOT IN ('closed', 'ineligible')`,
      or(
        and(sql`${disputes.openNegotiationDeadline} IS NOT NULL`, sql`${disputes.openNegotiationDeadline} < ${now}`),
        and(sql`${disputes.offerSubmissionDeadline} IS NOT NULL`, sql`${disputes.offerSubmissionDeadline} < ${now}`),
        and(sql`${disputes.paymentDeadline} IS NOT NULL`, sql`${disputes.paymentDeadline} < ${now}`)
      )
    )),
    // Due within 5 business days (not yet overdue)
    db.select({ count: count() }).from(disputes).where(and(
      sql`${disputes.status} NOT IN ('closed', 'ineligible')`,
      or(
        and(
          sql`${disputes.openNegotiationDeadline} IS NOT NULL`,
          sql`${disputes.openNegotiationDeadline} >= ${now}`,
          sql`${disputes.openNegotiationDeadline} <= ${fiveBusinessDaysFromNow}`
        ),
        and(
          sql`${disputes.offerSubmissionDeadline} IS NOT NULL`,
          sql`${disputes.offerSubmissionDeadline} >= ${now}`,
          sql`${disputes.offerSubmissionDeadline} <= ${fiveBusinessDaysFromNow}`
        ),
        and(
          sql`${disputes.paymentDeadline} IS NOT NULL`,
          sql`${disputes.paymentDeadline} >= ${now}`,
          sql`${disputes.paymentDeadline} <= ${fiveBusinessDaysFromNow}`
        )
      )
    )),
    db.select().from(disputes).orderBy(desc(disputes.createdAt)).limit(5),
  ]);
  // Unread notifications
  const notifResult = userId
    ? await db.select({ count: count() }).from(notifications)
        .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))
    : await db.select({ count: count() }).from(notifications)
        .where(eq(notifications.isRead, false));
  return {
    total: totalResult[0]?.count ?? 0,
    openNegotiation: openResult[0]?.count ?? 0,
    inIDR: idrResult[0]?.count ?? 0,
    closedThisMonth: closedResult[0]?.count ?? 0,
    overdue: overdueResult[0]?.count ?? 0,
    dueSoon: dueSoonResult[0]?.count ?? 0,
    unreadNotifications: notifResult[0]?.count ?? 0,
    recentDisputes,
  };
}

// ─── Offer helpers ────────────────────────────────────────────────────────────

export async function submitOffer(data: Omit<DisputeOffer, 'id' | 'submittedAt' | 'isAccepted'>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const id = crypto.randomUUID();
  await db.insert(disputeOffers).values({ ...data, id, isAccepted: false });
  // Update dispute with offer amount
  const updateField = data.offerType === 'initiating_party'
    ? { initiatingPartyOffer: data.amount }
    : data.offerType === 'responding_party'
    ? { respondingPartyOffer: data.amount }
    : data.offerType === 'qpa'
    ? { qpaAmount: data.amount }
    : { determinationAmount: data.amount };
  await db.update(disputes).set({ ...updateField, updatedAt: new Date() }).where(eq(disputes.id, data.disputeId));
  return id;
}

export async function acceptOffer(disputeId: string, offerId: string, performedBy: string, performedByName: string): Promise<Dispute> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db.select().from(disputes).where(eq(disputes.id, disputeId)).limit(1);
  if (existing.length === 0) throw new Error("Dispute not found");
  const offer = await db.select().from(disputeOffers).where(eq(disputeOffers.id, offerId)).limit(1);
  if (offer.length === 0) throw new Error("Offer not found");
  const now = new Date();
  // Mark offer as accepted
  await db.update(disputeOffers).set({ isAccepted: true }).where(eq(disputeOffers.id, offerId));
  // Advance dispute to determination issued
  await db.update(disputes).set({
    currentStep: "STEP_13_DETERMINATION_ISSUED",
    status: "determination_issued",
    determinationAmount: offer[0].amount,
    updatedAt: now,
  }).where(eq(disputes.id, disputeId));
  // Record timeline event
  await createDisputeEvent({
    id: crypto.randomUUID(),
    disputeId,
    step: "STEP_13_DETERMINATION_ISSUED",
    previousStep: existing[0].currentStep as IDRStep,
    eventType: "offer_accepted",
    description: `Offer of $${Number(offer[0].amount).toLocaleString()} accepted — determination issued`,
    performedBy,
    performedByName,
    metadata: { offerId, acceptedAmount: offer[0].amount },
  });
  const updated = await db.select().from(disputes).where(eq(disputes.id, disputeId)).limit(1);
  return updated[0];
}

// ─── Document helpers ─────────────────────────────────────────────────────────

export async function addDocument(data: Omit<DisputeDocument, 'id' | 'uploadedAt'>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const id = crypto.randomUUID();
  await db.insert(disputeDocuments).values({ ...data, id });
  return id;
}

// ─── IDR Entity helpers ───────────────────────────────────────────────────────

export async function listIDREntities(opts: { state?: string; specialty?: string } = {}) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(idrEntities).where(eq(idrEntities.isActive, true)).orderBy(idrEntities.name);
}

export async function seedIDREntities() {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select({ count: count() }).from(idrEntities);
  if ((existing[0]?.count ?? 0) > 0) return; // Already seeded
  const entities = [
    { id: crypto.randomUUID(), name: "JAMS Healthcare Arbitration", certificationNumber: "IDR-CERT-001", specialties: ["emergency_medicine", "anesthesiology", "radiology"], states: ["CA", "NY", "TX", "FL", "IL"], contactEmail: "idr@jams.com", contactPhone: "1-800-352-5267", website: "https://www.jamsadr.com", avgResolutionDays: 28, totalCasesHandled: 1247, isActive: true },
    { id: crypto.randomUUID(), name: "AAA Healthcare Dispute Resolution", certificationNumber: "IDR-CERT-002", specialties: ["surgery", "hospitalist", "pathology"], states: ["NY", "NJ", "CT", "MA", "PA"], contactEmail: "healthcare@adr.org", contactPhone: "1-800-778-7879", website: "https://www.adr.org", avgResolutionDays: 25, totalCasesHandled: 892, isActive: true },
    { id: crypto.randomUUID(), name: "AHLA Dispute Resolution Services", certificationNumber: "IDR-CERT-003", specialties: ["air_ambulance", "ground_ambulance", "emergency_medicine"], states: ["TX", "FL", "GA", "NC", "VA"], contactEmail: "disputes@ahla.com", contactPhone: "1-202-833-1100", website: "https://www.americanhealthlaw.org", avgResolutionDays: 22, totalCasesHandled: 634, isActive: true },
    { id: crypto.randomUUID(), name: "National Arbitration Forum Healthcare", certificationNumber: "IDR-CERT-004", specialties: ["neonatology", "radiology", "anesthesiology"], states: ["MN", "WI", "IA", "ND", "SD"], contactEmail: "healthcare@nafresolution.com", contactPhone: "1-800-474-2371", website: "https://www.nafresolution.com", avgResolutionDays: 30, totalCasesHandled: 445, isActive: true },
    { id: crypto.randomUUID(), name: "FINRA Healthcare Billing Arbitration", certificationNumber: "IDR-CERT-005", specialties: ["surgery", "emergency_medicine", "hospitalist"], states: ["DC", "MD", "VA", "DE", "WV"], contactEmail: "idr@finra.org", contactPhone: "1-301-590-6500", website: "https://www.finra.org", avgResolutionDays: 27, totalCasesHandled: 318, isActive: true },
  ];
  for (const entity of entities) {
    await db.insert(idrEntities).values(entity).onConflictDoUpdate({ target: idrEntities.id, set: { name: entity.name } });
  }
}

// ─── Notification helpers ─────────────────────────────────────────────────────

export async function createNotification(data: Omit<Notification, 'id' | 'createdAt' | 'isRead'>) {
  const db = await getDb();
  if (!db) return;
  await db.insert(notifications).values({ ...data, id: crypto.randomUUID(), isRead: false });
}

export async function listNotifications(userId: string, unreadOnly = false) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(notifications.userId, userId)];
  if (unreadOnly) conditions.push(eq(notifications.isRead, false));
  return db.select().from(notifications).where(and(...conditions)).orderBy(desc(notifications.createdAt)).limit(50);
}

export async function markNotificationRead(id: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(notifications).set({ isRead: true }).where(eq(notifications.id, id));
}

// ─── Event helpers ────────────────────────────────────────────────────────────

async function createDisputeEvent(data: {
  id: string;
  disputeId: string;
  step: IDRStep;
  previousStep?: IDRStep | null;
  eventType: string;
  description: string;
  performedBy?: string | null;
  performedByName?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(disputeEvents).values({
    ...data,
    previousStep: data.previousStep ?? null,
    performedBy: data.performedBy ?? null,
    performedByName: data.performedByName ?? null,
    metadata: data.metadata ?? null,
  });
}

// ─── Draft dispute helpers ────────────────────────────────────────────────────


export async function upsertDisputeDraft(
  userId: string,
  wizardStep: number,
  formData: Record<string, unknown>,
  qpaResult?: QPAValidationResult,
  lastQpaAmount?: string
): Promise<DisputeDraft> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Embed QPA result inside formData so it survives schema changes
  const enrichedFormData: Record<string, unknown> = {
    ...formData,
    ...(qpaResult !== undefined ? { _qpaResult: qpaResult } : {}),
    ...(lastQpaAmount !== undefined ? { _lastQpaAmount: lastQpaAmount } : {}),
  };
  const now = new Date();
  const existing = await db.select().from(disputeDrafts).where(eq(disputeDrafts.userId, userId)).limit(1);
  if (existing.length > 0) {
    await db.update(disputeDrafts).set({
      currentStep: wizardStep,
      formData: enrichedFormData,
      lastSavedAt: now,
    }).where(eq(disputeDrafts.userId, userId));
    const updated = await db.select().from(disputeDrafts).where(eq(disputeDrafts.userId, userId)).limit(1);
    return updated[0];
  } else {
    const id = crypto.randomUUID();
    await db.insert(disputeDrafts).values({
      id,
      userId,
      currentStep: wizardStep,
      formData: enrichedFormData,
      lastSavedAt: now,
      createdAt: now,
    });
    const inserted = await db.select().from(disputeDrafts).where(eq(disputeDrafts.userId, userId)).limit(1);
    return inserted[0];
  }
}

export async function getDisputeDraft(userId: string): Promise<DisputeDraft | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(disputeDrafts).where(eq(disputeDrafts.userId, userId)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function deleteDisputeDraft(userId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(disputeDrafts).where(eq(disputeDrafts.userId, userId));
}

// ─── QPA validation ───────────────────────────────────────────────────────────
//
// The Qualifying Payment Amount (QPA) is the median contracted rate for a
// service in a geographic area per 45 CFR §149.140.  Because we do not have
// access to a live payer database, we use CMS-published median benchmark
// ranges derived from the 2024 QPA transparency reports.  The engine returns
// a structured result that the UI renders as real-time feedback.

const QPA_BENCHMARKS_BY_CPT: Record<string, { median: number; p25: number; p75: number; description: string }> = {
  // Emergency Medicine
  "99281": { median: 42,   p25: 28,   p75: 62,   description: "Emergency dept visit, minor" },
  "99282": { median: 78,   p25: 55,   p75: 108,  description: "Emergency dept visit, low complexity" },
  "99283": { median: 148,  p25: 105,  p75: 198,  description: "Emergency dept visit, moderate complexity" },
  "99284": { median: 248,  p25: 178,  p75: 328,  description: "Emergency dept visit, high complexity" },
  "99285": { median: 398,  p25: 285,  p75: 528,  description: "Emergency dept visit, highest complexity" },
  // Critical Care
  "99291": { median: 512,  p25: 368,  p75: 695,  description: "Critical care, first 30-74 min" },
  "99292": { median: 258,  p25: 185,  p75: 348,  description: "Critical care, additional 30 min" },
  // Anesthesiology (base units × conversion factor)
  "00100": { median: 285,  p25: 198,  p75: 398,  description: "Anesthesia, head/neck" },
  "00300": { median: 312,  p25: 218,  p75: 428,  description: "Anesthesia, thorax" },
  "00400": { median: 298,  p25: 208,  p75: 412,  description: "Anesthesia, extremities" },
  "00600": { median: 485,  p25: 348,  p75: 658,  description: "Anesthesia, spine/spinal cord" },
  // Radiology
  "70553": { median: 385,  p25: 268,  p75: 512,  description: "MRI brain w/ contrast" },
  "71046": { median: 142,  p25: 98,   p75: 195,  description: "Chest X-ray, 2 views" },
  "74177": { median: 428,  p25: 298,  p75: 578,  description: "CT abdomen/pelvis w/ contrast" },
  "72148": { median: 358,  p25: 248,  p75: 485,  description: "MRI lumbar spine w/o contrast" },
  // Surgery
  "27447": { median: 1842, p25: 1285, p75: 2498, description: "Total knee arthroplasty" },
  "27130": { median: 1985, p25: 1385, p75: 2698, description: "Total hip arthroplasty" },
  "43239": { median: 485,  p25: 338,  p75: 658,  description: "Upper GI endoscopy w/ biopsy" },
  "47562": { median: 1248, p25: 872,  p75: 1698, description: "Laparoscopic cholecystectomy" },
  // Pathology
  "88305": { median: 98,   p25: 68,   p75: 135,  description: "Tissue exam, surgical pathology" },
  "88307": { median: 198,  p25: 138,  p75: 268,  description: "Tissue exam, complex" },
  // Ambulance
  "A0427": { median: 748,  p25: 525,  p75: 1025, description: "ALS emergency transport, ground" },
  "A0431": { median: 12500,p25: 8750, p75: 17500, description: "Air ambulance transport, fixed wing" },
  "A0436": { median: 14500,p25: 10150,p75: 19500, description: "Air ambulance transport, rotary wing" },
  // Neonatology
  "99468": { median: 1285, p25: 898,  p75: 1748, description: "Initial neonatal critical care" },
  "99469": { median: 648,  p25: 452,  p75: 878,  description: "Subsequent neonatal critical care" },
  // Hospitalist
  "99221": { median: 198,  p25: 138,  p75: 268,  description: "Initial hospital care, low complexity" },
  "99222": { median: 298,  p25: 208,  p75: 405,  description: "Initial hospital care, moderate complexity" },
  "99223": { median: 428,  p25: 298,  p75: 578,  description: "Initial hospital care, high complexity" },
  "99231": { median: 98,   p25: 68,   p75: 135,  description: "Subsequent hospital care, low" },
  "99232": { median: 148,  p25: 103,  p75: 198,  description: "Subsequent hospital care, moderate" },
  "99233": { median: 218,  p25: 152,  p75: 295,  description: "Subsequent hospital care, high" },
};

// State-level cost-of-living adjustment factors (relative to national median)
const STATE_COLA_FACTORS: Record<string, number> = {
  AK: 1.35, HI: 1.30, CA: 1.25, NY: 1.22, MA: 1.18, CT: 1.15, NJ: 1.14,
  WA: 1.12, CO: 1.08, MD: 1.07, VA: 1.05, IL: 1.04, OR: 1.03, MN: 1.02,
  NH: 1.01, DC: 1.28, TX: 0.98, FL: 0.97, GA: 0.95, NC: 0.94, TN: 0.93,
  AZ: 0.96, OH: 0.92, MI: 0.91, PA: 0.99, WI: 0.90, IN: 0.89, MO: 0.88,
  KY: 0.87, AL: 0.86, MS: 0.85, AR: 0.84, WV: 0.83, SD: 0.86, ND: 0.87,
  MT: 0.88, WY: 0.89, ID: 0.90, NM: 0.91, NE: 0.89, KS: 0.88, IA: 0.87,
  OK: 0.86, LA: 0.87, SC: 0.88, UT: 0.95, NV: 0.97, DE: 1.02, RI: 1.06,
  VT: 1.05, ME: 0.96,
};

export interface QPAValidationResult {
  qpaEstimate: number;
  withinQpaRange: boolean;
  percentageOfQpa: number;
  recommendation: string;
  severity: "ok" | "warning" | "high" | "extreme";
  cptBenchmarks: Record<string, { median: number; adjusted: number; description: string }>;
  totalBenchmarkMin: number;
  totalBenchmarkMax: number;
  stateAdjustmentFactor: number;
  regulatoryNote: string;
}

export function calculateQPA(
  billedAmount: number,
  cptCodes: string[],
  facilityState: string
): QPAValidationResult {
  const cola = STATE_COLA_FACTORS[facilityState] ?? 1.0;
  const cptBenchmarks: Record<string, { median: number; adjusted: number; description: string }> = {};
  let totalMedian = 0;
  let totalP25 = 0;
  let totalP75 = 0;
  let matchedCodes = 0;

  for (const cpt of cptCodes) {
    const bench = QPA_BENCHMARKS_BY_CPT[cpt];
    if (bench) {
      const adjusted = Math.round(bench.median * cola);
      cptBenchmarks[cpt] = { median: bench.median, adjusted, description: bench.description };
      totalMedian += adjusted;
      totalP25 += Math.round(bench.p25 * cola);
      totalP75 += Math.round(bench.p75 * cola);
      matchedCodes++;
    }
  }

  // If no CPT codes matched, use a rough estimate based on billed amount
  if (matchedCodes === 0) {
    // Typical contracted rate is 30-50% of billed charges for out-of-network
    totalMedian = Math.round(billedAmount * 0.38);
    totalP25 = Math.round(billedAmount * 0.25);
    totalP75 = Math.round(billedAmount * 0.52);
  }

  const percentageOfQpa = totalMedian > 0 ? Math.round((billedAmount / totalMedian) * 100) : 0;
  const withinQpaRange = billedAmount >= totalP25 && billedAmount <= totalP75 * 2.5;

  let severity: QPAValidationResult["severity"] = "ok";
  let recommendation = "";
  let regulatoryNote = "";

  if (percentageOfQpa <= 80) {
    severity = "ok";
    recommendation = "Billed amount is at or below the QPA benchmark. The IDR entity will likely select the QPA as the payment amount.";
    regulatoryNote = "Per 45 CFR §149.510(c)(4)(ii), when the billed amount is at or below the QPA, the IDR entity must select the QPA unless credible information rebuts the presumption.";
  } else if (percentageOfQpa <= 120) {
    severity = "warning";
    recommendation = "Billed amount is within 20% above the QPA. Provide supporting documentation (market data, complexity factors) to justify the higher amount.";
    regulatoryNote = "Per 45 CFR §149.510(c)(4)(iii), you may submit additional information including provider training, market share, and patient acuity to rebut the QPA presumption.";
  } else if (percentageOfQpa <= 250) {
    severity = "high";
    recommendation = `Billed amount is ${percentageOfQpa - 100}% above the QPA. Strong supporting documentation is required. Consider whether the amount reflects unusual complexity, rare expertise, or market conditions.`;
    regulatoryNote = "The IDR entity must consider the QPA as the presumptive correct amount. Amounts significantly above QPA require credible information per 45 CFR §149.510(c)(4)(iv).";
  } else {
    severity = "extreme";
    recommendation = `Billed amount is ${percentageOfQpa - 100}% above the QPA benchmark — this is an extreme outlier. Review whether the correct CPT codes were entered and whether this amount is defensible in arbitration.`;
    regulatoryNote = "Amounts more than 2.5× the QPA face a very high bar in IDR. The No Surprises Act presumes the QPA is correct; extraordinary documentation is required to overcome this presumption.";
  }

  return {
    qpaEstimate: totalMedian,
    withinQpaRange,
    percentageOfQpa,
    recommendation,
    severity,
    cptBenchmarks,
    totalBenchmarkMin: totalP25,
    totalBenchmarkMax: totalP75,
    stateAdjustmentFactor: cola,
    regulatoryNote,
  };
}

// ─── IDR Entity caseload / capacity helpers ───────────────────────────────────

export interface IDREntityCaseload {
  entity: {
    id: string;
    name: string;
    certificationNumber: string | null;
    maxConcurrentCases: number;
    currentActiveCases: number;
    avgResolutionDays: number | null;
    totalCasesHandled: number | null;
    specialties: string[] | null;
    states: string[] | null;
    contactEmail: string | null;
    certificationExpiry: Date | null;
    isActive: boolean | null;
  };
  activeCases: Array<{
    id: string;
    referenceNumber: string;
    currentStep: string;
    status: string;
    initiatingPartyName: string;
    respondingPartyName: string | null;
    serviceType: string;
    billedAmount: string;
    createdAt: Date | null;
    determinationDeadline: Date | null;
    offerSubmissionDeadline: Date | null;
  }>;
  stepBreakdown: Record<string, number>;
  overdueCount: number;
  utilizationPct: number;
  capacityStatus: "available" | "near_capacity" | "at_capacity" | "over_capacity";
}

export async function getIDREntityCaseload(entityId: string): Promise<IDREntityCaseload | null> {
  const db = await getDb();
  if (!db) return null;
  const entityResult = await db.select().from(idrEntities).where(eq(idrEntities.id, entityId)).limit(1);
  if (entityResult.length === 0) return null;
  const entity = entityResult[0];

  // Active cases assigned to this entity
  const activeCases = await db.select({
    id: disputes.id,
    referenceNumber: disputes.referenceNumber,
    currentStep: disputes.currentStep,
    status: disputes.status,
    initiatingPartyName: disputes.initiatingPartyName,
    respondingPartyName: disputes.respondingPartyName,
    serviceType: disputes.serviceType,
    billedAmount: disputes.billedAmount,
    createdAt: disputes.createdAt,
    determinationDeadline: disputes.determinationDeadline,
    offerSubmissionDeadline: disputes.offerSubmissionDeadline,
  }).from(disputes).where(
    and(
      eq(disputes.idrEntityId, entityId),
      sql`${disputes.status} NOT IN ('closed', 'ineligible', 'appealed')`
    )
  ).orderBy(disputes.createdAt);

  // Step breakdown
  const stepBreakdown: Record<string, number> = {};
  for (const c of activeCases) {
    stepBreakdown[c.currentStep] = (stepBreakdown[c.currentStep] ?? 0) + 1;
  }

  // Overdue count
  const now = new Date();
  const overdueCount = activeCases.filter(c =>
    (c.determinationDeadline && c.determinationDeadline < now) ||
    (c.offerSubmissionDeadline && c.offerSubmissionDeadline < now)
  ).length;

  const maxCases = entity.maxConcurrentCases ?? 50;
  const currentCases = activeCases.length;
  const utilizationPct = Math.round((currentCases / maxCases) * 100);

  let capacityStatus: IDREntityCaseload["capacityStatus"] = "available";
  if (utilizationPct >= 100) capacityStatus = "over_capacity";
  else if (utilizationPct >= 90) capacityStatus = "at_capacity";
  else if (utilizationPct >= 75) capacityStatus = "near_capacity";

  // Sync currentActiveCases in DB
  await db.update(idrEntities).set({ currentActiveCases: currentCases }).where(eq(idrEntities.id, entityId));

  return {
    entity: {
      id: entity.id,
      name: entity.name,
      certificationNumber: entity.certificationNumber ?? null,
      maxConcurrentCases: maxCases,
      currentActiveCases: currentCases,
      avgResolutionDays: entity.avgResolutionDays ?? null,
      totalCasesHandled: entity.totalCasesHandled ?? null,
      specialties: entity.specialties ?? null,
      states: entity.states ?? null,
      contactEmail: entity.contactEmail ?? null,
      certificationExpiry: entity.certificationExpiry ?? null,
      isActive: entity.isActive ?? null,
    },
    activeCases,
    stepBreakdown,
    overdueCount,
    utilizationPct,
    capacityStatus,
  };
}

export async function listAllIDREntityCaseloads(): Promise<IDREntityCaseload[]> {
  const db = await getDb();
  if (!db) return [];
  const allEntities = await db.select().from(idrEntities).where(eq(idrEntities.isActive, true));
  const results = await Promise.all(allEntities.map(e => getIDREntityCaseload(e.id)));
  return results.filter((r): r is IDREntityCaseload => r !== null);
}

// ─── CMS Draft helpers ───────────────────────────────────────────────────────────────────

export async function saveCMSDraft(draft: InsertCMSDraft): Promise<CMSDraft> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Upsert: if a draft already exists for this dispute+user, replace it
  const existing = await db
    .select({ id: cmsDrafts.id })
    .from(cmsDrafts)
    .where(and(eq(cmsDrafts.disputeId, draft.disputeId), eq(cmsDrafts.createdBy, draft.createdBy)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(cmsDrafts)
      .set({
        ...draft,
        updatedAt: new Date(),
      })
      .where(eq(cmsDrafts.id, existing[0].id));
    const updated = await db.select().from(cmsDrafts).where(eq(cmsDrafts.id, existing[0].id)).limit(1);
    return updated[0];
  }

  await db.insert(cmsDrafts).values(draft);
  const inserted = await db.select().from(cmsDrafts).where(eq(cmsDrafts.id, draft.id)).limit(1);
  return inserted[0];
}

export async function getCMSDraftByDispute(disputeId: string, userId: string): Promise<CMSDraft | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(cmsDrafts)
    .where(and(eq(cmsDrafts.disputeId, disputeId), eq(cmsDrafts.createdBy, userId)))
    .limit(1);
  return result[0];
}

export async function listCMSDraftsByUser(userId: string): Promise<CMSDraft[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(cmsDrafts)
    .where(eq(cmsDrafts.createdBy, userId))
    .orderBy(desc(cmsDrafts.updatedAt));
}

export async function updateCMSDraftStatus(
  draftId: string,
  status: "draft" | "submitted" | "determined" | "withdrawn",
  userId: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(cmsDrafts)
    .set({
      status,
      submittedAt: status === "submitted" ? new Date() : undefined,
      updatedAt: new Date(),
    })
    .where(and(eq(cmsDrafts.id, draftId), eq(cmsDrafts.createdBy, userId)));
}

// ─── Analytics helpers ────────────────────────────────────────────────────────

export interface DisputeMonthBucket {
  month: string;          // "YYYY-MM"
  total: number;
  open_negotiation: number;
  idr_active: number;
  closed: number;
  ineligible: number;
}

export async function getDisputesByMonth(months = 12): Promise<DisputeMonthBucket[]> {
  const db = await getDb();
  if (!db) return [];

  // Pull all disputes created in the last N months
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);

  const rows = await db
    .select({
      createdAt: disputes.createdAt,
      status: disputes.status,
    })
    .from(disputes)
    .where(sql`${disputes.createdAt} >= ${cutoff}`)
    .orderBy(disputes.createdAt);

  // Group in JS — avoids DB-specific date_trunc syntax differences
  const buckets: Record<string, DisputeMonthBucket> = {};

  for (const row of rows) {
    const d = row.createdAt ? new Date(row.createdAt as unknown as string) : new Date();
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!buckets[key]) {
      buckets[key] = { month: key, total: 0, open_negotiation: 0, idr_active: 0, closed: 0, ineligible: 0 };
    }
    buckets[key].total++;
    const s = row.status as string;
    if (s === "open_negotiation") buckets[key].open_negotiation++;
    else if (["idr_initiated", "idr_entity_selection", "eligibility_review", "offer_submission", "under_arbitration"].includes(s)) buckets[key].idr_active++;
    else if (s === "closed") buckets[key].closed++;
    else if (s === "ineligible") buckets[key].ineligible++;
  }

  // Fill in any missing months in the range so the chart has continuous x-axis
  const result: DisputeMonthBucket[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    result.push(buckets[key] ?? { month: key, total: 0, open_negotiation: 0, idr_active: 0, closed: 0, ineligible: 0 });
  }
  return result;
}

// Admin helper — returns all CMS drafts across all users
export async function listAllCMSDrafts(): Promise<CMSDraft[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(cmsDrafts)
    .orderBy(desc(cmsDrafts.updatedAt));
}


// ─── EMR Connection helpers ───────────────────────────────────────────────────
import {
  emrConnections, EMRConnection, InsertEMRConnection,
  emrSyncLogs, InsertEMRSyncLog,
} from "../drizzle/schema";

export async function createEMRConnection(data: InsertEMRConnection): Promise<EMRConnection> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(emrConnections).values(data).returning();
  return row;
}

export async function listEMRConnections(userId: string): Promise<EMRConnection[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(emrConnections)
    .where(eq(emrConnections.createdBy, userId))
    .orderBy(desc(emrConnections.createdAt));
}

export async function getEMRConnection(id: string): Promise<EMRConnection | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db
    .select()
    .from(emrConnections)
    .where(eq(emrConnections.id, id))
    .limit(1);
  return row;
}

export async function updateEMRConnectionStatus(
  id: string,
  status: "active" | "inactive" | "error" | "testing",
  testResult?: {
    success: boolean;
    message: string;
    confidence?: number;
    resourcesFound?: string[];
  }
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(emrConnections)
    .set({
      status,
      lastTestAt: new Date(),
      lastTestSuccess: testResult?.success ?? null,
      lastTestMessage: testResult?.message ?? null,
      aiConfidenceScore: testResult?.confidence?.toString() ?? null,
      resourcesFound: testResult?.resourcesFound ?? null,
      updatedAt: new Date(),
    })
    .where(eq(emrConnections.id, id));
}

export async function deactivateEMRConnection(id: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(emrConnections)
    .set({ status: "inactive", updatedAt: new Date() })
    .where(eq(emrConnections.id, id));
}

export async function deleteEMRConnection(id: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(emrConnections).where(eq(emrConnections.id, id));
}

// ─── EMR Sync Log helpers ─────────────────────────────────────────────────────

export async function createEMRSyncLog(entry: InsertEMRSyncLog): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(emrSyncLogs).values(entry);
}

export async function listEMRSyncLogs(connectionId: string, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(emrSyncLogs)
    .where(eq(emrSyncLogs.connectionId, connectionId))
    .orderBy(desc(emrSyncLogs.createdAt))
    .limit(limit);
}

// ── Dispute Templates ─────────────────────────────────────────────────────────
export async function createDisputeTemplate(template: InsertDisputeTemplate): Promise<DisputeTemplate> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(disputeTemplates).values(template);
  const result = await db.select().from(disputeTemplates).where(eq(disputeTemplates.id, template.id!)).limit(1);
  return result[0];
}

export async function listDisputeTemplates(userId: string): Promise<DisputeTemplate[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(disputeTemplates)
    .where(eq(disputeTemplates.createdBy, userId))
    .orderBy(desc(disputeTemplates.updatedAt));
}

export async function getDisputeTemplateById(id: string): Promise<DisputeTemplate | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(disputeTemplates).where(eq(disputeTemplates.id, id)).limit(1);
  return result[0];
}

export async function updateDisputeTemplate(id: string, updates: Partial<InsertDisputeTemplate>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(disputeTemplates).set({ ...updates, updatedAt: new Date() }).where(eq(disputeTemplates.id, id));
}

export async function deleteDisputeTemplate(id: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(disputeTemplates).where(eq(disputeTemplates.id, id));
}

export async function incrementTemplateUsage(id: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(disputeTemplates)
    .set({ usageCount: sql`${disputeTemplates.usageCount} + 1`, updatedAt: new Date() })
    .where(eq(disputeTemplates.id, id));
}

// ─── User Profiles ────────────────────────────────────────────────────────────
export async function getUserProfile(userId: string): Promise<UserProfile | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(userProfiles).where(eq(userProfiles.id, userId)).limit(1);
  return rows[0];
}

export async function upsertUserProfile(profile: InsertUserProfile): Promise<UserProfile | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const now = new Date();
  await db.insert(userProfiles)
    .values({ ...profile, updatedAt: now })
    .onConflictDoUpdate({
      target: userProfiles.id,
      set: {
        orgName: profile.orgName,
        orgType: profile.orgType,
        stakeholderRole: profile.stakeholderRole,
        npi: profile.npi,
        taxId: profile.taxId,
        phone: profile.phone,
        preferredContact: profile.preferredContact,
        onboardingCompleted: profile.onboardingCompleted,
        onboardingCompletedAt: profile.onboardingCompletedAt,
        updatedAt: now,
      },
    });
  const rows = await db.select().from(userProfiles).where(eq(userProfiles.id, profile.id)).limit(1);
  return rows[0];
}

export async function markOnboardingComplete(userId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(userProfiles)
    .values({ id: userId, onboardingCompleted: true, onboardingCompletedAt: new Date() })
    .onConflictDoUpdate({
      target: userProfiles.id,
      set: { onboardingCompleted: true, onboardingCompletedAt: new Date(), updatedAt: new Date() },
    });
}

// ─── Marketing Leads ──────────────────────────────────────────────────────────
export async function createMarketingLead(lead: Omit<InsertMarketingLead, "id">): Promise<MarketingLead | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const id = `lead_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  await db.insert(marketingLeads).values({ ...lead, id });
  const rows = await db.select().from(marketingLeads).where(eq(marketingLeads.id, id)).limit(1);
  return rows[0];
}

export async function listMarketingLeads(opts?: { status?: string; limit?: number; offset?: number }): Promise<MarketingLead[]> {
  const db = await getDb();
  if (!db) return [];
  let q = db.select().from(marketingLeads).$dynamic();
  if (opts?.status) {
    q = q.where(eq(marketingLeads.status, opts.status as MarketingLead["status"]));
  }
  return q.orderBy(desc(marketingLeads.createdAt)).limit(opts?.limit ?? 100).offset(opts?.offset ?? 0);
}

export async function updateLeadStatus(id: string, status: MarketingLead["status"], notes?: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(marketingLeads)
    .set({ status, notes: notes ?? undefined, updatedAt: new Date() })
    .where(eq(marketingLeads.id, id));
}

export async function getLeadByEmail(email: string): Promise<MarketingLead | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(marketingLeads).where(eq(marketingLeads.email, email)).limit(1);
  return rows[0];
}

// ─── Audit Log Helpers ────────────────────────────────────────────────────────
export async function createAuditEntry(entry: Omit<InsertAuditLogEntry, "id">): Promise<AuditLogEntry> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const id = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  await db.insert(auditLog).values({ ...entry, id });
  const rows = await db.select().from(auditLog).where(eq(auditLog.id, id)).limit(1);
  return rows[0];
}
export async function listAuditEntries(opts: {
  entityId?: string;
  entityType?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}): Promise<AuditLogEntry[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (opts.entityId) conditions.push(eq(auditLog.entityId, opts.entityId));
  if (opts.entityType) conditions.push(eq(auditLog.entityType, opts.entityType));
  if (opts.userId) conditions.push(eq(auditLog.userId, opts.userId));
  let q = db.select().from(auditLog).$dynamic();
  if (conditions.length > 0) q = q.where(and(...conditions));
  return q.orderBy(desc(auditLog.createdAt)).limit(opts.limit ?? 100).offset(opts.offset ?? 0);
}

// ─── Webhooks Helpers ─────────────────────────────────────────────────────────
export async function createWebhook(webhook: Omit<InsertWebhook, "id">): Promise<Webhook> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const id = `wh_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  await db.insert(webhooks).values({ ...webhook, id });
  const rows = await db.select().from(webhooks).where(eq(webhooks.id, id)).limit(1);
  return rows[0];
}
export async function listWebhooks(userId: string): Promise<Webhook[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(webhooks).where(eq(webhooks.userId, userId)).orderBy(desc(webhooks.createdAt));
}
export async function updateWebhook(id: string, data: Partial<InsertWebhook>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(webhooks).set({ ...data, updatedAt: new Date() }).where(eq(webhooks.id, id));
}
export async function deleteWebhook(id: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(webhooks).where(eq(webhooks.id, id));
}

// ─── Outcome Predictions Helpers ──────────────────────────────────────────────
export async function upsertOutcomePrediction(pred: Omit<InsertOutcomePrediction, "id"> & { disputeId: string }): Promise<OutcomePrediction> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Delete existing prediction for this dispute
  await db.delete(outcomePredictions).where(eq(outcomePredictions.disputeId, pred.disputeId));
  const id = `pred_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  await db.insert(outcomePredictions).values({ ...pred, id });
  const rows = await db.select().from(outcomePredictions).where(eq(outcomePredictions.id, id)).limit(1);
  return rows[0];
}
export async function getOutcomePrediction(disputeId: string): Promise<OutcomePrediction | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(outcomePredictions)
    .where(eq(outcomePredictions.disputeId, disputeId))
    .orderBy(desc(outcomePredictions.createdAt))
    .limit(1);
  return rows[0];
}

// ─── Document Analysis Helpers ────────────────────────────────────────────────
export async function createDocumentAnalysis(analysis: Omit<InsertDocumentAnalysis, "id">): Promise<DocumentAnalysis> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const id = `docai_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  await db.insert(documentAnalyses).values({ ...analysis, id });
  const rows = await db.select().from(documentAnalyses).where(eq(documentAnalyses.id, id)).limit(1);
  return rows[0];
}
export async function updateDocumentAnalysis(id: string, data: Partial<InsertDocumentAnalysis>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(documentAnalyses).set({ ...data, updatedAt: new Date() }).where(eq(documentAnalyses.id, id));
}
export async function getDocumentAnalysis(id: string): Promise<DocumentAnalysis | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(documentAnalyses).where(eq(documentAnalyses.id, id)).limit(1);
  return rows[0];
}
export async function listDocumentAnalyses(opts: { userId?: string; disputeId?: string; limit?: number }): Promise<DocumentAnalysis[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (opts.userId) conditions.push(eq(documentAnalyses.userId, opts.userId));
  if (opts.disputeId) conditions.push(eq(documentAnalyses.disputeId, opts.disputeId));
  let q = db.select().from(documentAnalyses).$dynamic();
  if (conditions.length > 0) q = q.where(and(...conditions));
  return q.orderBy(desc(documentAnalyses.createdAt)).limit(opts.limit ?? 50);
}
