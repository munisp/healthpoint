/**
 * Seed script for the IDR Workflow Demo
 * Populates: 5 IDR entities, 28 disputes at various workflow stages,
 *            timeline events, offers, and notifications.
 *
 * Run: node scripts/seed.mjs
 */
import postgres from "postgres";
import { randomUUID } from "crypto";

const DB_URL = "postgresql://idr_user:idr_pass123@localhost:5432/idr_demo";
const sql = postgres(DB_URL);

// ─── Helpers ──────────────────────────────────────────────────────────────────
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

const FEDERAL_HOLIDAYS = new Set([
  "2024-01-01","2024-01-15","2024-02-19","2024-05-27","2024-06-19",
  "2024-07-04","2024-09-02","2024-10-14","2024-11-11","2024-11-28",
  "2024-12-25","2025-01-01","2025-01-20","2025-02-17","2025-05-26",
  "2025-06-19","2025-07-04","2025-09-01","2025-10-13","2025-11-11",
  "2025-11-27","2025-12-25","2026-01-01","2026-01-19","2026-02-16",
]);
function addBizDays(date, days) {
  let d = new Date(date); let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6 && !FEDERAL_HOLIDAYS.has(iso)) added++;
  }
  return d;
}

// ─── Enum values (must match DB exactly) ─────────────────────────────────────
const IDR_STEPS = [
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
];

const STATUS_FOR_STEP = {
  "STEP_01_OPEN_NEGOTIATION_INITIATED": "open_negotiation",
  "STEP_02_OPEN_NEGOTIATION_PERIOD":    "open_negotiation",
  "STEP_03_OPEN_NEGOTIATION_FAILED":    "idr_initiated",
  "STEP_04_IDR_INITIATED":              "idr_initiated",
  "STEP_05_IDR_NOTICE_SENT":            "idr_initiated",
  "STEP_06_IDR_ENTITY_SELECTION":       "idr_entity_selection",
  "STEP_07_IDR_ENTITY_SELECTED":        "idr_entity_selection",
  "STEP_08_ELIGIBILITY_REVIEW":         "eligibility_review",
  "STEP_09_OFFER_SUBMISSION":           "offer_submission",
  "STEP_10_QPA_DISCLOSURE":             "offer_submission",
  "STEP_11_ADDITIONAL_INFORMATION":     "under_arbitration",
  "STEP_12_ARBITRATION_REVIEW":         "under_arbitration",
  "STEP_13_DETERMINATION_ISSUED":       "determination_issued",
  "STEP_14_PAYMENT_DETERMINATION":      "payment_pending",
  "STEP_15_PAYMENT_MADE":               "payment_pending",
  "STEP_16_ADMINISTRATIVE_FEE_PAID":    "payment_pending",
  "STEP_17_DISPUTE_CLOSED":             "closed",
  "STEP_18_APPEAL_FILED":               "appealed",
  "STEP_19_APPEAL_RESOLVED":            "appealed",
};

const SERVICE_TYPES = [
  "emergency_medicine","anesthesiology","pathology","radiology",
  "neonatology","assistant_surgeon","hospitalist","intensivist",
  "air_ambulance","ground_ambulance","other",
];

const PROVIDERS = [
  { name: "Northeast Emergency Physicians LLC",   npi: "1234567890" },
  { name: "Pacific Anesthesia Group",             npi: "2345678901" },
  { name: "Midwest Radiology Associates",         npi: "3456789012" },
  { name: "Southern Pathology Consultants",       npi: "4567890123" },
  { name: "Mountain West Hospitalists",           npi: "5678901234" },
  { name: "Great Lakes Neonatology Group",        npi: "6789012345" },
  { name: "Coastal Air Medical Services",         npi: "7890123456" },
  { name: "Capital Region Intensivists",          npi: "8901234567" },
  { name: "Sunbelt Surgical Assistants",          npi: "9012345678" },
  { name: "Rocky Mountain Emergency Medicine",    npi: "0123456789" },
];

const PAYERS = [
  "BlueCross BlueShield of Texas",
  "UnitedHealthcare Choice Plus",
  "Aetna Better Health",
  "Cigna Healthcare of California",
  "Humana Gold Plus HMO",
  "Anthem Blue Cross",
  "Centene Corporation",
];

const CPT_SETS = {
  emergency_medicine: ["99285","99284","99283"],
  anesthesiology:     ["00100","00300","00400"],
  radiology:          ["70553","74177","72148"],
  pathology:          ["88305","88307"],
  neonatology:        ["99468","99469"],
  assistant_surgeon:  ["27447","27130","43239"],
  hospitalist:        ["99222","99223","99232"],
  intensivist:        ["99291","99292"],
  air_ambulance:      ["A0431","A0436"],
  ground_ambulance:   ["A0427"],
  other:              ["99285","99222"],
};

const STATES = ["CA","TX","FL","NY","PA","IL","OH","GA","NC","MI","NJ","WA","AZ","MA","TN"];

const BILLED_RANGES = {
  emergency_medicine: [1200, 8500],
  anesthesiology:     [2500, 18000],
  radiology:          [800, 6500],
  pathology:          [400, 3200],
  neonatology:        [8000, 45000],
  assistant_surgeon:  [3500, 22000],
  hospitalist:        [900, 7500],
  intensivist:        [4500, 28000],
  air_ambulance:      [35000, 120000],
  ground_ambulance:   [2800, 9500],
  other:              [500, 5000],
};

function billedAmount(serviceType) {
  const [min, max] = BILLED_RANGES[serviceType] || [500, 5000];
  return (randInt(min * 100, max * 100) / 100).toFixed(2);
}

function makeRef(idx) {
  return `NSA-IDR-2025-${String(idx + 1001).padStart(6, "0")}`;
}

// ─── IDR Entities ─────────────────────────────────────────────────────────────
const IDR_ENTITIES = [
  {
    id: randomUUID(), name: "American Arbitration Association Healthcare",
    certificationNumber: "IDR-CERT-001",
    specialties: ["emergency_medicine","anesthesiology","radiology"],
    states: ["CA","TX","FL","NY","IL","PA","OH","GA"],
    contactEmail: "healthcare@adr.org", contactPhone: "1-800-778-7879",
    website: "https://www.adr.org", maxConcurrentCases: 50,
    avgResolutionDays: 28, totalCasesHandled: 1247,
    certificationExpiry: daysFromNow(365),
  },
  {
    id: randomUUID(), name: "JAMS Healthcare Dispute Resolution",
    certificationNumber: "IDR-CERT-002",
    specialties: ["assistant_surgeon","hospitalist","neonatology","intensivist"],
    states: ["CA","NY","TX","FL","MA","WA","CO","OR"],
    contactEmail: "idr@jamsadr.com", contactPhone: "1-800-352-5267",
    website: "https://www.jamsadr.com", maxConcurrentCases: 40,
    avgResolutionDays: 25, totalCasesHandled: 892,
    certificationExpiry: daysFromNow(280),
  },
  {
    id: randomUUID(), name: "Medscape Arbitration Services",
    certificationNumber: "IDR-CERT-003",
    specialties: ["air_ambulance","ground_ambulance","emergency_medicine"],
    states: ["TX","OK","KS","NE","MO","AR","LA","MS"],
    contactEmail: "idr@medscapearb.com", contactPhone: "1-888-633-7272",
    website: "https://www.medscapearb.com", maxConcurrentCases: 30,
    avgResolutionDays: 32, totalCasesHandled: 445,
    certificationExpiry: daysFromNow(180),
  },
  {
    id: randomUUID(), name: "National Arbitration Forum Healthcare",
    certificationNumber: "IDR-CERT-004",
    specialties: ["neonatology","radiology","anesthesiology"],
    states: ["MN","WI","IA","ND","SD","NE","KS","MO"],
    contactEmail: "healthcare@nafresolution.com", contactPhone: "1-800-474-2371",
    website: "https://www.nafresolution.com", maxConcurrentCases: 35,
    avgResolutionDays: 30, totalCasesHandled: 445,
    certificationExpiry: daysFromNow(420),
  },
  {
    id: randomUUID(), name: "Capitol Dispute Resolution Services",
    certificationNumber: "IDR-CERT-005",
    specialties: ["assistant_surgeon","hospitalist","intensivist"],
    states: ["DC","MD","VA","DE","WV","PA","NJ"],
    contactEmail: "idr@capitoldr.com", contactPhone: "1-301-590-6500",
    website: "https://www.capitoldr.com", maxConcurrentCases: 25,
    avgResolutionDays: 27, totalCasesHandled: 318,
    certificationExpiry: daysFromNow(330),
  },
];

// 28 scenarios spread across all 19 steps
const SCENARIOS = [
  { step: "STEP_01_OPEN_NEGOTIATION_INITIATED", daysOld: 1,  svc: "emergency_medicine" },
  { step: "STEP_01_OPEN_NEGOTIATION_INITIATED", daysOld: 2,  svc: "anesthesiology" },
  { step: "STEP_02_OPEN_NEGOTIATION_PERIOD",    daysOld: 4,  svc: "radiology" },
  { step: "STEP_02_OPEN_NEGOTIATION_PERIOD",    daysOld: 5,  svc: "pathology" },
  { step: "STEP_03_OPEN_NEGOTIATION_FAILED",    daysOld: 7,  svc: "neonatology" },
  { step: "STEP_04_IDR_INITIATED",              daysOld: 8,  svc: "hospitalist" },
  { step: "STEP_05_IDR_NOTICE_SENT",            daysOld: 9,  svc: "emergency_medicine" },
  { step: "STEP_06_IDR_ENTITY_SELECTION",       daysOld: 10, svc: "intensivist" },
  { step: "STEP_06_IDR_ENTITY_SELECTION",       daysOld: 11, svc: "assistant_surgeon" },
  { step: "STEP_07_IDR_ENTITY_SELECTED",        daysOld: 12, svc: "anesthesiology" },
  { step: "STEP_08_ELIGIBILITY_REVIEW",         daysOld: 13, svc: "radiology" },
  { step: "STEP_08_ELIGIBILITY_REVIEW",         daysOld: 14, svc: "emergency_medicine" },
  { step: "STEP_09_OFFER_SUBMISSION",           daysOld: 15, svc: "ground_ambulance" },
  { step: "STEP_09_OFFER_SUBMISSION",           daysOld: 16, svc: "pathology" },
  { step: "STEP_09_OFFER_SUBMISSION",           daysOld: 17, svc: "neonatology" },
  { step: "STEP_10_QPA_DISCLOSURE",             daysOld: 18, svc: "air_ambulance" },
  { step: "STEP_11_ADDITIONAL_INFORMATION",     daysOld: 19, svc: "hospitalist" },
  { step: "STEP_11_ADDITIONAL_INFORMATION",     daysOld: 20, svc: "intensivist" },
  { step: "STEP_12_ARBITRATION_REVIEW",         daysOld: 22, svc: "emergency_medicine" },
  { step: "STEP_12_ARBITRATION_REVIEW",         daysOld: 23, svc: "anesthesiology" },
  { step: "STEP_13_DETERMINATION_ISSUED",       daysOld: 25, svc: "assistant_surgeon" },
  { step: "STEP_13_DETERMINATION_ISSUED",       daysOld: 26, svc: "radiology" },
  { step: "STEP_14_PAYMENT_DETERMINATION",      daysOld: 28, svc: "emergency_medicine" },
  { step: "STEP_15_PAYMENT_MADE",               daysOld: 30, svc: "neonatology" },
  { step: "STEP_16_ADMINISTRATIVE_FEE_PAID",    daysOld: 32, svc: "anesthesiology" },
  { step: "STEP_17_DISPUTE_CLOSED",             daysOld: 45, svc: "radiology" },
  { step: "STEP_18_APPEAL_FILED",               daysOld: 38, svc: "air_ambulance" },
  { step: "STEP_19_APPEAL_RESOLVED",            daysOld: 52, svc: "hospitalist" },
];

// ─── Main ─────────────────────────────────────────────────────────────────────
async function seed() {
  console.log("🌱 Seeding IDR Workflow Demo database...\n");

  // Clear existing data
  await sql`TRUNCATE notifications, dispute_documents, dispute_offers, dispute_events, dispute_drafts, disputes, idr_entities, users RESTART IDENTITY CASCADE`;
  console.log("✓ Cleared existing data");

  // Demo admin user
  const adminId = randomUUID();
  await sql`
    INSERT INTO users (id, name, email, "loginMethod", role, "createdAt", "lastSignedIn")
    VALUES (${adminId}, 'Demo Admin', 'admin@healthpoint-demo.com', 'demo', 'admin', NOW(), NOW())
  `;
  console.log("✓ Created demo admin user");

  // IDR entities
  for (const e of IDR_ENTITIES) {
    await sql`
      INSERT INTO idr_entities (
        id, name, "certificationNumber", "certificationExpiry",
        specialties, states, "contactEmail", "contactPhone", website,
        "maxConcurrentCases", "currentActiveCases",
        "avgResolutionDays", "totalCasesHandled", "isActive"
      ) VALUES (
        ${e.id}, ${e.name}, ${e.certificationNumber}, ${e.certificationExpiry},
        ${JSON.stringify(e.specialties)}, ${JSON.stringify(e.states)},
        ${e.contactEmail}, ${e.contactPhone}, ${e.website},
        ${e.maxConcurrentCases}, 0,
        ${e.avgResolutionDays}, ${e.totalCasesHandled}, true
      )
    `;
  }
  console.log(`✓ Seeded ${IDR_ENTITIES.length} IDR entities`);

  // Disputes
  const seeded = [];
  for (let i = 0; i < SCENARIOS.length; i++) {
    const sc = SCENARIOS[i];
    const provider = pick(PROVIDERS);
    const payerName = pick(PAYERS);
    const state = pick(STATES);
    const svc = sc.svc;
    const cpts = CPT_SETS[svc] || CPT_SETS.other;
    const billed = billedAmount(svc);
    const createdAt = daysAgo(sc.daysOld);
    const stepIdx = IDR_STEPS.indexOf(sc.step);
    const status = STATUS_FOR_STEP[sc.step];

    // Assign entity for steps 7+
    const entityAssigned = stepIdx >= IDR_STEPS.indexOf("STEP_07_IDR_ENTITY_SELECTED");
    const entity = entityAssigned ? IDR_ENTITIES[i % IDR_ENTITIES.length] : null;

    const id = randomUUID();
    const ref = makeRef(i);

    // Deadlines
    const openNegDeadline    = addBizDays(createdAt, 30);
    const idrInitDeadline    = addBizDays(createdAt, 4);
    const entitySelDeadline  = addBizDays(createdAt, 6);
    const eligDeadline       = addBizDays(createdAt, 3);
    const offerDeadline      = addBizDays(createdAt, 10);
    const addlInfoDeadline   = addBizDays(createdAt, 18);
    const determDeadline     = addBizDays(createdAt, 30);
    const payDeadline        = addBizDays(createdAt, 35);

    // Determination for late-stage disputes
    const hasDetermination = stepIdx >= IDR_STEPS.indexOf("STEP_13_DETERMINATION_ISSUED");
    const detAmount = hasDetermination
      ? (parseFloat(billed) * (0.45 + Math.random() * 0.35)).toFixed(2)
      : null;

    await sql`
      INSERT INTO disputes (
        id, "referenceNumber", status, "currentStep",
        "initiatingPartyType", "initiatingPartyId", "initiatingPartyName", "initiatingPartyNpi",
        "respondingPartyType", "respondingPartyName",
        "serviceType", "serviceDate", "patientState", "facilityState",
        "cptCodes", "billedAmount",
        "idrEntityId", "idrEntityName",
        "openNegotiationDeadline", "idrInitiationDeadline",
        "entitySelectionDeadline", "eligibilityDeadline",
        "offerSubmissionDeadline", "additionalInfoDeadline",
        "determinationDeadline", "paymentDeadline",
        "determinationAmount", "determinationBasis",
        "isEligible", "createdBy", "createdAt", "updatedAt"
      ) VALUES (
        ${id}, ${ref}, ${status}::dispute_status, ${sc.step}::idr_step,
        'provider'::party_type, ${provider.npi}, ${provider.name}, ${provider.npi},
        'payer'::party_type, ${payerName},
        ${svc}::service_type,
        ${daysAgo(sc.daysOld + randInt(5, 30))},
        ${state}, ${state},
        ${JSON.stringify(cpts)}, ${billed},
        ${entity?.id ?? null}, ${entity?.name ?? null},
        ${openNegDeadline}, ${idrInitDeadline},
        ${entitySelDeadline}, ${eligDeadline},
        ${offerDeadline}, ${addlInfoDeadline},
        ${determDeadline}, ${payDeadline},
        ${detAmount}, ${hasDetermination ? "IDR entity selected offer closest to QPA per 45 CFR §149.510(c)(4)" : null},
        ${stepIdx >= IDR_STEPS.indexOf("STEP_08_ELIGIBILITY_REVIEW") ? true : null},
        ${adminId}, ${createdAt}, ${createdAt}
      )
    `;

    seeded.push({ id, ref, billed, svc, stepIdx, status, createdAt, entity });
  }
  console.log(`✓ Seeded ${SCENARIOS.length} disputes`);

  // Timeline events
  let evtCount = 0;
  for (const { id, stepIdx, createdAt } of seeded) {
    for (let s = 0; s <= stepIdx; s++) {
      const step = IDR_STEPS[s];
      const evtDate = new Date(createdAt.getTime() + s * 2 * 24 * 60 * 60 * 1000);
      await sql`
        INSERT INTO dispute_events (
          id, "disputeId", "eventType", step, description,
          "performedBy", "performedByName", "createdAt"
        ) VALUES (
          ${randomUUID()}, ${id},
          'step_advanced', ${step}::idr_step,
          ${`Dispute advanced to ${step.replace(/STEP_\d+_/,"").replace(/_/g," ").toLowerCase()} stage`},
          ${adminId}, 'System', ${evtDate}
        )
      `;
      evtCount++;
    }
  }
  console.log(`✓ Seeded ${evtCount} timeline events`);

  // Offers for disputes in offer_submission stage or later
  let offerCount = 0;
  const offerStartIdx = IDR_STEPS.indexOf("STEP_09_OFFER_SUBMISSION");
  for (const { id, billed, stepIdx } of seeded) {
    if (stepIdx < offerStartIdx) continue;
    const b = parseFloat(billed);
    const provOffer = (b * (0.60 + Math.random() * 0.30)).toFixed(2);
    const payerOffer = (b * (0.30 + Math.random() * 0.25)).toFixed(2);
    const isAccepted = stepIdx >= IDR_STEPS.indexOf("STEP_13_DETERMINATION_ISSUED");

    await sql`
      INSERT INTO dispute_offers (
        id, "disputeId", "offerType", amount,
        rationale, "isAccepted", "submittedAt"
      ) VALUES (
        ${randomUUID()}, ${id}, 'initiating_party'::offer_type, ${provOffer},
        'Provider offer based on market rates, complexity of care, and regional benchmark data. Supporting documentation includes operative notes and facility overhead analysis.',
        ${isAccepted && Math.random() > 0.5}, NOW()
      )
    `;
    if (stepIdx >= IDR_STEPS.indexOf("STEP_10_QPA_DISCLOSURE")) {
      await sql`
        INSERT INTO dispute_offers (
          id, "disputeId", "offerType", amount,
          rationale, "isAccepted", "submittedAt"
        ) VALUES (
          ${randomUUID()}, ${id}, 'responding_party'::offer_type, ${payerOffer},
          'Payer offer based on the Qualifying Payment Amount (QPA) as the presumptive correct amount per 45 CFR §149.510. QPA reflects the median contracted rate for this service in this geographic area.',
          ${isAccepted && Math.random() <= 0.5}, NOW()
        )
      `;
    }
    offerCount++;
  }
  console.log(`✓ Seeded offers for ${offerCount} disputes`);

  // Notifications
  const notifs = [
    { type: "deadline_warning", title: "Offer Submission Deadline Approaching",  msg: "You have 2 business days remaining to submit your final offer for dispute NSA-IDR-2025-001013.", priority: "high",   daysOld: 0 },
    { type: "step_advanced",    title: "Dispute Advanced to Arbitration Review", msg: "Dispute NSA-IDR-2025-001019 has been advanced to the arbitration review stage.",                  priority: "high",   daysOld: 0 },
    { type: "determination",    title: "Determination Issued",                   msg: "The IDR entity has issued a determination for dispute NSA-IDR-2025-001021. Payment: $4,285.00.",    priority: "high",   daysOld: 1 },
    { type: "new_dispute",      title: "New Dispute Initiated",                  msg: "A new IDR dispute NSA-IDR-2025-001001 has been initiated by Northeast Emergency Physicians LLC.",   priority: "medium", daysOld: 1 },
    { type: "deadline_warning", title: "Eligibility Review Deadline",            msg: "Dispute NSA-IDR-2025-001011 must complete eligibility review within 1 business day.",               priority: "high",   daysOld: 2 },
    { type: "offer_received",   title: "Payer Offer Received",                   msg: "BlueCross BlueShield of Texas submitted their offer of $2,150.00 for dispute NSA-IDR-2025-001013.", priority: "medium", daysOld: 2 },
    { type: "step_advanced",    title: "IDR Entity Assigned",                    msg: "JAMS Healthcare has been assigned to dispute NSA-IDR-2025-001010.",                                 priority: "medium", daysOld: 3 },
    { type: "determination",    title: "Provider Offer Selected",                msg: "The IDR entity selected the provider offer of $8,420.00 for dispute NSA-IDR-2025-001026.",          priority: "medium", daysOld: 4 },
    { type: "deadline_warning", title: "Determination Deadline in 5 Days",       msg: "The 30-business-day determination deadline for NSA-IDR-2025-001019 expires in 5 business days.",    priority: "low",    daysOld: 5 },
    { type: "new_dispute",      title: "Air Ambulance Dispute Filed",            msg: "A new air ambulance IDR dispute NSA-IDR-2025-001003 has been filed for $48,500.00.",                priority: "low",    daysOld: 6 },
  ];
  // Get a real dispute id for notifications (required FK)
  const [{ id: firstDisputeId }] = await sql`SELECT id FROM disputes LIMIT 1`;
  for (let i = 0; i < notifs.length; i++) {
    const n = notifs[i];
    await sql`
      INSERT INTO notifications (
        id, "disputeId", "userId", "notificationType", title, message,
        "isRead", "createdAt"
      ) VALUES (
        ${randomUUID()}, ${firstDisputeId}, ${adminId},
        ${n.type}, ${n.title}, ${n.msg},
        ${i > 4}, ${daysAgo(n.daysOld)}
      )
    `;
  }
  console.log(`✓ Seeded ${notifs.length} notifications`);

  // Update IDR entity active case counts
  for (const e of IDR_ENTITIES) {
    const [{ cnt }] = await sql`
      SELECT COUNT(*) as cnt FROM disputes
      WHERE "idrEntityId" = ${e.id}
        AND status NOT IN ('closed','appealed','ineligible')
    `;
    await sql`UPDATE idr_entities SET "currentActiveCases" = ${parseInt(cnt)} WHERE id = ${e.id}`;
  }
  console.log("✓ Updated IDR entity active case counts");

  // Summary
  const [{ cnt: dc }] = await sql`SELECT COUNT(*) as cnt FROM disputes`;
  const [{ cnt: ec }] = await sql`SELECT COUNT(*) as cnt FROM idr_entities`;
  const [{ cnt: evc }] = await sql`SELECT COUNT(*) as cnt FROM dispute_events`;
  const [{ cnt: oc }] = await sql`SELECT COUNT(*) as cnt FROM dispute_offers`;
  const [{ cnt: nc }] = await sql`SELECT COUNT(*) as cnt FROM notifications`;

  console.log("\n✅ Seed complete:");
  console.log(`   Disputes:        ${dc}`);
  console.log(`   IDR Entities:    ${ec}`);
  console.log(`   Timeline Events: ${evc}`);
  console.log(`   Offers:          ${oc}`);
  console.log(`   Notifications:   ${nc}`);

  await sql.end();
}

seed().catch(err => {
  console.error("❌ Seed failed:", err.message);
  console.error(err);
  process.exit(1);
});
