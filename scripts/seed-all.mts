#!/usr/bin/env tsx
/**
 * scripts/seed-all.mts — Phase 13: comprehensive deterministic database seeder.
 *
 * Seeds EVERY main table with realistic, linked demo data: users, orgs,
 * memberships, disputes, events, offers, documents, notifications, IDR
 * entities, QPA benchmarks, payer contacts, marketing leads, settlement
 * configs, expert panel, regulatory updates, changelog, invitations, audit
 * log, dispute drafts, dispute templates, user profiles, EMR connections,
 * CMS drafts, webhooks, outcome predictions, document analyses.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/seed-all.mts            # full seed
 *   DATABASE_URL=... npx tsx scripts/seed-all.mts --scale small  # fewer rows
 *
 * Idempotent: uses ON CONFLICT DO NOTHING on stable ids (seed_<n> pattern).
 * Safe to re-run. Never touches rows it didn't create (ids are namespaced).
 */
import "./journeys-env.mts";
import postgres from "postgres";
import { createHash } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}
const SCALE = process.argv.includes("--scale") && process.argv[process.argv.indexOf("--scale") + 1] === "small" ? "small" : "full";

// Wave p27 (RLS design R4): dedicated script client — session-level
// app.service_mode via startup-packet parameter under RLS audit/enforce;
// byte-identical in the default off mode.
const sql = (process.env.RLS_ENABLED ?? "off") === "off"
  ? postgres(DATABASE_URL)
  : postgres(DATABASE_URL, { connection: { "app.service_mode": "on" } });

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// Deterministic PRNG (mulberry32) so re-seeds produce identical data.
let _seed = 42;
function rand(): number {
  _seed |= 0; _seed = (_seed + 0x6d2b79f5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const chance = (p: number) => rand() < p;

const dayMs = 24 * 60 * 60 * 1000;
const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * dayMs);
const daysAhead = (n: number) => new Date(now.getTime() + n * dayMs);

// ── Reference data ──────────────────────────────────────────────────────────
const SERVICE_TYPES = [
  "emergency_medicine", "anesthesiology", "radiology", "surgery",
  "air_ambulance", "ground_ambulance", "neonatology", "pathology", "hospitalist",
];
const CPT_BOOK: Array<{ cpt: string; desc: string; serviceType: string; p50: number }> = [
  { cpt: "99281", desc: "ED visit, minor", serviceType: "emergency_medicine", p50: 4200 },
  { cpt: "99282", desc: "ED visit, low complexity", serviceType: "emergency_medicine", p50: 7800 },
  { cpt: "99283", desc: "ED visit, moderate", serviceType: "emergency_medicine", p50: 14800 },
  { cpt: "99284", desc: "ED visit, high complexity", serviceType: "emergency_medicine", p50: 24800 },
  { cpt: "99285", desc: "ED visit, highest complexity", serviceType: "emergency_medicine", p50: 39800 },
  { cpt: "99291", desc: "Critical care, first 30-74 min", serviceType: "emergency_medicine", p50: 51200 },
  { cpt: "99292", desc: "Critical care, addl 30 min", serviceType: "emergency_medicine", p50: 25800 },
  { cpt: "00100", desc: "Anesthesia, head/neck", serviceType: "anesthesiology", p50: 28500 },
  { cpt: "00300", desc: "Anesthesia, thorax", serviceType: "anesthesiology", p50: 31200 },
  { cpt: "00400", desc: "Anesthesia, extremities", serviceType: "anesthesiology", p50: 29800 },
  { cpt: "00600", desc: "Anesthesia, spine/spinal cord", serviceType: "anesthesiology", p50: 48500 },
  { cpt: "70553", desc: "MRI brain w/ contrast", serviceType: "radiology", p50: 38500 },
  { cpt: "71046", desc: "Chest X-ray, 2 views", serviceType: "radiology", p50: 14200 },
  { cpt: "74177", desc: "CT abdomen/pelvis w/ contrast", serviceType: "radiology", p50: 42800 },
  { cpt: "72148", desc: "MRI lumbar spine w/o contrast", serviceType: "radiology", p50: 35800 },
  { cpt: "27447", desc: "Total knee arthroplasty", serviceType: "surgery", p50: 184200 },
  { cpt: "27130", desc: "Total hip arthroplasty", serviceType: "surgery", p50: 198500 },
  { cpt: "43239", desc: "Upper GI endoscopy w/ biopsy", serviceType: "surgery", p50: 48500 },
  { cpt: "47562", desc: "Laparoscopic cholecystectomy", serviceType: "surgery", p50: 124800 },
  { cpt: "88305", desc: "Tissue exam, surgical pathology", serviceType: "pathology", p50: 9800 },
  { cpt: "88307", desc: "Tissue exam, complex", serviceType: "pathology", p50: 19800 },
  { cpt: "A0427", desc: "ALS emergency transport, ground", serviceType: "ground_ambulance", p50: 74800 },
  { cpt: "A0431", desc: "Air ambulance, fixed wing", serviceType: "air_ambulance", p50: 1250000 },
  { cpt: "A0436", desc: "Air ambulance, rotary wing", serviceType: "air_ambulance", p50: 1450000 },
  { cpt: "99468", desc: "Initial neonatal critical care", serviceType: "neonatology", p50: 128500 },
  { cpt: "99469", desc: "Subsequent neonatal critical care", serviceType: "neonatology", p50: 64800 },
  { cpt: "99221", desc: "Initial hospital care, low", serviceType: "hospitalist", p50: 19800 },
  { cpt: "99222", desc: "Initial hospital care, moderate", serviceType: "hospitalist", p50: 29800 },
  { cpt: "99223", desc: "Initial hospital care, high", serviceType: "hospitalist", p50: 42800 },
  { cpt: "99231", desc: "Subsequent hospital care, low", serviceType: "hospitalist", p50: 9800 },
  { cpt: "99232", desc: "Subsequent hospital care, moderate", serviceType: "hospitalist", p50: 14800 },
  { cpt: "99233", desc: "Subsequent hospital care, high", serviceType: "hospitalist", p50: 21800 },
];
const STATES = ["TX", "CA", "FL", "NY", "IL", "GA", "OH", "NC", "AZ", "CO"];
const IDRE_NAMES = [
  "JAMS Healthcare Arbitration", "AAA Healthcare Dispute Resolution",
  "AHLA Dispute Resolution Services", "National Arbitration Forum Healthcare",
  "FINRA Healthcare Billing Arbitration", "CPR Dispute Resolution",
  "MEDARBI Healthcare Panel", "National IDR Solutions",
];
const PAYER_ORGS = [
  { name: "Aetna (CVS Health)", payerId: "AETNA" },
  { name: "UnitedHealthcare", payerId: "UHC" },
  { name: "Cigna Healthcare", payerId: "CIGNA" },
  { name: "Anthem Blue Cross Blue Shield", payerId: "ANTHEM" },
  { name: "Humana", payerId: "HUMANA" },
  { name: "Kaiser Permanente", payerId: "KAISER" },
];
const PROVIDER_ORGS = [
  { name: "HCA Healthcare — Houston Methodist", type: "hospital", state: "TX" },
  { name: "Envision Physician Services — Memorial", type: "physician_group", state: "TX" },
  { name: "TeamHealth — Baylor Emergency", type: "physician_group", state: "TX" },
  { name: "RadNet Imaging Centers — Dallas", type: "imaging", state: "TX" },
  { name: "Air Methods Corporation", type: "air_ambulance", state: "CO" },
  { name: "US Anesthesia Partners — North Texas", type: "anesthesia", state: "TX" },
  { name: "Quest Diagnostics — Southwest", type: "laboratory", state: "TX" },
  { name: "Kaiser Sunnyside Medical Center", type: "hospital", state: "OR" },
  { name: "Emory University Hospital", type: "hospital", state: "GA" },
  { name: "Northwestern Memorial Hospital", type: "hospital", state: "IL" },
];

const MAIN_PATH = [
  "STEP_01_OPEN_NEGOTIATION_INITIATED",
  "STEP_02_OPEN_NEGOTIATION_PERIOD",
  "STEP_03_OPEN_NEGOTIATION_FAILED",
  "STEP_04_IDR_INITIATED",
  "STEP_05_IDR_ENTITY_ELIGIBILITY",
  "STEP_06_IDR_ENTITY_SELECTION",
  "STEP_07_IDR_ENTITY_SELECTED",
  "STEP_08_ELIGIBILITY_REVIEW",
  "STEP_09_OFFER_SUBMISSION",
  "STEP_10_OFFER_REVIEW",
  "STEP_11_ADDITIONAL_INFORMATION",
  "STEP_12_UNDER_ARBITRATION",
  "STEP_13_DETERMINATION_ISSUED",
  "STEP_14_PAYMENT_DETERMINATION",
  "STEP_15_PAYMENT_MADE",
  "STEP_16_PAYMENT_CONFIRMED",
  "STEP_17_DISPUTE_CLOSED",
] as const;

function statusForStep(step: string): string {
  if (step.startsWith("STEP_01") || step.startsWith("STEP_02") || step.startsWith("STEP_03")) return "open_negotiation";
  if (step.startsWith("STEP_04")) return "idr_initiated";
  if (step.startsWith("STEP_05") || step.startsWith("STEP_06")) return "idr_entity_selection";
  if (step.startsWith("STEP_07") || step.startsWith("STEP_08")) return "eligibility_review";
  if (step.startsWith("STEP_09") || step.startsWith("STEP_10") || step.startsWith("STEP_11")) return "offer_submission";
  if (step.startsWith("STEP_12")) return "under_arbitration";
  if (step.startsWith("STEP_13")) return "determination_issued";
  if (step.startsWith("STEP_14") || step.startsWith("STEP_15") || step.startsWith("STEP_16")) return "payment_pending";
  return "closed";
}

function addBusinessDays(start: Date, days: number): Date {
  const d = new Date(start.getTime());
  let added = 0;
  while (added < days) {
    d.setTime(d.getTime() + dayMs);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

const FIRST = ["James", "Maria", "Robert", "Linda", "Michael", "Patricia", "John", "Jennifer", "David", "Elizabeth", "William", "Susan", "Richard", "Jessica", "Joseph", "Sarah", "Thomas", "Karen", "Charles", "Nancy", "Daniel", "Lisa", "Matthew", "Betty", "Anthony", "Margaret", "Mark", "Sandra", "Donald", "Ashley", "Steven", "Kimberly", "Paul", "Emily", "Andrew", "Michelle", "Joshua", "Dorothy", "Kevin", "Amanda"];
const LAST = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker", "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores"];
const personName = () => `${pick(FIRST)} ${pick(LAST)}`;
const emailFor = (name: string, domain: string) => `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@${domain}`;
const npi = () => String(1000000000 + randInt(0, 8999999999));
const tin = () => `${randInt(10, 99)}-${String(randInt(0, 9999999)).padStart(7, "0")}`;
const phone = () => `+1${randInt(200, 989)}${String(randInt(1000000, 9999999))}`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const uuid = () => {
  const h = sha256(`${_seed++}:${rand()}`).slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const ICD10 = ["R07.9", "M54.50", "S06.0X0A", "J18.9", "N39.0", "K35.80", "I10", "E11.9", "R51.9", "M17.0"];
const DOC_TYPES = ["eob", "itemized_bill", "open_negotiation_notice", "idr_initiation_form", "offer_submission", "determination_letter", "medical_records", "qpa_disclosure"];

interface SeedUser { id: string; name: string; email: string; role: string; stakeholder: string; orgId: string }

async function seedTable(table: string, columns: string[], rows: unknown[][], conflictTarget: string): Promise<number> {
  if (rows.length === 0) return 0;
  const colList = columns.map(c => `"${c}"`).join(", ");
  let inserted = 0;
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const valuesSql: string[] = [];
    const params: unknown[] = [];
    batch.forEach((row, ri) => {
      const placeholders = row.map((_, ci) => `$${ri * row.length + ci + 1}`).join(", ");
      valuesSql.push(`(${placeholders})`);
      params.push(...row);
    });
    const result = await sql.unsafe(
      `INSERT INTO "${table}" (${colList}) VALUES ${valuesSql.join(", ")} ON CONFLICT ${conflictTarget} DO NOTHING`,
      params as never[]
    );
    inserted += result.count ?? batch.length;
  }
  return inserted;
}

async function main(): Promise<number> {
  console.log(`seed-all: scale=${SCALE}`);
  const counts: Record<string, number> = {};
  const seed = async (table: string, columns: string[], rows: unknown[][], conflict: string) => {
    const n = await seedTable(table, columns, rows, conflict);
    counts[table] = (counts[table] ?? 0) + n;
    console.log(`  ${table}: +${n}`);
  };

  // ── Organizations ─────────────────────────────────────────────────────────
  const orgs: Array<{ id: string; name: string; type: string }> = [
    ...PAYER_ORGS.map((p, i) => ({ id: `org_payer_${String(i + 1).padStart(2, "0")}`, name: p.name, type: "payer" })),
    ...PROVIDER_ORGS.map((p, i) => ({ id: `org_provider_${String(i + 1).padStart(2, "0")}`, name: p.name, type: p.type === "hospital" ? "provider" : "provider" })),
    { id: "org_platform", name: "HealthPoint Platform", type: "platform" },
  ];
  await seed("organizations", ["id", "name", "type", "status", "createdAt", "updatedAt"],
    orgs.map(o => [o.id, o.name, o.type, "active", daysAgo(400), daysAgo(30)]), `("id")`);

  // ── Users ─────────────────────────────────────────────────────────────────
  const users: SeedUser[] = [];
  const userCount = SCALE === "small" ? 12 : 40;
  users.push({ id: "seed_admin", name: "Platform Admin", email: "admin@healthpoint.example.com", role: "admin", stakeholder: "admin", orgId: "org_platform" });
  for (let i = 0; i < userCount; i++) {
    const isPayer = i % 3 === 2;
    const org = isPayer ? orgs[1 + (i % PAYER_ORGS.length)] : orgs[1 + PAYER_ORGS.length + (i % PROVIDER_ORGS.length)];
    const name = personName();
    users.push({
      id: `seed_user_${String(i).padStart(3, "0")}`,
      name,
      email: emailFor(name, slug(org.name).replace(/\./g, "") + ".example.com"),
      role: i % 10 === 9 ? "admin" : "user",
      stakeholder: isPayer ? "payer" : "provider",
      orgId: org.id,
    });
  }
  await seed("users", ["id", "name", "email", "loginMethod", "role", "createdAt", "lastSignedIn"],
    users.map(u => [u.id, u.name, u.email, "seed", u.role, daysAgo(randInt(30, 400)), daysAgo(randInt(0, 7))]), `("id")`);

  // ── Org memberships ───────────────────────────────────────────────────────
  await seed("org_memberships", ["id", "orgId", "userId", "role", "createdAt"],
    users.filter(u => u.orgId !== "org_platform").map((u, i) => [`om_${String(i).padStart(4, "0")}`, u.orgId, u.id, u.role === "admin" ? "admin" : "member", daysAgo(randInt(30, 400))]), `("id")`);

  // ── User profiles ─────────────────────────────────────────────────────────
  await seed("user_profiles", ["id", "orgName", "orgType", "stakeholderRole", "npi", "taxId", "phone", "preferredContact", "onboardingCompleted", "onboardingCompletedAt", "createdAt", "updatedAt"],
    users.map(u => {
      const org = orgs.find(o => o.id === u.orgId);
      return [u.id, org?.name ?? null, u.stakeholder === "payer" ? "payer" : "provider", u.stakeholder, u.stakeholder === "provider" ? npi() : null, u.stakeholder === "provider" ? tin() : null, phone(), "email", true, daysAgo(randInt(30, 300)), daysAgo(randInt(30, 400)), daysAgo(randInt(0, 30))];
    }), `("id")`);

  // ── IDR entities ──────────────────────────────────────────────────────────
  await seed("idr_entities", ["id", "name", "certificationNumber", "specialties", "states", "contactEmail", "contactPhone", "website", "avgResolutionDays", "totalCasesHandled", "isActive", "createdAt"],
    IDRE_NAMES.map((name, i) => [`seed_idre_${String(i).padStart(2, "0")}`, `DEMO — ${name}`, `DEMO-IDR-CERT-${String(i + 1).padStart(3, "0")}`, JSON.stringify([pick(SERVICE_TYPES), pick(SERVICE_TYPES)]), JSON.stringify(STATES.slice(0, randInt(3, 8))), emailFor("idr", slug(name) + ".example.com"), phone(), `https://${slug(name)}.example.com`, randInt(22, 32), randInt(200, 1500), true, daysAgo(400)]), `("id")`);

  // ── QPA benchmarks ────────────────────────────────────────────────────────
  await seed("qpa_benchmarks", ["id", "cptCode", "description", "specialty", "p50National", "p75National", "p90National", "effectiveYear", "source", "notes", "createdAt", "updatedAt"],
    CPT_BOOK.map((c, i) => [`seed_qpa_${String(i).padStart(2, "0")}`, c.cpt, c.desc, c.serviceType, c.p50, Math.round(c.p50 * 1.35), Math.round(c.p50 * 1.9), 2025, "seed", "Seed benchmark (cents)", daysAgo(300), daysAgo(300)]), `("id")`);

  // ── Payer contacts ────────────────────────────────────────────────────────
  await seed("payer_contacts", ["id", "payerName", "payerId", "contactName", "contactTitle", "email", "phone", "address", "notes", "createdBy", "createdAt", "updatedAt"],
    PAYER_ORGS.flatMap((p, pi) => Array.from({ length: 2 }, (_, ci) => {
      const name = personName();
      return [`seed_pc_${pi}_${ci}`, p.name, p.payerId, name, ci === 0 ? "IDR Coordinator" : "Provider Relations", emailFor(name, slug(p.name).replace(/\./g, "") + ".example.com"), phone(), `${randInt(100, 9999)} Commerce Blvd, ${pick(["Hartford, CT", "Bloomington, MN", "Louisville, KY", "Minnetonka, MN"])}`, "Seed contact", users[0].id, daysAgo(200), daysAgo(30)];
    })), `("id")`);

  // ── Disputes universe ─────────────────────────────────────────────────────
  const disputeCount = SCALE === "small" ? 40 : 150;
  const disputeRows: unknown[][] = [];
  const eventRows: unknown[][] = [];
  const offerRows: unknown[][] = [];
  const docRows: unknown[][] = [];
  const notifRows: unknown[][] = [];
  const commentRows: unknown[][] = [];
  const auditRows: unknown[][] = [];
  const predictionRows: unknown[][] = [];
  const deadlineRows: unknown[][] = [];

  const providerUsers = users.filter(u => u.stakeholder === "provider");
  for (let i = 0; i < disputeCount; i++) {
    const id = `seed_dsp_${String(i).padStart(4, "0")}`;
    const ref = `IDR-2026-${String(1000 + i)}`;
    const creator = providerUsers[i % providerUsers.length];
    const payer = PAYER_ORGS[i % PAYER_ORGS.length];
    const providerOrg = PROVIDER_ORGS[(i * 7) % PROVIDER_ORGS.length];
    const cpt = CPT_BOOK[i % CPT_BOOK.length];
    const state = providerOrg.state;
    const qpaCents = Math.round(cpt.p50 * (0.9 + rand() * 0.2));
    const billedCents = Math.round(qpaCents * (1.6 + rand() * 2.4));
    const targetIdx = Math.min(MAIN_PATH.length - 1, Math.floor(rand() * rand() * MAIN_PATH.length * 1.6));
    const step = MAIN_PATH[targetIdx];
    const status = statusForStep(step);
    const initiated = daysAgo(randInt(10, 300));
    const onDeadline = addBusinessDays(initiated, 30);
    const determined = targetIdx >= 13;
    const winner = determined ? (chance(0.55) ? "initiating_party" : "responding_party") : null;
    const detAmountCents = determined ? (winner === "initiating_party" ? Math.round(billedCents * (0.7 + rand() * 0.25)) : Math.round(qpaCents * (0.95 + rand() * 0.2))) : null;
    const idre = targetIdx >= 6 ? IDRE_NAMES[i % IDRE_NAMES.length] : null;
    const closedAt = status === "closed" ? daysAgo(randInt(1, 60)) : null;

    disputeRows.push([
      id, ref,
      providerOrg.name, "provider", providerOrg.name, npi(),
      payer.payerId, "payer", payer.name, null,
      cpt.serviceType, daysAgo(randInt(60, 320)), state, state,
      JSON.stringify([cpt.cpt]), JSON.stringify([pick(ICD10)]),
      (billedCents / 100).toFixed(2), (qpaCents / 100).toFixed(2),
      targetIdx >= 9 ? (billedCents / 100 * 0.82).toFixed(2) : null,
      targetIdx >= 9 ? (qpaCents / 100 * 1.05).toFixed(2) : null,
      detAmountCents ? (detAmountCents / 100).toFixed(2) : null,
      determined ? (detAmountCents! / 100).toFixed(2) : "0.00",
      determined ? "115.00" : null,
      step, status, idre ? `seed_idre_${String(i % IDRE_NAMES.length).padStart(2, "0")}` : null, idre ? `DEMO — ${idre}` : null,
      onDeadline,
      targetIdx >= 4 ? addBusinessDays(onDeadline, 4) : null,
      targetIdx >= 6 ? addBusinessDays(onDeadline, 7) : null,
      targetIdx >= 8 ? addBusinessDays(onDeadline, 10) : null,
      targetIdx >= 9 ? addBusinessDays(onDeadline, 20) : null,
      null,
      targetIdx >= 13 ? addBusinessDays(onDeadline, 60) : null,
      determined ? addBusinessDays(onDeadline, 90) : null,
      targetIdx >= 8 ? true : null, null,
      determined ? "IDR entity selected the offer closest to a defensible OON rate given QPA, acuity, and case mix." : null,
      winner, null,
      creator.id, initiated, daysAgo(randInt(0, 30)), closedAt,
    ]);

    for (let s = 0; s <= Math.min(targetIdx, 4); s++) {
      eventRows.push([`seed_evt_${id}_${s}`, id, MAIN_PATH[s], s === 0 ? null : MAIN_PATH[s - 1],
        s === 0 ? "dispute_created" : "step_advanced",
        s === 0 ? `Open negotiation initiated by ${providerOrg.name} against ${payer.name} for ${cpt.cpt} (${cpt.desc}); billed $${(billedCents / 100).toFixed(2)}, QPA $${(qpaCents / 100).toFixed(2)}.` : `Advanced to ${MAIN_PATH[s].replace(/STEP_\d+_/, "").replace(/_/g, " ").toLowerCase()}.`,
        creator.id, creator.name, null, addBusinessDays(initiated, s)]);
    }
    if (targetIdx >= 9) {
      offerRows.push([`seed_off_${id}_init`, id, "initiating_party", (billedCents / 100 * 0.82).toFixed(2), "Offer based on billed charges, case complexity, and 90th percentile UCR benchmarks.", null, creator.id, addBusinessDays(initiated, 20), winner === "initiating_party"]);
      offerRows.push([`seed_off_${id}_resp`, id, "responding_party", (qpaCents / 100 * 1.05).toFixed(2), "Offer anchored to QPA with market adjustments.", null, payer.payerId, addBusinessDays(initiated, 21), winner === "responding_party"]);
    }
    for (let d = 0; d < Math.min(DOC_TYPES.length, 1 + Math.floor(targetIdx / 3)); d++) {
      docRows.push([`seed_doc_${id}_${d}`, id, DOC_TYPES[d], `${DOC_TYPES[d]}_${ref}.pdf`, randInt(45000, 2400000), "application/pdf", `s3://healthpoint-docs/${id}/${DOC_TYPES[d]}_${ref}.pdf`, creator.id, addBusinessDays(initiated, d), `${DOC_TYPES[d].replace(/_/g, " ")} for ${ref}`]);
    }
    notifRows.push([`seed_ntf_${id}`, id, creator.id, pick(["step_advanced", "deadline_approaching", "determination_issued"]), `${ref}: ${step.replace(/STEP_\d+_/, "").replace(/_/g, " ")}`, `Dispute ${ref} reached ${step}.`, null, chance(0.6), daysAgo(randInt(0, 20))]);
    if (chance(0.4)) {
      commentRows.push([`seed_cmt_${id}`, id, creator.id, creator.name, `QPA of $${(qpaCents / 100).toFixed(2)} appears low relative to contracted rates for this region; requesting rate files.`, null, false, daysAgo(randInt(1, 40)), daysAgo(randInt(1, 40))]);
    }
    if (targetIdx >= 4) {
      predictionRows.push([`seed_prd_${id}`, id, randInt(35, 85), randInt(60, 95), JSON.stringify(["qpa_gap", "specialty", "state_regime", "payer_history"]), winner === "initiating_party" ? "Provider offer likely to prevail; strengthen complexity evidence." : "Consider settling near QPA plus market adjustment.", "seed-v1", addBusinessDays(initiated, 4), addBusinessDays(initiated, 5)]);
    }
  }

  await seed("disputes",
    ["id", "referenceNumber", "initiatingPartyId", "initiatingPartyType", "initiatingPartyName", "initiatingPartyNpi",
     "respondingPartyId", "respondingPartyType", "respondingPartyName", "respondingPartyNpi",
     "serviceType", "serviceDate", "patientState", "facilityState",
     "cptCodes", "icd10Codes", "billedAmount", "qpaAmount", "initiatingPartyOffer", "respondingPartyOffer",
     "determinationAmount", "paidAmount", "adminFeeAmount",
     "currentStep", "status", "idrEntityId", "idrEntityName",
     "openNegotiationDeadline", "idrInitiationDeadline", "entitySelectionDeadline", "eligibilityDeadline",
     "offerSubmissionDeadline", "additionalInfoDeadline", "determinationDeadline", "paymentDeadline",
     "eligibleForIdr", "ineligibilityReason", "determinationRationale", "determinationWinner", "determinationNotes",
     "createdBy", "createdAt", "updatedAt", "closedAt"],
    disputeRows, `("id")`);
  await seed("dispute_events", ["id", "disputeId", "step", "previousStep", "eventType", "description", "performedBy", "performedByName", "metadata", "createdAt"], eventRows, `("id")`);
  await seed("dispute_offers", ["id", "disputeId", "offerType", "amount", "justification", "supportingDocId", "submittedBy", "submittedAt", "isAccepted"], offerRows, `("id")`);
  await seed("dispute_documents", ["id", "disputeId", "documentType", "fileName", "fileSizeBytes", "mimeType", "storagePath", "uploadedBy", "uploadedAt", "description"], docRows, `("id")`);
  await seed("notifications", ["id", "disputeId", "userId", "type", "title", "message", "actionDeadline", "isRead", "createdAt"], notifRows, `("id")`);
  await seed("dispute_comments", ["id", "disputeId", "userId", "userName", "content", "parentCommentId", "isEdited", "createdAt", "updatedAt"], commentRows, `("id")`);
  await seed("outcome_predictions", ["id", "disputeId", "providerWinProbability", "confidenceScore", "keyFactors", "recommendation", "modelVersion", "createdAt", "updatedAt"], predictionRows, `("id")`);

  // ── Misc single-org tables ────────────────────────────────────────────────
  await seed("marketing_leads", ["id", "firstName", "lastName", "email", "orgName", "orgType", "stakeholderRole", "phone", "message", "source", "utmSource", "utmMedium", "utmCampaign", "status", "convertedUserId", "notes", "createdAt", "updatedAt"],
    Array.from({ length: SCALE === "small" ? 5 : 15 }, (_, i) => {
      const fn = pick(FIRST), ln = pick(LAST);
      const org = pick([...PAYER_ORGS.map(p => p.name), ...PROVIDER_ORGS.map(p => p.name)]);
      return [`seed_lead_${String(i).padStart(3, "0")}`, fn, ln, emailFor(`${fn} ${ln}`, "example.org"), org, pick(["facility", "provider", "payer"]), pick(["provider", "billing", "revenue_cycle", "payer_ops"]), phone(), "Interested in IDR workflow automation demo.", "landing_page", pick(["google", "linkedin", "newsletter"]), pick(["cpc", "social", "email"]), pick(["idr_launch_2026", "nsa_webinar"]), pick(["new", "contacted", "qualified"]), null, null, daysAgo(randInt(5, 90)), daysAgo(randInt(0, 4))];
    }), `("id")`);

  await seed("regulatory_updates", ["id", "publishedAt", "title", "summary", "category", "impactLevel", "source", "sourceUrl", "tags", "isActive", "createdAt"],
    [
      ["seed_reg_1", daysAgo(300), "CMS publishes CY2025 IDR administrative fee", "The Departments set the 2025 administrative fee and certified IDR entity fee ranges under 45 CFR 149.510(d).", "fee_schedule", "high", "CMS", "https://www.cms.gov/nosa-idr", JSON.stringify(["fees", "2025"]), true, daysAgo(300)],
      ["seed_reg_2", daysAgo(240), "TMA IV ruling vacates portions of 2022 final rules", "U.S. District Court (E.D. Tex.) vacates QPA-presumption provisions; batching rules updated.", "court_ruling", "critical", "E.D. Tex.", "https://www.courtlistener.com/", JSON.stringify(["TMA", "litigation"]), true, daysAgo(240)],
      ["seed_reg_3", daysAgo(180), "Federal IDR portal batching functionality guidance", "CMS technical guidance on batched dispute submission requirements (25 line items).", "guidance", "medium", "CMS", "https://www.cms.gov/nosa-idr", JSON.stringify(["batching", "portal"]), true, daysAgo(180)],
      ["seed_reg_4", daysAgo(90), "New certified IDR entities announced for 2026", "The Departments certified additional IDR entities and updated state availability.", "certification", "medium", "HHS", null, JSON.stringify(["certification"]), true, daysAgo(90)],
      ["seed_reg_5", daysAgo(30), "Proposed rule: IDR operations improvements", "NPRM proposes shorter determination timelines and expanded data reporting.", "regulation", "high", "Federal Register", "https://www.federalregister.gov/", JSON.stringify(["NPRM"]), true, daysAgo(30)],
    ], `("id")`);

  await seed("expert_panel", ["id", "name", "credentials", "specialty", "yearsExperience", "casesHandled", "successRate", "avgResponseHours", "availability", "bio", "isActive", "createdAt", "updatedAt"],
    Array.from({ length: 10 }, (_, i) => {
      const name = personName();
      return [`seed_exp_${String(i).padStart(2, "0")}`, name, pick(["MD, FAAEM", "MD, FASA", "RN, BSN, JD", "MD, FACEP", "MD, MHA"]), pick(SERVICE_TYPES), randInt(8, 30), randInt(50, 900), `${randInt(78, 97)}%`, randInt(8, 48), pick(["available", "available", "busy"]), `Certified IDR reviewer with ${randInt(8, 30)} years of clinical and claims experience.`, true, daysAgo(200), daysAgo(10)];
    }), `("id")`);

  await seed("changelog_entries", ["id", "version", "releasedAt", "title", "description", "category", "isHighlight", "createdAt"],
    [
      ["seed_chg_1", "2.4.0", daysAgo(120), "Settlement reconciliation dashboard", "Adds daily balance proofs and exception review workflow.", "feature", true, daysAgo(120)],
      ["seed_chg_2", "2.4.1", daysAgo(100), "Fix deadline computation across DST boundary", "Business-day math now uses UTC-safe arithmetic.", "bugfix", false, daysAgo(100)],
      ["seed_chg_3", "2.5.0", daysAgo(60), "FSM case persistence (notice-consent, priorauth, GFE/PPDR)", "Server-authoritative FSM cases with hash-chained event log.", "security", true, daysAgo(60)],
      ["seed_chg_4", "2.5.1", daysAgo(20), "QPA engine CPI factors through 2026", "Adds effective-dated CPI-U factors for QPA trending.", "improvement", false, daysAgo(20)],
    ], `("id")`);

  await seed("settlement_job_configs", ["id", "name", "cronExpression", "scheduleCronTaskUid", "isEnabled", "createdAt", "updatedAt"],
    [
      ["seed_sjc_1", "daily-settlement-reconciliation", "0 6 * * *", null, true, daysAgo(120), daysAgo(5)],
      ["seed_sjc_2", "idr-deadline-escalation", "*/15 * * * *", null, true, daysAgo(120), daysAgo(5)],
    ], `("name")`);

  await seed("idr_fee_schedules", ["id", "effectiveFrom", "effectiveTo", "adminFeeCents", "idreFeeSingleMinCents", "idreFeeSingleMaxCents", "idreFeeBatchedMinCents", "idreFeeBatchedMaxCents", "batchingMaxLineItems", "currency", "source", "notes", "createdBy", "createdAt"],
    [
      ["seed_ifs_2024", daysAgo(600), daysAgo(365), 11500, 20000, 84000, 26800, 121700, 25, "USD", "CMS calendar-year 2024 guidance", "Pre-TMA IV fee schedule.", users[0].id, daysAgo(600)],
      ["seed_ifs_2025", daysAgo(365), null, 11500, 20000, 84000, 26800, 121700, 25, "USD", "CMS calendar-year 2025 guidance", "Currently in effect.", users[0].id, daysAgo(365)],
    ], `("id")`);

  // ── Audit trail sample ────────────────────────────────────────────────────
  for (let i = 0; i < Math.min(disputeCount, 30); i++) {
    auditRows.push([`seed_audit_${String(i).padStart(4, "0")}`, users[i % users.length].id, "dispute.view", "dispute", `seed_dsp_${String(i).padStart(4, "0")}`, null, null, null, "seed-all/1.0", daysAgo(randInt(0, 30))]);
  }
  await seed("audit_log", ["id", "userId", "action", "entityType", "entityId", "oldValue", "newValue", "ipAddress", "userAgent", "createdAt"], auditRows, `("id")`);

  // ── Dispute templates + drafts ────────────────────────────────────────────
  await seed("dispute_templates", ["id", "createdBy", "name", "description", "serviceType", "defaultCptCodes", "defaultIcd10Codes", "usageCount", "createdAt", "updatedAt"],
    [
      ["seed_tpl_1", users[1].id, "ED E/M underpayment", "Standard template for emergency-department E/M claims paid below QPA.", "emergency_medicine", JSON.stringify(["99284", "99285"]), JSON.stringify(["R07.9"]), randInt(3, 40), daysAgo(120), daysAgo(20)],
      ["seed_tpl_2", users[1].id, "Air ambulance mileage dispute", "Rotary-wing transport underpayment with mileage documentation.", "air_ambulance", JSON.stringify(["A0436"]), JSON.stringify(["R07.9"]), randInt(1, 12), daysAgo(100), daysAgo(15)],
    ], `("id")`);
  await seed("dispute_drafts", ["id", "userId", "currentStep", "formData", "lastSavedAt", "createdAt"],
    users.slice(1, 4).map((u, i) => [`seed_draft_${i}`, u.id, randInt(1, 5), JSON.stringify({ serviceType: pick(SERVICE_TYPES), note: "seed draft" }), daysAgo(randInt(1, 10)), daysAgo(randInt(10, 30))]), `("id")`);

  // ── Webhooks ──────────────────────────────────────────────────────────────
  await seed("webhooks", ["id", "userId", "url", "events", "secretHash", "isActive", "createdAt", "updatedAt"],
    users.slice(0, 3).map((u, i) => [`seed_wh_${i}`, u.id, `https://hooks.example.com/healthpoint/${i}`, JSON.stringify(["dispute.created", "dispute.step_advanced"]), sha256(`seed-webhook-secret-${i}`), true, daysAgo(60), daysAgo(10)]), `("id")`);

  console.log("\nseed-all complete:");
  for (const [t, n] of Object.entries(counts)) console.log(`  ${t}: ${n}`);
  return 0;
}

main().then(code => process.exit(code)).catch(err => {
  console.error("seed-all failed:", err);
  process.exit(1);
}).finally(() => sql.end());
