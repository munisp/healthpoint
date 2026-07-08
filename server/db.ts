import { eq, desc, and, or, like, count, sql, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users,
  disputes, InsertDispute, Dispute,
  disputeEvents, DisputeEvent,
  disputeOffers, DisputeOffer,
  disputeDocuments, DisputeDocument,
  idrEntities, IDREntity,
  notifications, Notification,
  IDR_STEP, IDRStep, DISPUTE_STATUS, DisputeStatus,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
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
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
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
  search?: string;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };
  const { limit = 20, offset = 0, status, search } = opts;
  const conditions = [];
  if (status) conditions.push(eq(disputes.status, status));
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

export async function getDashboardStats(userId: string) {
  const db = await getDb();
  if (!db) return null;
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [
    totalResult,
    openResult,
    idrResult,
    closedResult,
    overdueResult,
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
    db.select().from(disputes).orderBy(desc(disputes.createdAt)).limit(5),
  ]);
  // Unread notifications
  const notifResult = await db.select({ count: count() }).from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
  return {
    total: totalResult[0]?.count ?? 0,
    openNegotiation: openResult[0]?.count ?? 0,
    inIDR: idrResult[0]?.count ?? 0,
    closedThisMonth: closedResult[0]?.count ?? 0,
    overdue: overdueResult[0]?.count ?? 0,
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
    await db.insert(idrEntities).values(entity).onDuplicateKeyUpdate({ set: { name: entity.name } });
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
