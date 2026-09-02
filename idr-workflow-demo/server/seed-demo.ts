/**
 * Server-side demo data seeder — runs inside the Node.js process using the
 * live DATABASE_URL so it works in both local dev and production.
 *
 * Called from the admin.reseedDemoData tRPC procedure.
 */
import { getDb, addBusinessDays } from "./db";
import {
  disputes, disputeEvents, disputeOffers, idrEntities, notifications,
  IDR_STEP, IDRStep, DisputeStatus,
} from "../drizzle/schema";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const daysFromNow = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

// ─── Static data ──────────────────────────────────────────────────────────────
const STATUS_FOR_STEP: Record<string, DisputeStatus> = {
  STEP_01_OPEN_NEGOTIATION_INITIATED: "open_negotiation",
  STEP_02_OPEN_NEGOTIATION_PERIOD:    "open_negotiation",
  STEP_03_OPEN_NEGOTIATION_FAILED:    "idr_initiated",
  STEP_04_IDR_INITIATED:              "idr_initiated",
  STEP_05_IDR_NOTICE_SENT:            "idr_initiated",
  STEP_06_IDR_ENTITY_SELECTION:       "idr_entity_selection",
  STEP_07_IDR_ENTITY_SELECTED:        "idr_entity_selection",
  STEP_08_ELIGIBILITY_REVIEW:         "eligibility_review",
  STEP_09_OFFER_SUBMISSION:           "offer_submission",
  STEP_10_QPA_DISCLOSURE:             "offer_submission",
  STEP_11_ADDITIONAL_INFORMATION:     "under_arbitration",
  STEP_12_ARBITRATION_REVIEW:         "under_arbitration",
  STEP_13_DETERMINATION_ISSUED:       "determination_issued",
  STEP_14_PAYMENT_DETERMINATION:      "payment_pending",
  STEP_15_PAYMENT_MADE:               "payment_pending",
  STEP_16_ADMINISTRATIVE_FEE_PAID:    "payment_pending",
  STEP_17_DISPUTE_CLOSED:             "closed",
  STEP_18_APPEAL_FILED:               "appealed",
  STEP_19_APPEAL_RESOLVED:            "appealed",
};

const QPA_RATIO: Record<string, number> = {
  emergency_medicine: 0.62, anesthesiology: 0.58, radiology: 0.65,
  pathology: 0.70, neonatology: 0.55, assistant_surgeon: 0.60,
  hospitalist: 0.68, intensivist: 0.57, air_ambulance: 0.48,
  ground_ambulance: 0.66, other: 0.63,
};

const BILLED_RANGES: Record<string, [number, number]> = {
  emergency_medicine: [1200, 8500], anesthesiology: [2500, 18000],
  radiology: [800, 6500], pathology: [400, 3200], neonatology: [8000, 45000],
  assistant_surgeon: [3500, 22000], hospitalist: [900, 7500],
  intensivist: [4500, 28000], air_ambulance: [35000, 120000],
  ground_ambulance: [2800, 9500], other: [500, 5000],
};

const CPT_SETS: Record<string, string[]> = {
  emergency_medicine: ["99285","99284","99283"], anesthesiology: ["00100","00300","00400"],
  radiology: ["70553","74177","72148"], pathology: ["88305","88307"],
  neonatology: ["99468","99469"], assistant_surgeon: ["27447","27130","43239"],
  hospitalist: ["99222","99223","99232"], intensivist: ["99291","99292"],
  air_ambulance: ["A0431","A0436"], ground_ambulance: ["A0427"], other: ["99285","99222"],
};

const PROVIDERS = [
  { name: "Northeast Emergency Physicians LLC", npi: "1234567890" },
  { name: "Pacific Anesthesia Group",           npi: "2345678901" },
  { name: "Midwest Radiology Associates",       npi: "3456789012" },
  { name: "Southern Pathology Consultants",     npi: "4567890123" },
  { name: "Mountain West Hospitalists",         npi: "5678901234" },
  { name: "Great Lakes Neonatology Group",      npi: "6789012345" },
  { name: "Coastal Air Medical Services",       npi: "7890123456" },
  { name: "Capital Region Intensivists",        npi: "8901234567" },
  { name: "Sunbelt Surgical Assistants",        npi: "9012345678" },
  { name: "Rocky Mountain Emergency Medicine",  npi: "0123456789" },
];

const PAYERS = [
  "BlueCross BlueShield of Texas", "UnitedHealthcare Choice Plus",
  "Aetna Better Health", "Cigna Healthcare of California",
  "Humana Gold Plus HMO", "Anthem Blue Cross", "Centene Corporation",
];

const STATES = ["CA","TX","FL","NY","PA","IL","OH","GA","NC","MI","NJ","WA","AZ","MA","TN"];

const IDR_ENTITIES_DATA = [
  { id: crypto.randomUUID(), name: "American Arbitration Association Healthcare", certificationNumber: "IDR-CERT-001", specialties: ["emergency_medicine","anesthesiology","radiology"], states: ["CA","TX","FL","NY","IL","PA","OH","GA"], contactEmail: "healthcare@adr.org", contactPhone: "1-800-778-7879", website: "https://www.adr.org", maxConcurrentCases: 50, avgResolutionDays: 28, totalCasesHandled: 1247, certificationExpiry: daysFromNow(365) },
  { id: crypto.randomUUID(), name: "JAMS Healthcare Dispute Resolution",         certificationNumber: "IDR-CERT-002", specialties: ["assistant_surgeon","hospitalist","neonatology","intensivist"], states: ["CA","NY","TX","FL","MA","WA","CO","OR"], contactEmail: "idr@jamsadr.com", contactPhone: "1-800-352-5267", website: "https://www.jamsadr.com", maxConcurrentCases: 40, avgResolutionDays: 25, totalCasesHandled: 892, certificationExpiry: daysFromNow(280) },
  { id: crypto.randomUUID(), name: "Medscape Arbitration Services",              certificationNumber: "IDR-CERT-003", specialties: ["air_ambulance","ground_ambulance","emergency_medicine"], states: ["TX","OK","KS","NE","MO","AR","LA","MS"], contactEmail: "idr@medscapearb.com", contactPhone: "1-888-633-7272", website: "https://www.medscapearb.com", maxConcurrentCases: 30, avgResolutionDays: 32, totalCasesHandled: 445, certificationExpiry: daysFromNow(180) },
  { id: crypto.randomUUID(), name: "National Arbitration Forum Healthcare",      certificationNumber: "IDR-CERT-004", specialties: ["neonatology","radiology","anesthesiology"], states: ["MN","WI","IA","ND","SD","NE","KS","MO"], contactEmail: "healthcare@nafresolution.com", contactPhone: "1-800-474-2371", website: "https://www.nafresolution.com", maxConcurrentCases: 35, avgResolutionDays: 30, totalCasesHandled: 445, certificationExpiry: daysFromNow(420) },
  { id: crypto.randomUUID(), name: "Capitol Dispute Resolution Services",        certificationNumber: "IDR-CERT-005", specialties: ["assistant_surgeon","hospitalist","intensivist"], states: ["DC","MD","VA","DE","WV","PA","NJ"], contactEmail: "idr@capitoldr.com", contactPhone: "1-301-590-6500", website: "https://www.capitoldr.com", maxConcurrentCases: 25, avgResolutionDays: 27, totalCasesHandled: 318, certificationExpiry: daysFromNow(330) },
];

// 40 scenarios — 12 fully-closed for analytics charts
const SCENARIOS: Array<{ step: IDRStep; daysOld: number; svc: string }> = [
  { step: "STEP_01_OPEN_NEGOTIATION_INITIATED", daysOld: 1,   svc: "emergency_medicine" },
  { step: "STEP_01_OPEN_NEGOTIATION_INITIATED", daysOld: 2,   svc: "anesthesiology" },
  { step: "STEP_02_OPEN_NEGOTIATION_PERIOD",    daysOld: 4,   svc: "radiology" },
  { step: "STEP_02_OPEN_NEGOTIATION_PERIOD",    daysOld: 5,   svc: "pathology" },
  { step: "STEP_03_OPEN_NEGOTIATION_FAILED",    daysOld: 7,   svc: "neonatology" },
  { step: "STEP_04_IDR_INITIATED",              daysOld: 8,   svc: "hospitalist" },
  { step: "STEP_05_IDR_NOTICE_SENT",            daysOld: 9,   svc: "emergency_medicine" },
  { step: "STEP_06_IDR_ENTITY_SELECTION",       daysOld: 10,  svc: "intensivist" },
  { step: "STEP_06_IDR_ENTITY_SELECTION",       daysOld: 11,  svc: "assistant_surgeon" },
  { step: "STEP_07_IDR_ENTITY_SELECTED",        daysOld: 12,  svc: "anesthesiology" },
  { step: "STEP_08_ELIGIBILITY_REVIEW",         daysOld: 13,  svc: "radiology" },
  { step: "STEP_08_ELIGIBILITY_REVIEW",         daysOld: 14,  svc: "emergency_medicine" },
  { step: "STEP_09_OFFER_SUBMISSION",           daysOld: 15,  svc: "ground_ambulance" },
  { step: "STEP_09_OFFER_SUBMISSION",           daysOld: 16,  svc: "pathology" },
  { step: "STEP_09_OFFER_SUBMISSION",           daysOld: 17,  svc: "neonatology" },
  { step: "STEP_10_QPA_DISCLOSURE",             daysOld: 18,  svc: "air_ambulance" },
  { step: "STEP_11_ADDITIONAL_INFORMATION",     daysOld: 19,  svc: "hospitalist" },
  { step: "STEP_11_ADDITIONAL_INFORMATION",     daysOld: 20,  svc: "intensivist" },
  { step: "STEP_12_ARBITRATION_REVIEW",         daysOld: 22,  svc: "emergency_medicine" },
  { step: "STEP_12_ARBITRATION_REVIEW",         daysOld: 23,  svc: "anesthesiology" },
  { step: "STEP_13_DETERMINATION_ISSUED",       daysOld: 25,  svc: "assistant_surgeon" },
  { step: "STEP_13_DETERMINATION_ISSUED",       daysOld: 26,  svc: "radiology" },
  { step: "STEP_14_PAYMENT_DETERMINATION",      daysOld: 28,  svc: "emergency_medicine" },
  { step: "STEP_15_PAYMENT_MADE",               daysOld: 30,  svc: "neonatology" },
  { step: "STEP_16_ADMINISTRATIVE_FEE_PAID",    daysOld: 32,  svc: "anesthesiology" },
  // 12 fully-closed disputes for analytics charts
  { step: "STEP_17_DISPUTE_CLOSED",             daysOld: 45,  svc: "radiology" },
  { step: "STEP_17_DISPUTE_CLOSED",             daysOld: 50,  svc: "emergency_medicine" },
  { step: "STEP_17_DISPUTE_CLOSED",             daysOld: 55,  svc: "anesthesiology" },
  { step: "STEP_17_DISPUTE_CLOSED",             daysOld: 60,  svc: "neonatology" },
  { step: "STEP_17_DISPUTE_CLOSED",             daysOld: 65,  svc: "air_ambulance" },
  { step: "STEP_17_DISPUTE_CLOSED",             daysOld: 70,  svc: "hospitalist" },
  { step: "STEP_17_DISPUTE_CLOSED",             daysOld: 75,  svc: "assistant_surgeon" },
  { step: "STEP_17_DISPUTE_CLOSED",             daysOld: 80,  svc: "intensivist" },
  { step: "STEP_17_DISPUTE_CLOSED",             daysOld: 85,  svc: "emergency_medicine" },
  { step: "STEP_17_DISPUTE_CLOSED",             daysOld: 90,  svc: "anesthesiology" },
  { step: "STEP_17_DISPUTE_CLOSED",             daysOld: 95,  svc: "radiology" },
  { step: "STEP_17_DISPUTE_CLOSED",             daysOld: 100, svc: "neonatology" },
  // Appeals
  { step: "STEP_18_APPEAL_FILED",               daysOld: 38,  svc: "air_ambulance" },
  { step: "STEP_19_APPEAL_RESOLVED",            daysOld: 52,  svc: "hospitalist" },
];

export async function runDemoSeed(adminUserId: string): Promise<{
  disputes: number; entities: number; events: number; offers: number; notifications: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { sql } = await import("drizzle-orm");

  // Clear existing demo data (preserve real users)
  await db.execute(sql`TRUNCATE notifications, dispute_documents, dispute_offers, dispute_events, dispute_drafts, disputes, idr_entities RESTART IDENTITY CASCADE`);

  // ── IDR Entities ───────────────────────────────────────────────────────────
  for (const e of IDR_ENTITIES_DATA) {
    await db.insert(idrEntities).values({
      id: e.id,
      name: e.name,
      certificationNumber: e.certificationNumber,
      certificationExpiry: e.certificationExpiry,
      specialties: e.specialties,
      states: e.states,
      contactEmail: e.contactEmail,
      contactPhone: e.contactPhone,
      website: e.website,
      maxConcurrentCases: e.maxConcurrentCases,
      currentActiveCases: 0,
      avgResolutionDays: e.avgResolutionDays,
      totalCasesHandled: e.totalCasesHandled,
      isActive: true,
    });
  }

  // ── Disputes ───────────────────────────────────────────────────────────────
  const seeded: Array<{
    id: string; ref: string; billed: string; qpa: string | null;
    svc: string; stepIdx: number; status: DisputeStatus; createdAt: Date;
    entity: (typeof IDR_ENTITIES_DATA)[0] | null; providerWins: boolean | null;
  }> = [];

  let refIdx = 1001;
  for (let i = 0; i < SCENARIOS.length; i++) {
    const sc = SCENARIOS[i];
    const provider = pick(PROVIDERS);
    const payerName = pick(PAYERS);
    const state = pick(STATES);
    const svc = sc.svc;
    const [min, max] = BILLED_RANGES[svc] ?? [500, 5000];
    const billed = (randInt(min * 100, max * 100) / 100).toFixed(2);
    const createdAt = daysAgo(sc.daysOld);
    const stepIdx = IDR_STEP.indexOf(sc.step);
    const status = STATUS_FOR_STEP[sc.step];
    const entityAssigned = stepIdx >= IDR_STEP.indexOf("STEP_07_IDR_ENTITY_SELECTED");
    const entity = entityAssigned ? IDR_ENTITIES_DATA[i % IDR_ENTITIES_DATA.length] : null;
    const id = crypto.randomUUID();
    const ref = `NSA-IDR-2025-${String(refIdx++).padStart(6, "0")}`;

    // QPA — disclosed at Step 10+
    const hasQpa = stepIdx >= IDR_STEP.indexOf("STEP_10_QPA_DISCLOSURE");
    const qpaRatio = QPA_RATIO[svc] ?? 0.63;
    const qpa = hasQpa
      ? (parseFloat(billed) * (qpaRatio + (Math.random() - 0.5) * 0.08)).toFixed(2)
      : null;

    // Determination — IDR entity picks offer closest to QPA
    const hasDetermination = stepIdx >= IDR_STEP.indexOf("STEP_13_DETERMINATION_ISSUED");
    const providerWins = hasDetermination ? Math.random() < 0.60 : null;
    const detAmount = hasDetermination
      ? (qpa
          ? (parseFloat(qpa) * ((providerWins ? 1.05 + Math.random() * 0.25 : 0.80 + Math.random() * 0.15))).toFixed(2)
          : (parseFloat(billed) * (0.45 + Math.random() * 0.35)).toFixed(2))
      : null;

    await db.insert(disputes).values({
      id,
      referenceNumber: ref,
      status,
      currentStep: sc.step,
      initiatingPartyType: "provider",
      initiatingPartyId: provider.npi,
      initiatingPartyName: provider.name,
      initiatingPartyNpi: provider.npi,
      respondingPartyType: "payer",
      respondingPartyName: payerName,
      serviceType: svc as any,
      serviceDate: daysAgo(sc.daysOld + randInt(5, 30)),
      patientState: state,
      facilityState: state,
      cptCodes: CPT_SETS[svc] ?? CPT_SETS.other,
      billedAmount: billed,
      qpaAmount: qpa,
      idrEntityId: entity?.id ?? null,
      idrEntityName: entity?.name ?? null,
      openNegotiationDeadline: addBusinessDays(createdAt, 30),
      idrInitiationDeadline: addBusinessDays(createdAt, 4),
      entitySelectionDeadline: addBusinessDays(createdAt, 6),
      eligibilityDeadline: addBusinessDays(createdAt, 3),
      offerSubmissionDeadline: addBusinessDays(createdAt, 10),
      additionalInfoDeadline: addBusinessDays(createdAt, 18),
      determinationDeadline: addBusinessDays(createdAt, 30),
      paymentDeadline: addBusinessDays(createdAt, 35),
      determinationAmount: detAmount,
      determinationBasis: hasDetermination
        ? "IDR entity selected offer closest to QPA per 45 CFR §149.510(c)(4)"
        : null,
      isEligible: stepIdx >= IDR_STEP.indexOf("STEP_08_ELIGIBILITY_REVIEW") ? true : null,
      createdBy: adminUserId,
      createdAt,
      updatedAt: createdAt,
    });

    seeded.push({ id, ref, billed, qpa, svc, stepIdx, status, createdAt, entity, providerWins });
  }

  // ── Timeline events ────────────────────────────────────────────────────────
  let evtCount = 0;
  for (const { id, stepIdx, createdAt } of seeded) {
    for (let s = 0; s <= stepIdx; s++) {
      const step = IDR_STEP[s];
      const evtDate = new Date(createdAt.getTime() + s * 2 * 24 * 60 * 60 * 1000);
      await db.insert(disputeEvents).values({
        id: crypto.randomUUID(),
        disputeId: id,
        eventType: "step_advanced",
        step,
        description: `Dispute advanced to ${step.replace(/STEP_\d+_/, "").replace(/_/g, " ").toLowerCase()} stage`,
        performedBy: adminUserId,
        performedByName: "System",
        createdAt: evtDate,
      });
      evtCount++;
    }
  }

  // ── Offers ─────────────────────────────────────────────────────────────────
  let offerCount = 0;
  const offerStartIdx = IDR_STEP.indexOf("STEP_09_OFFER_SUBMISSION");
  for (const { id, billed, qpa, stepIdx, providerWins } of seeded) {
    if (stepIdx < offerStartIdx) continue;
    const q = qpa ? parseFloat(qpa) : parseFloat(billed) * 0.63;
    const provOffer = (q * (1.08 + Math.random() * 0.18)).toFixed(2);
    const payerOffer = (q * (0.82 + Math.random() * 0.14)).toFixed(2);
    const hasDet = stepIdx >= IDR_STEP.indexOf("STEP_13_DETERMINATION_ISSUED");
    const provAccepted = hasDet && providerWins === true;
    const payerAccepted = hasDet && providerWins === false;

    await db.insert(disputeOffers).values({
      id: crypto.randomUUID(),
      disputeId: id,
      offerType: "initiating_party",
      amount: provOffer,
      rationale: "Provider offer based on market rates, complexity of care, and regional benchmark data.",
      isAccepted: provAccepted,
      submittedAt: new Date(),
    });

    if (stepIdx >= IDR_STEP.indexOf("STEP_10_QPA_DISCLOSURE")) {
      await db.insert(disputeOffers).values({
        id: crypto.randomUUID(),
        disputeId: id,
        offerType: "responding_party",
        amount: payerOffer,
        rationale: "Payer offer based on the Qualifying Payment Amount (QPA) per 45 CFR §149.510.",
        isAccepted: payerAccepted,
        submittedAt: new Date(),
      });
    }
    offerCount++;
  }

  // ── Notifications ──────────────────────────────────────────────────────────
  const firstDisputeId = seeded[0]?.id;
  const notifData = [
    { type: "deadline_warning", title: "Offer Submission Deadline Approaching",  message: "You have 2 business days remaining to submit your final offer for dispute NSA-IDR-2025-001013.", priority: "high",   daysOld: 0 },
    { type: "step_advanced",    title: "Dispute Advanced to Arbitration Review", message: "Dispute NSA-IDR-2025-001019 has been advanced to the arbitration review stage.",                  priority: "high",   daysOld: 0 },
    { type: "determination",    title: "Determination Issued",                   message: "The IDR entity has issued a determination for NSA-IDR-2025-001021. Payment: $4,285.00.",           priority: "high",   daysOld: 1 },
    { type: "new_dispute",      title: "New Dispute Initiated",                  message: "A new IDR dispute NSA-IDR-2025-001001 has been initiated by Northeast Emergency Physicians LLC.",  priority: "medium", daysOld: 1 },
    { type: "deadline_warning", title: "Eligibility Review Deadline",            message: "Dispute NSA-IDR-2025-001011 must complete eligibility review within 1 business day.",              priority: "high",   daysOld: 2 },
  ];
  let notifCount = 0;
  if (firstDisputeId) {
    for (let i = 0; i < notifData.length; i++) {
      const n = notifData[i];
      const createdAt = daysAgo(n.daysOld);
      await db.insert(notifications).values({
        id: crypto.randomUUID(),
        disputeId: firstDisputeId,
        userId: adminUserId,
        notificationType: n.type as any,
        title: n.title,
        message: n.message,
        isRead: i > 2,
        createdAt,
      });
      notifCount++;
    }
  }

  // ── Update entity active case counts ──────────────────────────────────────
  const { eq: eqOp, and: andOp, notInArray } = await import("drizzle-orm");
  for (const e of IDR_ENTITIES_DATA) {
    const rows = await db.select({ id: disputes.id }).from(disputes)
      .where(andOp(
        eqOp(disputes.idrEntityId, e.id),
        notInArray(disputes.status, ["closed", "appealed", "ineligible"] as any),
      ));
    await db.update(idrEntities)
      .set({ currentActiveCases: rows.length })
      .where(eqOp(idrEntities.id, e.id));
  }

  return {
    disputes: seeded.length,
    entities: IDR_ENTITIES_DATA.length,
    events: evtCount,
    offers: offerCount,
    notifications: notifCount,
  };
}
