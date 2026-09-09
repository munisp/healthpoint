/**
 * scripts/seed-all.mts
 *
 * Comprehensive synthetic-data seeder for HealthPoint (NSA/Federal IDR platform).
 * Covers every table in drizzle/schema.ts plus the auxiliary modules
 * (schema-idr-compliance, schema-fsm-cases, schema-qpa, schema-push,
 * schema-reconciliation, schema-submission-automation).
 *
 * Usage:
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55433/healthpoint \
 *     npx tsx scripts/seed-all.mts [--scale small|medium|large] [--seed 42] [--reset] [--allow-remote]
 *
 * Properties:
 * - DETERMINISTIC: mulberry32 PRNG seeded by --seed (default 42). Same seed +
 *   same scale => identical rows (all IDs and timestamps derive from the seed
 *   and a fixed epoch anchor, never from wall-clock time).
 * - IDEMPOTENT: every insert is ON CONFLICT DO NOTHING on the primary key or a
 *   natural unique key, so re-runs are no-ops. --reset truncates all seeded
 *   tables in FK-safe order first.
 * - SAFE: refuses non-localhost DATABASE_URL unless --allow-remote is passed.
 * - COHERENT: disputes follow the legal 19-step IDR FSM
 *   (server/workflow/idr-workflow.ts) with matching status/step pairs,
 *   timeline events, offers, determinations, appeals, balanced double-entry
 *   ledger rows, settlement transfers, and hash-chained FSM/submission logs.
 *
 * The legacy scripts/seed.mjs remains untouched and can still be run
 * afterwards; its rows use different ID shapes and do not conflict.
 */
import postgres from "postgres";
import { createHash } from "crypto";

// ─── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function argVal(flag: string): string | null {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] ?? null : null;
}
const hasFlag = (f: string) => args.includes(f);
const SCALE = (argVal("--scale") ?? "medium") as "small" | "medium" | "large";
const SEED = Number(argVal("--seed") ?? "42");
const RESET = hasFlag("--reset");
const ALLOW_REMOTE = hasFlag("--allow-remote");
const SCALES = { small: 12, medium: 60, large: 300 };
const DISPUTE_COUNT = SCALES[SCALE];
if (!DISPUTE_COUNT) {
  console.error(`Unknown --scale ${SCALE} (expected small|medium|large)`);
  process.exit(1);
}

const DB_URL = process.env.DATABASE_URL ?? process.env.EXTERNAL_POSTGRES_URL;
if (!DB_URL) {
  console.error("DATABASE_URL (or EXTERNAL_POSTGRES_URL) must be set.");
  process.exit(1);
}
let parsedUrl: URL;
try {
  parsedUrl = new URL(DB_URL);
} catch {
  console.error("DATABASE_URL is not a valid URL.");
  process.exit(1);
}
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
if (!ALLOW_REMOTE && !LOCAL_HOSTS.has(parsedUrl.hostname)) {
  console.error(
    `Refusing to seed non-local database host "${parsedUrl.hostname}". ` +
      `Pass --allow-remote if you really mean it.`
  );
  process.exit(1);
}

const sql = postgres(DB_URL, { max: 4 });

// ─── Deterministic PRNG ───────────────────────────────────────────────────────
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const chance = (p: number) => rand() < p;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// Deterministic time: everything is anchored to a fixed epoch so reruns with
// the same seed produce byte-identical timestamps.
const EPOCH = Date.UTC(2026, 8, 5, 12, 0, 0); // 2026-09-05T12:00:00Z anchor
const dayMs = 86400000;
const daysBefore = (n: number) => new Date(EPOCH - n * dayMs);
const daysAfter = (n: number) => new Date(EPOCH + n * dayMs);

const FEDERAL_HOLIDAYS = new Set([
  "2025-01-01","2025-01-20","2025-02-17","2025-05-26","2025-06-19","2025-07-04",
  "2025-09-01","2025-10-13","2025-11-11","2025-11-27","2025-12-25",
  "2026-01-01","2026-01-19","2026-02-16","2026-05-25","2026-06-19","2026-07-04",
  "2026-09-07","2026-10-12","2026-11-11","2026-11-26","2026-12-25",
]);
function addBusinessDays(date: Date, days: number): Date {
  const d = new Date(date);
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !FEDERAL_HOLIDAYS.has(iso)) added++;
  }
  return d;
}

// ─── Realistic reference data ─────────────────────────────────────────────────
const FIRST = ["James","Maria","Robert","Linda","Michael","Sarah","David","Jennifer","William","Emily","Thomas","Jessica","Daniel","Ashley","Kevin","Amanda","Brian","Stephanie","Jason","Rachel","Mark","Laura","Steven","Nicole","Paul","Kimberly","Andrew","Michelle","Joshua","Heather","Ryan","Megan","Eric","Lauren","Scott","Christina","Adam","Rebecca","Joseph","Amy","Nathan","Angela","Tyler","Samantha","Carlos","Diana","Priya","Wei","Omar","Fatima"];
const LAST = ["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Rodriguez","Martinez","Hernandez","Lopez","Gonzalez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin","Lee","Perez","Thompson","White","Harris","Sanchez","Clark","Ramirez","Lewis","Robinson","Walker","Young","Allen","King","Wright","Scott","Torres","Nguyen","Hill","Flores","Green","Adams","Nelson","Baker","Hall","Rivera","Campbell","Mitchell","Carter","Patel","Chen","Kim","Osei","Ali"];
const personName = () => `${pick(FIRST)} ${pick(LAST)}`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ".");
const emailFor = (name: string, domain: string) => `${slug(name)}@${domain}`;
const phone = () => `+1${randInt(200, 989)}${String(randInt(200, 999))}${String(randInt(1000, 9999))}`;

/** NPI: 10 digits, position 1 = 1 or 2, Luhn check digit with 80840 prefix. */
function npi(): string {
  const first9 = [randInt(1, 2), ...Array.from({ length: 8 }, () => randInt(0, 9))];
  const full = "80840" + first9.join("");
  let sum = 0;
  for (let i = 0; i < full.length; i++) {
    let d = Number(full[full.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  const check = (10 - (sum % 10)) % 10;
  return first9.join("") + check;
}
const tin = () => `${randInt(10, 99)}${String(randInt(1000000, 9999999))}`;

const PAYERS = [
  { name: "Aetna (CVS Health)", payerId: "60054" },
  { name: "Cigna Healthcare", payerId: "62308" },
  { name: "UnitedHealthcare", payerId: "87726" },
  { name: "Blue Cross Blue Shield of Texas", payerId: "84980" },
  { name: "Florida Blue (BCBS of Florida)", payerId: "59012" },
  { name: "Blue Shield of California", payerId: "94036" },
  { name: "Humana", payerId: "61101" },
  { name: "Kaiser Permanente", payerId: "94135" },
  { name: "Elevance Health (Anthem)", payerId: "75104" },
  { name: "Centene (Ambetter)", payerId: "68069" },
  { name: "HCSC (BCBS IL/MT/NM/OK)", payerId: "70670" },
  { name: "Highmark Health", payerId: "53286" },
];
const PROVIDERS = [
  { name: "Houston Methodist Hospital", type: "facility", state: "TX" },
  { name: "HCA Florida Kendall Hospital", type: "facility", state: "FL" },
  { name: "Memorial Hermann Texas Medical Center", type: "facility", state: "TX" },
  { name: "US Anesthesia Partners of Texas", type: "provider", state: "TX" },
  { name: "NorthStar Anesthesia of Florida", type: "provider", state: "FL" },
  { name: "TeamHealth Emergency Medicine - West", type: "provider", state: "CA" },
  { name: "Envision Physician Services - Southeast", type: "provider", state: "FL" },
  { name: "Radiology Partners of Southern California", type: "provider", state: "CA" },
  { name: "Lone Star Surgical Center (ASC)", type: "facility", state: "TX" },
  { name: "Bayshore Ambulatory Surgery Center", type: "facility", state: "FL" },
  { name: "Golden State Pathology Group", type: "provider", state: "CA" },
  { name: "Sunshine Neonatology Associates", type: "provider", state: "FL" },
];
// Federal IDR applies in states without a specified state process for the
// relevant items/services. Map states to their IDR regime.
const STATE_IDR: Record<string, string> = {
  TX: "specified_state", // Texas has a specified state law (SB 1264)
  FL: "federal",
  CA: "specified_state", // California AB 72
  NY: "specified_state",
  GA: "federal",
  OH: "federal",
};
const STATES = Object.keys(STATE_IDR);

const CPT_BOOK: Array<{ cpt: string; desc: string; serviceType: string; p50: number }> = [
  { cpt: "99284", desc: "ED visit, level 4 (high complexity)", serviceType: "emergency_medicine", p50: 42000 },
  { cpt: "99285", desc: "ED visit, level 5 (critical)", serviceType: "emergency_medicine", p50: 68500 },
  { cpt: "99291", desc: "Critical care, first 30-74 min", serviceType: "intensivist", p50: 95000 },
  { cpt: "00142", desc: "Anesthesia for lens surgery", serviceType: "anesthesiology", p50: 55000 },
  { cpt: "00790", desc: "Anesthesia, upper GI endoscopy", serviceType: "anesthesiology", p50: 48000 },
  { cpt: "29881", desc: "Knee arthroscopy with meniscectomy", serviceType: "other", p50: 210000 },
  { cpt: "27447", desc: "Total knee arthroplasty", serviceType: "other", p50: 340000 },
  { cpt: "70450", desc: "CT head without contrast", serviceType: "radiology", p50: 28000 },
  { cpt: "74177", desc: "CT abdomen/pelvis with contrast", serviceType: "radiology", p50: 52000 },
  { cpt: "88305", desc: "Surgical pathology, level IV", serviceType: "pathology", p50: 14500 },
  { cpt: "85025", desc: "Complete blood count, automated", serviceType: "pathology", p50: 1200 },
  { cpt: "99468", desc: "Initial inpatient neonatal critical care", serviceType: "neonatology", p50: 185000 },
  { cpt: "99233", desc: "Subsequent hospital care, high complexity", serviceType: "hospitalist", p50: 21000 },
  { cpt: "A0430", desc: "Air ambulance transport, fixed wing", serviceType: "air_ambulance", p50: 3650000 },
  { cpt: "A0429", desc: "Ground ambulance, BLS emergency", serviceType: "ground_ambulance", p50: 98000 },
  { cpt: "31500", desc: "Emergency endotracheal intubation", serviceType: "emergency_medicine", p50: 26000 },
];
const ICD10 = ["M54.5","S83.511A","N39.0","K35.80","I10","E11.9","J06.9","R07.9","S72.001A","J18.9","O80","Z23","R10.9","G43.909","F41.9"];

const IDRE_NAMES = [
  "American Arbitration Association - Healthcare",
  "JAMS Health Care Dispute Resolution",
  "National Arbitration and Mediation (NAM)",
  "CPR Institute for Dispute Resolution",
  "Maximus Federal IDR Services",
  "FMC Health Advocates",
  "MPAS Medical Review Services",
  "Lone Star IDR Solutions",
];

// ─── 19-step FSM mapping (mirrors server/workflow/idr-workflow.ts) ───────────
const MAIN_PATH = [
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
] as const;
function statusForStep(step: string): string {
  if (step === "STEP_17_DISPUTE_CLOSED") return "closed";
  if (step.startsWith("STEP_18") || step.startsWith("STEP_19")) return "appealed";
  if (step === "STEP_13_DETERMINATION_ISSUED") return "determination_issued";
  if (["STEP_14_PAYMENT_DETERMINATION","STEP_15_PAYMENT_MADE","STEP_16_ADMINISTRATIVE_FEE_PAID"].includes(step)) return "payment_pending";
  if (["STEP_09_OFFER_SUBMISSION","STEP_10_QPA_DISCLOSURE","STEP_11_ADDITIONAL_INFORMATION","STEP_12_ARBITRATION_REVIEW"].includes(step)) return "under_arbitration";
  if (step === "STEP_08_ELIGIBILITY_REVIEW") return "eligibility_review";
  if (["STEP_06_IDR_ENTITY_SELECTION","STEP_07_IDR_ENTITY_SELECTED"].includes(step)) return "idr_entity_selection";
  if (["STEP_03_OPEN_NEGOTIATION_FAILED","STEP_04_IDR_INITIATED","STEP_05_IDR_NOTICE_SENT"].includes(step)) return "idr_initiated";
  return "open_negotiation";
}

// ─── Insert helper ────────────────────────────────────────────────────────────
const counts: Record<string, number> = {};
async function seedTable(
  table: string,
  cols: string[],
  rows: unknown[][],
  conflict: string
) {
  if (!rows.length) {
    counts[table] = 0;
    return;
  }
  let inserted = 0;
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const colList = cols.map((c) => `"${c}"`).join(", ");
    const valuesSql = chunk
      .map(
        (row) =>
          "(" +
          row
            .map((v) => {
              if (v === null || v === undefined) return "NULL";
              if (v instanceof Date) return sqlEsc(v.toISOString());
              if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
              if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
              if (typeof v === "object") return sqlEsc(JSON.stringify(v)) + "::jsonb";
              return sqlEsc(String(v));
            })
            .join(", ") +
          ")"
      )
      .join(", ");
    const q = `INSERT INTO "${table}" (${colList}) VALUES ${valuesSql} ON CONFLICT ${conflict} DO NOTHING`;
    const res = await sql.unsafe(q);
    inserted += res.count ?? 0;
  }
  counts[table] = inserted;
}
function sqlEsc(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

// FK-safe truncation order: children first, then parents.
const TRUNCATE_ORDER = [
  "webhook_deliveries","settlement_exception_reviews","settlement_reconciliations","settlement_provider_reports",
  "settlement_callbacks","settlement_approvals","settlement_transfers","settlement_balance_proofs","settlement_job_configs",
  "ledger_entries","ledger_accounts","event_log","idr_fee_assessments","idr_deadline_events","idr_attestations",
  "fsm_case_idempotency","fsm_case_events","fsm_cases",
  "submission_automation_idempotency","submission_automation_events","submission_automation_submissions",
  "qpa_contracted_rates","qpa_ingestion_batches","qpa_cpi_factors","qpa_benchmarks","qpa_state_modifiers",
  "uscdi_data_elements","fhir_resource_cache","davinci_transactions","cds_hooks","bulk_fhir_export_jobs",
  "smart_tokens","fhir_capability_statements","emr_sync_logs","emr_connections",
  "smart_form_extractions","document_versions","document_expiry_alerts","document_analyses",
  "dispute_watchlist","dispute_templates","dispute_offers","dispute_narratives","dispute_escalations",
  "dispute_drafts","dispute_documents","dispute_events","dispute_comments","dispute_appeals","dispute_access",
  "compliance_checks","cms_drafts","notifications","outcome_predictions","sla_breaches","hermes_insights",
  "hermes_jobs","hermes_chat_messages","hermes_regulatory_entries","step_notes","disputes",
  "push_subscriptions","api_keys","totp_secrets","email_digest_preferences","org_settings","user_profiles",
  "marketing_leads","provider_sandbox_acceptances","payer_contacts","expert_panel","regulatory_updates",
  "changelog_entries","audit_log","reconciliation_runs","webhooks","idr_entities","idr_fee_schedules","users",
];

async function main() {
  console.log(`Seeding ${DB_URL.replace(/\/\/[^@]*@/, "//***@")} scale=${SCALE} (${DISPUTE_COUNT} disputes) seed=${SEED} reset=${RESET}`);

  if (RESET) {
    for (const t of TRUNCATE_ORDER) {
      await sql.unsafe(`TRUNCATE TABLE "${t}" CASCADE`);
    }
    console.log(`--reset: truncated ${TRUNCATE_ORDER.length} tables`);
  }

  // ═══ Users ═══════════════════════════════════════════════════════════════
  const userCount = SCALE === "small" ? 6 : SCALE === "medium" ? 18 : 40;
  const users: Array<{ id: string; name: string; email: string; role: string; org: string; stakeholder: string }> = [];
  const orgs = [...PAYERS.map((p) => ({ n: p.name, s: "payer" })), ...PROVIDERS.map((p) => ({ n: p.name, s: p.type === "facility" ? "facility" : "provider" })), ...IDRE_NAMES.map((n) => ({ n, s: "idr_entity" }))];
  users.push({ id: "usr_admin_0001", name: "HealthPoint Platform Admin", email: "admin@healthpoint.example.com", role: "admin", org: "HealthPoint", stakeholder: "other" });
  for (let i = 1; i <= userCount; i++) {
    const org = orgs[i % orgs.length];
    const name = personName();
    users.push({
      id: `usr_${String(i).padStart(4, "0")}`,
      name,
      email: emailFor(name, slug(org.n).replace(/\./g, "") + ".example.com"),
      role: "user",
      org: org.n,
      stakeholder: org.s,
    });
  }
  await seedTable("users", ["id","name","email","passwordHash","loginMethod","role","createdAt","lastSignedIn"],
    users.map((u, i) => [u.id, u.name, u.email, sha256("password:" + u.id), "password", u.role, daysBefore(180 - i), daysBefore(randInt(0, 20))]),
    `("id")`);
  await seedTable("user_profiles", ["id","orgName","orgType","stakeholderRole","npi","taxId","phone","preferredContact","onboardingCompleted","onboardingCompletedAt","createdAt","updatedAt"],
    users.map((u, i) => [u.id, u.org, u.stakeholder, u.stakeholder === "idr_entity" ? "idr_entity" : u.stakeholder, npi(), tin(), phone(), "email", true, daysBefore(170 - i), daysBefore(180 - i), daysBefore(2)]),
    `("id")`);
  await seedTable("org_settings", ["id","userId","orgName","timezone","dateFormat","defaultPageSize","emailDeadlineWarning","emailStepAdvanced","emailDetermination","inAppNotifications","deadlineWarningDays","sessionTimeoutMinutes","requireMFA","auditAllActions","ipAllowlist","retentionDays","autoExportEnabled","exportFormat","updatedAt"],
    users.map((u) => [`orgs_${u.id}`, u.id, u.org, pick(["America/New_York","America/Chicago","America/Los_Angeles","America/Denver"]), "MM/DD/YYYY", 25, true, true, true, true, 3, 30, chance(0.4), true, null, 2555, chance(0.2), "csv", daysBefore(5)]),
    `("userId")`);
  await seedTable("email_digest_preferences", ["id","userId","digestFrequency","notifyOnNewDispute","notifyOnStatusChange","notifyOnDeadlineApproach","notifyOnDetermination","notifyOnSLABreach","digestTime","digestDayOfWeek","updatedAt","createdAt"],
    users.map((u) => [`edp_${u.id}`, u.id, pick(["daily","weekly","never"]), true, true, true, true, true, "08:00", 1, daysBefore(3), daysBefore(150)]),
    `("userId")`);
  await seedTable("api_keys", ["id","userId","name","keyHash","keyPrefix","scopes","lastUsedAt","expiresAt","revokedAt","createdAt"],
    users.slice(0, Math.ceil(users.length / 2)).map((u, i) => [`key_${String(i).padStart(4, "0")}`, u.id, "CI integration key", sha256("hpkey:" + u.id), "hpk_" + sha256(u.id).slice(0, 4), pick(["read","read,write","read,write,admin"]), daysBefore(randInt(1, 30)), daysAfter(365), null, daysBefore(120)]),
    `("id")`);
  await seedTable("totp_secrets", ["id","userId","secret","status","backupCodes","usedBackupCodes","enabledAt","disabledAt","createdAt","updatedAt"],
    users.filter(() => chance(0.5)).map((u) => [`totp_${u.id}`, u.id, "JBSWY3DPEHPK3PXP" + sha256(u.id).slice(0, 8).toUpperCase(), "active", JSON.stringify(Array.from({ length: 8 }, (_, j) => sha256(u.id + j).slice(0, 12))), "[]", daysBefore(90), null, daysBefore(100), daysBefore(10)]),
    `("userId")`);
  await seedTable("push_subscriptions", ["id","userId","endpoint","p256dh","auth","createdAt","updatedAt"],
    users.filter((_, i) => i % 3 === 0).map((u, i) => [`push_${String(i).padStart(4, "0")}`, u.id, `https://fcm.googleapis.com/fcm/send/${sha256(u.id + "ep").slice(0, 22)}`, "B" + Buffer.from(sha256(u.id + "p256"), "hex").toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 87), Buffer.from(sha256(u.id + "auth"), "hex").toString("base64").slice(0, 22), daysBefore(60), daysBefore(1)]),
    `("userId", "endpoint")`);

  // ═══ IDR Entities ════════════════════════════════════════════════════════
  const idres = IDRE_NAMES.map((name, i) => ({
    id: `idre_${String(i + 1).padStart(3, "0")}`,
    name,
    cert: `IDRE-2025-${String(1000 + i)}`,
  }));
  await seedTable("idr_entities", ["id","name","certificationNumber","certificationExpiry","specialties","states","contactEmail","contactPhone","website","avgResolutionDays","totalCasesHandled","maxConcurrentCases","currentActiveCases","isActive","createdAt"],
    idres.map((e) => [e.id, e.name, e.cert, daysAfter(randInt(200, 700)), JSON.stringify(pick([["anesthesiology","emergency_medicine"],["radiology","pathology"],["emergency_medicine","hospitalist"],["air_ambulance"]])), JSON.stringify(STATES), emailFor("intake", slug(e.name).replace(/\./g, "") + ".example.com"), phone(), `https://${slug(e.name).replace(/\./g, "")}.example.com`, randInt(28, 45), randInt(400, 9000), 50, randInt(2, 30), true, daysBefore(300)]),
    `("id")`);

  // ═══ QPA reference data ══════════════════════════════════════════════════
  await seedTable("qpa_benchmarks", ["id","cptCode","description","specialty","p50National","p75National","p90National","effectiveYear","source","notes","createdAt","updatedAt"],
    CPT_BOOK.map((c, i) => [`qpa_bmk_${String(i).padStart(3, "0")}`, c.cpt, c.desc, c.serviceType, c.p50, Math.round(c.p50 * 1.35), Math.round(c.p50 * 1.9), 2025, "CMS NSA Reference", "2025 median contracted rate, national", daysBefore(250), daysBefore(250)]),
    `("id")`);
  const ALL_STATE_CODES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];
  await seedTable("qpa_state_modifiers", ["id","stateCode","modifier","effectiveYear","createdAt"],
    ALL_STATE_CODES.map((s) => [`qpa_sm_${s}`, s, (0.78 + (ALL_STATE_CODES.indexOf(s) % 23) * 0.031).toFixed(2), 2025, daysBefore(250)]),
    `("stateCode")`);
  await seedTable("qpa_cpi_factors", ["year","factor","publicationRef","createdAt"],
    [
      [2019, "1.0000000000", "45 CFR 149.140(c)(1) baseline"],
      [2020, "1.0120000000", "IRS Rev. Proc. 2020-36"],
      [2021, "1.0250000000", "IRS Rev. Proc. 2021-25"],
      [2022, "1.0390000000", "IRS Rev. Proc. 2022-24"],
      [2023, "1.0640000000", "IRS Rev. Proc. 2023-23"],
      [2024, "1.0930000000", "Departments CY2024 guidance"],
      [2025, "1.1210000000", "Departments CY2025 guidance"],
      [2026, "1.1490000000", "Departments CY2026 guidance"],
    ].map(([y, f, ref]) => [y, f, ref, daysBefore(200)]),
    `("year")`);
  // QPA contracted rates: one ingestion batch per payer, rows per CPT/state.
  const rateRows: unknown[][] = [];
  const batchRows: unknown[][] = [];
  PAYERS.forEach((payer, bi) => {
    const batchId = `qpa_batch_${String(bi).padStart(3, "0")}`;
    const contentHash = sha256(`batch:${payer.payerId}:${SEED}`);
    let accepted = 0;
    for (const cpt of CPT_BOOK) {
      for (const st of STATES) {
        const modifier = 0.78 + (ALL_STATE_CODES.indexOf(st) % 23) * 0.031;
        const rateCents = Math.round(cpt.p50 * modifier * (0.9 + rand() * 0.2));
        const rowHash = sha256(`${payer.payerId}|${cpt.cpt}|${st}|${rateCents}|2025-01-01`);
        rateRows.push([
          `${batchId}:${rowHash.slice(0, 24)}`, batchId, payer.payerId, cpt.cpt,
          pick(["individual","small_group","large_group","self_funded"]),
          `${st}-remainder`, rateCents, pick(["FFS","FFS","case_rate"]), "2025-01-01",
          null, null, (rand() * 100).toFixed(2), rowHash,
          JSON.stringify({ source: "TIC_MRF", mrfUrl: `https://mrf.${slug(payer.name).replace(/\./g, "")}.example.com/in-network-rates.json`, importedBy: "seed-all" }),
          daysBefore(150),
        ]);
        accepted++;
      }
    }
    batchRows.push([batchId, contentHash, "TIC_MRF", `mrf://${payer.payerId}/2025-Q1`, "2026-03-15", accepted, accepted, 0, daysBefore(150)]);
  });
  await seedTable("qpa_ingestion_batches", ["batchId","contentHash","sourceType","sourceRef","importedAt","totalRows","acceptedRows","rejectedRows","createdAt"], batchRows, `("batchId")`);
  await seedTable("qpa_contracted_rates", ["id","batchId","payerId","serviceCode","market","region","contractedRateCents","arrangementType","effectiveDate","underlyingFeeScheduleCents","derivedAmountCents","claimsSharePercent","rowHash","provenance","createdAt"], rateRows, `("rowHash")`);

  // ═══ Static-ish reference tables ═════════════════════════════════════════
  await seedTable("regulatory_updates", ["id","publishedAt","title","summary","category","impactLevel","source","sourceUrl","tags","isActive","createdAt"],
    [
      ["reg_001", daysBefore(300), "CMS publishes CY2025 IDR administrative fee", "The Departments set the 2025 administrative fee and certified IDR entity fee ranges under 45 CFR 149.510(d).", "fee_schedule", "high", "CMS", "https://www.cms.gov/nosa-idr", JSON.stringify(["fees","2025"]), true, daysBefore(300)],
      ["reg_002", daysBefore(240), "TMA IV ruling vacates portions of 2022 final rules", "U.S. District Court (E.D. Tex.) vacates QPA-presumption provisions; batching rules updated.", "court_ruling", "critical", "E.D. Tex.", "https://www.courtlistener.com/", JSON.stringify(["TMA","litigation"]), true, daysBefore(240)],
      ["reg_003", daysBefore(180), "Federal IDR portal batching functionality guidance", "CMS technical guidance on batched dispute submission requirements (25 line items).", "guidance", "medium", "CMS", "https://www.cms.gov/nosa-idr", JSON.stringify(["batching","portal"]), true, daysBefore(180)],
      ["reg_004", daysBefore(90), "New certified IDR entities announced for 2026", "The Departments certified additional IDR entities and updated state availability.", "certification", "medium", "HHS", null, JSON.stringify(["certification"]), true, daysBefore(90)],
      ["reg_005", daysBefore(30), "Proposed rule: IDR operations improvements", "NPRM proposes shorter determination timelines and expanded data reporting.", "regulation", "high", "Federal Register", "https://www.federalregister.gov/", JSON.stringify(["NPRM"]), true, daysBefore(30)],
    ],
    `("id")`);
  await seedTable("expert_panel", ["id","name","credentials","specialty","yearsExperience","casesHandled","successRate","avgResponseHours","availability","bio","isActive","createdAt","updatedAt"],
    Array.from({ length: 10 }, (_, i) => {
      const name = personName();
      return [`exp_${String(i).padStart(3, "0")}`, name, pick(["MD, FAAEM","MD, FASA","RN, BSN, JD","MD, FACEP","MD, MHA"]), pick(["emergency_medicine","anesthesiology","radiology","pathology","hospitalist","air_ambulance","general"]), randInt(8, 30), randInt(50, 900), `${randInt(78, 97)}%`, randInt(8, 48), pick(["available","available","busy"]), `Certified IDR reviewer with ${randInt(8, 30)} years of clinical and claims experience.`, true, daysBefore(200), daysBefore(10)];
    }),
    `("id")`);
  await seedTable("changelog_entries", ["id","version","releasedAt","title","description","category","isHighlight","createdAt"],
    [
      ["chg_001","2.4.0", daysBefore(120),"Settlement reconciliation dashboard","Adds daily balance proofs and exception review workflow.","feature",true, daysBefore(120)],
      ["chg_002","2.4.1", daysBefore(100),"Fix deadline computation across DST boundary","Business-day math now uses UTC-safe arithmetic.","bugfix",false, daysBefore(100)],
      ["chg_003","2.5.0", daysBefore(60),"FSM case persistence (notice-consent, priorauth, GFE/PPDR)","Server-authoritative FSM cases with hash-chained event log.","security",true, daysBefore(60)],
      ["chg_004","2.5.1", daysBefore(20),"QPA engine CPI factors through 2026","Adds effective-dated CPI-U factors for QPA trending.","improvement",false, daysBefore(20)],
    ],
    `("id")`);
  await seedTable("payer_contacts", ["id","payerName","payerId","contactName","contactTitle","email","phone","fax","address","idrPortalUrl","notes","createdBy","createdAt","updatedAt"],
    PAYERS.map((p, i) => {
      const cn = personName();
      return [`pcon_${String(i).padStart(3, "0")}`, p.name, p.payerId, cn, pick(["IDR Coordinator","Provider Dispute Manager","OON Claims Supervisor"]), emailFor(cn, slug(p.name).replace(/\./g, "") + ".example.com"), phone(), phone(), `${randInt(100, 9999)} ${pick(["Main St","Commerce Blvd","Health Park Dr","Market St"])}, ${pick(["Hartford, CT","Bloomfield, CT","Minnetonka, MN","Louisville, KY"])}`, `https://idrportal.${slug(p.name).replace(/\./g, "")}.example.com`, "Preferred contact for federal IDR initiation notices.", users[0].id, daysBefore(160), daysBefore(15)];
    }),
    `("id")`);
  await seedTable("provider_sandbox_acceptances", ["id","providerName","sandboxBaseUrl","providerReference","mtlsEvidenceState","reconciliationEvidenceState","bilateralAttestationReference","evidenceNotes","status","submittedBy","submittedAt","updatedAt"],
    PROVIDERS.slice(0, 6).map((p, i) => [`psa_${String(i).padStart(3, "0")}`, p.name, `https://sandbox.${slug(p.name).replace(/\./g, "")}.example.com/fhir`, `PRV-${1000 + i}`, pick(["verified","verified","pending"]), pick(["verified","pending"]), `ATT-2026-${100 + i}`, "Sandbox acceptance evidence collected via mutual TLS handshake capture.", pick(["submitted","approved","draft"]), users[0].id, daysBefore(40), daysBefore(2)]),
    `("id")`);
  await seedTable("marketing_leads", ["id","firstName","lastName","email","orgName","orgType","stakeholderRole","phone","message","source","utmSource","utmMedium","utmCampaign","status","convertedUserId","notes","createdAt","updatedAt"],
    Array.from({ length: SCALE === "small" ? 5 : 15 }, (_, i) => {
      const fn = pick(FIRST), ln = pick(LAST);
      const org = pick([...PAYERS.map((p) => p.name), ...PROVIDERS.map((p) => p.name)]);
      return [`lead_${String(i).padStart(4, "0")}`, fn, ln, emailFor(`${fn} ${ln}`, "example.org"), org, pick(["facility","provider","payer"]), pick(["provider","billing","revenue_cycle","payer_ops"]), phone(), "Interested in IDR workflow automation demo.", "landing_page", pick(["google","linkedin","newsletter", null]), pick(["cpc","social","email", null]), pick(["idr_launch_2026","nsa_webinar", null]), pick(["new","contacted","qualified","converted"]), null, null, daysBefore(randInt(5, 90)), daysBefore(randInt(0, 4))];
    }),
    `("id")`);
  await seedTable("settlement_job_configs", ["id","name","cronExpression","scheduleCronTaskUid","isEnabled","createdAt","updatedAt"],
    [
      ["sjc_daily_recon","daily-settlement-reconciliation","0 6 * * *", null, true, daysBefore(120), daysBefore(5)],
      ["sjc_deadline_check","idr-deadline-escalation","*/15 * * * *", null, true, daysBefore(120), daysBefore(5)],
    ],
    `("name")`);
  await seedTable("idr_fee_schedules", ["id","effectiveFrom","effectiveTo","adminFeeCents","idreFeeSingleMinCents","idreFeeSingleMaxCents","idreFeeBatchedMinCents","idreFeeBatchedMaxCents","batchingMaxLineItems","currency","source","notes","createdBy","createdAt"],
    [
      ["ifs_2024", daysBefore(600), daysBefore(365), 11500, 20000, 84000, 26800, 121700, 25, "USD", "CMS calendar-year 2024 guidance", "Pre-TMA IV fee schedule.", users[0].id, daysBefore(600)],
      ["ifs_2025", daysBefore(365), null, 11500, 20000, 84000, 26800, 121700, 25, "USD", "CMS calendar-year 2025 guidance", "Currently in effect.", users[0].id, daysBefore(365)],
    ],
    `("id")`);

  console.log("Reference data seeded. Generating disputes...");

  // ═══ Disputes + the relational universe around them ═══════════════════════
  const disputeRows: unknown[][] = [];
  const eventRows: unknown[][] = [];
  const offerRows: unknown[][] = [];
  const docRows: unknown[][] = [];
  const docVersionRows: unknown[][] = [];
  const docExpiryRows: unknown[][] = [];
  const notifRows: unknown[][] = [];
  const commentRows: unknown[][] = [];
  const stepNoteRows: unknown[][] = [];
  const watchRows: unknown[][] = [];
  const accessRows: unknown[][] = [];
  const appealRows: unknown[][] = [];
  const escalationRows: unknown[][] = [];
  const slaRows: unknown[][] = [];
  const predictionRows: unknown[][] = [];
  const narrativeRows: unknown[][] = [];
  const ledgerAcctRows: unknown[][] = [];
  const ledgerEntryRows: unknown[][] = [];
  const transferRows: unknown[][] = [];
  const approvalRows: unknown[][] = [];
  const callbackRows: unknown[][] = [];
  const providerReportRows: unknown[][] = [];
  const reconRows: unknown[][] = [];
  const exceptionReviewRows: unknown[][] = [];
  const cmsDraftRows: unknown[][] = [];
  const deadlineRows: unknown[][] = [];
  const feeAssessmentRows: unknown[][] = [];
  const attestationRows: unknown[][] = [];
  const complianceRows: unknown[][] = [];
  const uscdiRows: unknown[][] = [];
  const hermesJobRows: unknown[][] = [];
  const hermesInsightRows: unknown[][] = [];
  const eventLogRows: unknown[][] = [];
  const auditRows: unknown[][] = [];
  const saSubRows: unknown[][] = [];
  const saEventRows: unknown[][] = [];
  const saIdemRows: unknown[][] = [];
  const fsmCaseRows: unknown[][] = [];
  const fsmEventRows: unknown[][] = [];
  const fsmIdemRows: unknown[][] = [];
  const smartFormRows: unknown[][] = [];
  const davinciRows: unknown[][] = [];

  const providerUsers = users.filter((u) => u.stakeholder === "provider" || u.stakeholder === "facility");
  const admin = users[0];

  for (let i = 0; i < DISPUTE_COUNT; i++) {
    const id = `dsp_${String(i + 1).padStart(5, "0")}`;
    const ref = `HP-2025-${String(100000 + i)}`;
    const payer = pick(PAYERS);
    const provider = pick(PROVIDERS);
    const state = provider.state;
    const cptEntry = pick(CPT_BOOK);
    const stateMod = 0.78 + (ALL_STATE_CODES.indexOf(state) % 23) * 0.031;
    const qpa = Math.round(cptEntry.p50 * stateMod);
    const billed = Math.round(qpa * (1.6 + rand() * 2.4));
    const serviceDate = daysBefore(randInt(60, 300));
    const creator = providerUsers[i % providerUsers.length] ?? users[1];

    // Choose target step. Distribution biased toward mid/late lifecycle.
    const roll = rand();
    let targetIdx: number;
    let appealed = false;
    if (roll < 0.10) targetIdx = randInt(0, 1);        // ON initiated / period
    else if (roll < 0.18) targetIdx = 2;               // ON failed
    else if (roll < 0.30) targetIdx = randInt(3, 5);   // IDR initiated..entity selection
    else if (roll < 0.40) targetIdx = randInt(6, 7);   // selected / eligibility
    else if (roll < 0.55) targetIdx = randInt(8, 11);  // offers..arbitration
    else if (roll < 0.70) targetIdx = 12;              // determination issued
    else if (roll < 0.85) targetIdx = randInt(13, 16); // payment..closed
    else { targetIdx = 12; appealed = true; }          // appeal path
    // Some ineligible disputes stop at eligibility review.
    const ineligible = !appealed && targetIdx >= 7 && chance(0.08);
    if (ineligible) targetIdx = 7;

    const currentStep = appealed ? (chance(0.5) ? "STEP_18_APPEAL_FILED" : "STEP_19_APPEAL_RESOLVED") : MAIN_PATH[targetIdx];
    const status = ineligible ? "ineligible" : statusForStep(currentStep);
    const idre = targetIdx >= 6 ? idres[randInt(0, idres.length - 1)] : null;

    // Timeline: walk main path up to targetIdx, spacing events by business days.
    let t = new Date(serviceDate.getTime() + randInt(1, 10) * dayMs); // ON notice
    const eventTimes: Date[] = [t];
    for (let s = 1; s <= targetIdx; s++) {
      t = addBusinessDays(t, randInt(1, 4));
      eventTimes.push(t);
    }
    const onDeadline = addBusinessDays(eventTimes[0], 30);
    const idrDeadline = targetIdx >= 3 ? addBusinessDays(eventTimes[2] ?? eventTimes[0], 4) : null;
    const entitySelDeadline = targetIdx >= 6 ? addBusinessDays(eventTimes[4], 3) : null;
    const eligDeadline = targetIdx >= 7 ? addBusinessDays(eventTimes[6], 3) : null;
    const offerDeadline = targetIdx >= 8 ? addBusinessDays(eventTimes[6], 10) : null;
    const addInfoDeadline = targetIdx >= 10 ? addBusinessDays(eventTimes[9], 5) : null;
    const detDeadline = targetIdx >= 12 ? addBusinessDays(eventTimes[6], 30) : null;
    const payDeadline = targetIdx >= 13 ? new Date(eventTimes[12].getTime() + 30 * dayMs) : null;
    const closedAt = status === "closed" ? eventTimes[targetIdx] : null;

    const initOffer = targetIdx >= 8 ? Math.round(billed * (0.75 + rand() * 0.2)) : null;
    const respOffer = targetIdx >= 8 ? Math.round(qpa * (0.95 + rand() * 0.15)) : null;
    const determined = targetIdx >= 12 && !ineligible;
    const detWinner = determined ? (chance(0.55) ? "initiating_party" : "responding_party") : null;
    const detAmount = determined ? (detWinner === "initiating_party" ? initOffer : respOffer) : null;
    const paid = targetIdx >= 14 && detAmount ? detAmount : 0;
    const adminFee = targetIdx >= 3 ? 11500 : null; // cents, but column is numeric dollars... use dollars
    const adminFeeDollars = adminFee ? "115.00" : null;

    disputeRows.push([
      id, ref,
      provider.name.replace(/\W+/g, "_").slice(0, 32), provider.type, provider.name, npi(),
      payer.payerId, "payer", payer.name, null,
      cptEntry.serviceType, serviceDate, state, state,
      JSON.stringify([cptEntry.cpt]), JSON.stringify([pick(ICD10)]),
      billed.toFixed(2), qpa.toFixed(2), initOffer?.toFixed(2) ?? null, respOffer?.toFixed(2) ?? null,
      detAmount?.toFixed(2) ?? null, paid.toFixed(2), adminFeeDollars,
      currentStep, status, idre?.id ?? null, idre?.name ?? null,
      onDeadline, idrDeadline, entitySelDeadline, eligDeadline, offerDeadline, addInfoDeadline, detDeadline, payDeadline,
      ineligible ? false : targetIdx >= 7 ? true : null,
      ineligible ? "Item/service not eligible for federal IDR: state has a specified state process for this market." : null,
      determined ? "IDR entity selected the offer closest to a defensible OON rate given QPA, acuity, and case mix." : null,
      detWinner,
      null, creator.id, eventTimes[0], eventTimes[targetIdx], closedAt,
    ]);

    // Dispute events (full timeline up to current step)
    for (let s = 0; s <= targetIdx; s++) {
      eventRows.push([
        `evt_${id}_${String(s).padStart(2, "0")}`, id, MAIN_PATH[s], s === 0 ? null : MAIN_PATH[s - 1],
        s === 0 ? "dispute_created" : "step_advanced",
        s === 0
          ? `Open negotiation initiated by ${provider.name} against ${payer.name} for ${cptEntry.cpt} (${cptEntry.desc}); billed $${(billed / 100).toFixed(2)}, QPA $${(qpa / 100).toFixed(2)}.`
          : `Advanced to ${MAIN_PATH[s].replace(/STEP_\d+_/, "").replace(/_/g, " ").toLowerCase()}.`,
        creator.id, creator.name, null, eventTimes[s],
      ]);
    }
    if (ineligible) {
      eventRows.push([`evt_${id}_inelig`, id, "STEP_08_ELIGIBILITY_REVIEW", "STEP_08_ELIGIBILITY_REVIEW", "eligibility_denied", "IDR entity determined the dispute ineligible: specified state process applies.", idre?.id ?? "system", idre?.name ?? "System", null, addBusinessDays(eventTimes[targetIdx], 1)]);
    }
    if (appealed) {
      eventRows.push([`evt_${id}_app`, id, "STEP_18_APPEAL_FILED", "STEP_13_DETERMINATION_ISSUED", "appeal_filed", `Appeal of determination filed by ${detWinner === "initiating_party" ? payer.name : provider.name}.`, creator.id, creator.name, null, addBusinessDays(eventTimes[12], 5)]);
      if (currentStep === "STEP_19_APPEAL_RESOLVED") {
        eventRows.push([`evt_${id}_appres`, id, "STEP_19_APPEAL_RESOLVED", "STEP_18_APPEAL_FILED", "appeal_resolved", "Appeal resolved: determination upheld.", creator.id, creator.name, null, addBusinessDays(eventTimes[12], 25)]);
      }
    }

    // Offers
    if (targetIdx >= 8) {
      offerRows.push([`off_${id}_init`, id, "initiating_party", initOffer!.toFixed(2), "Offer based on billed charges, case complexity, and 90th percentile UCR benchmarks.", null, creator.id, eventTimes[8], detWinner === "initiating_party"]);
      offerRows.push([`off_${id}_resp`, id, "responding_party", respOffer!.toFixed(2), "Offer anchored to QPA with market adjustments.", null, payer.payerId, eventTimes[8], detWinner === "responding_party"]);
      offerRows.push([`off_${id}_qpa`, id, "qpa", qpa.toFixed(2), "QPA disclosed by payer per 45 CFR 149.140.", null, payer.payerId, eventTimes[Math.min(9, targetIdx)], false]);
      if (determined) {
        offerRows.push([`off_${id}_det`, id, "determination", detAmount!.toFixed(2), "IDR entity determination.", null, idre?.id ?? null, eventTimes[12], true]);
      }
    }

    // Documents + versions + expiry alerts
    const docTypes = ["eob","itemized_bill","open_negotiation_notice","idr_initiation_form","offer_submission","determination_letter"];
    const docCount = Math.min(docTypes.length, 2 + Math.floor(targetIdx / 3));
    for (let d = 0; d < docCount; d++) {
      const docId = `doc_${id}_${d}`;
      const fn = `${docTypes[d]}_${ref}.pdf`;
      docRows.push([docId, id, docTypes[d], fn, randInt(45000, 2400000), "application/pdf", `s3://healthpoint-docs/${id}/${fn}`, creator.id, eventTimes[Math.min(d, targetIdx)], `${docTypes[d].replace(/_/g, " ")} for ${ref}`]);
      docVersionRows.push([`dv_${docId}_1`, docId, id, 1, `s3://healthpoint-docs/${id}/v1/${fn}`, fn, randInt(45000, 2400000), "application/pdf", creator.id, eventTimes[Math.min(d, targetIdx)], "Initial upload", true]);
      if (d === 0 && chance(0.3)) {
        docExpiryRows.push([`dea_${docId}`, id, docId, fn, daysAfter(randInt(10, 120)), null, false, eventTimes[0]]);
      }
    }

    // Notifications
    for (let s = Math.max(0, targetIdx - 2); s <= targetIdx; s++) {
      notifRows.push([`ntf_${id}_${s}`, id, creator.id, pick(["step_advanced","deadline_approaching","determination_issued"]), `${ref}: ${MAIN_PATH[s].replace(/STEP_\d+_/, "").replace(/_/g, " ")}`, `Dispute ${ref} reached ${MAIN_PATH[s]}.`, s === targetIdx ? addBusinessDays(eventTimes[s], 5) : null, chance(0.6), eventTimes[s]]);
    }

    // Comments, notes, watchlist, access
    if (chance(0.5)) {
      commentRows.push([`cmt_${id}_1`, id, creator.id, creator.name, `QPA of $${(qpa / 100).toFixed(2)} appears low relative to contracted rates for this MSA; requesting rate files.`, null, false, eventTimes[Math.min(2, targetIdx)], eventTimes[Math.min(2, targetIdx)]]);
      if (chance(0.5)) {
        commentRows.push([`cmt_${id}_2`, id, admin.id, admin.name, "Rate files requested from payer via QPA disclosure step.", `cmt_${id}_1`, false, eventTimes[Math.min(3, targetIdx)], eventTimes[Math.min(3, targetIdx)]]);
      }
    }
    if (chance(0.4)) {
      stepNoteRows.push([`sn_${id}_1`, id, MAIN_PATH[targetIdx], creator.id, creator.name, `Working note on ${ref}: payer responsiveness ${pick(["good","slow","average"])}; next action ${pick(["await determination","chase offer","collect documentation"])}.`, "[]", eventTimes[targetIdx], eventTimes[targetIdx]]);
    }
    if (chance(0.35)) {
      watchRows.push([`wl_${id}_${creator.id}`, creator.id, id, "Watching for determination outcome.", true, true, eventTimes[0]]);
    }
    accessRows.push([`acc_${id}_${creator.id}`, id, creator.id, "admin", creator.id, eventTimes[0]]);
    if (chance(0.4)) {
      const other = users[randInt(1, users.length - 1)];
      accessRows.push([`acc_${id}_${other.id}`, id, other.id, pick(["read","write"]), creator.id, eventTimes[Math.min(1, targetIdx)]]);
    }

    // Appeals
    if (appealed) {
      appealRows.push([`apl_${id}`, id, creator.id, creator.name, currentStep === "STEP_19_APPEAL_RESOLVED" ? "denied" : "under_review",
        "Determination failed to give appropriate weight to case complexity and teaching status per 45 CFR 149.510(c)(4)(iii).",
        "Affidavit of attending physician; comparative contracted rate data.",
        `$${(detAmount! / 100).toFixed(2)} to ${detWinner}`,
        currentStep === "STEP_19_APPEAL_RESOLVED" ? "Appeal denied; determination upheld." : null,
        currentStep === "STEP_19_APPEAL_RESOLVED" ? addBusinessDays(eventTimes[12], 25) : null,
        addBusinessDays(eventTimes[12], 5), addBusinessDays(eventTimes[12], 5), eventTimes[targetIdx]]);
    }

    // Escalations & SLA breaches
    if (chance(0.12)) {
      escalationRows.push([`esc_${id}`, id, creator.id, creator.name, admin.id, pick(["medium","high","critical"]), pick(["open","in_review","resolved"]), `Payer unresponsive during ${MAIN_PATH[targetIdx].replace(/STEP_\d+_/, "").replace(/_/g, " ").toLowerCase()}; escalation requested.`, chance(0.4) ? "Payer contacted; response received within 2 business days." : null, chance(0.4) ? eventTimes[targetIdx] : null, eventTimes[Math.max(0, targetIdx - 1)], eventTimes[targetIdx]]);
    }
    if (targetIdx >= 2 && chance(0.15)) {
      const deadlineDays = pick([30, 4, 3, 10, 30]);
      const actual = deadlineDays + randInt(1, 8);
      slaRows.push([`sla_${id}`, id, MAIN_PATH[randInt(2, targetIdx)], deadlineDays, actual, actual - deadlineDays, eventTimes[targetIdx], chance(0.5) ? eventTimes[targetIdx] : null, actual - deadlineDays > 3 ? "critical" : "warning"]);
    }

    // Outcome prediction + narrative + hermes
    if (targetIdx >= 4) {
      predictionRows.push([`prd_${id}`, id, randInt(35, 85), randInt(60, 95), JSON.stringify(["qpa_gap","specialty","state_regime","payer_history"]), detWinner === "initiating_party" ? "Provider offer likely to prevail; strengthen complexity evidence." : "Consider settling near QPA plus market adjustment.", "v2.1", eventTimes[Math.min(4, targetIdx)], eventTimes[targetIdx]]);
    }
    if (targetIdx >= 8 && chance(0.5)) {
      const content = `Opening statement for ${ref}: ${provider.name} provided ${cptEntry.desc} (${cptEntry.cpt}) on ${serviceDate.toISOString().slice(0, 10)}. The billed amount of $${(billed / 100).toFixed(2)} reflects the acuity and resources required; the payer's QPA of $${(qpa / 100).toFixed(2)} understates market rates in ${state}.`;
      narrativeRows.push([`nar_${id}`, id, creator.id, "opening_statement", content, content.split(/\s+/).length, chance(0.4), chance(0.4) ? admin.id : null, chance(0.4) ? eventTimes[9] : null, eventTimes[8]]);
    }
    if (targetIdx >= 4 && chance(0.5)) {
      const jobId = `hjb_${id}`;
      hermesJobRows.push([jobId, creator.id, id, pick(["narrative_generation","outcome_simulation","risk_scoring"]), "complete", JSON.stringify({ disputeId: id }), "Generated analysis.", null, "gpt-sim-2026", randInt(800, 4200), randInt(200, 1800), randInt(900, 9000), null, eventTimes[4], eventTimes[4], eventTimes[4]]);
      hermesInsightRows.push([`hin_${id}`, id, jobId, "risk_scoring", randInt(20, 80), pick(["low","medium","high"]), JSON.stringify(["payer_history","qpa_gap"]), null, 1, randInt(30, 80), randInt(15, 60), randInt(1, 20), randInt(1, 15), "Simulation over 10k sampled IDR outcomes.", `${payer.name} accepts ~${randInt(20, 70)}% of offers within 1.2x QPA.`, randInt(20, 70), "1.8", idre?.id ?? null, randInt(40, 70), detAmount?.toFixed(2) ?? null, null, null, eventTimes[5] ?? eventTimes[4], null]);
    }

    // CMS drafts
    if (targetIdx >= 4 && chance(0.4)) {
      cmsDraftRows.push([`cms_${id}`, id, creator.id, targetIdx >= 6 ? "submitted" : "draft", !ineligible, ineligible ? "Specified state process applies" : "Eligible for federal IDR", JSON.stringify([]), JSON.stringify(ineligible ? ["State process may apply"] : []), addBusinessDays(eventTimes[2], 4).toISOString().slice(0, 10), JSON.stringify(["45 CFR 149.510"]), JSON.stringify({ disputeId: id, referenceNumber: ref }), JSON.stringify([{ item: "EOB", status: "attached", required: true }, { item: "ON notice proof", status: "attached", required: true }]), `IDRE initiation request for ${ref}.`, null, "Likely eligible; expect entity selection within 3 business days.", JSON.stringify(["Submit via federal portal", "Track entity selection deadline"]), null, "12.40", null, targetIdx >= 6 ? eventTimes[4] : null, eventTimes[3], eventTimes[targetIdx]]);
    }

    // IDR deadline events (statutory ledger)
    const addDeadline = (dtype: string, basis: Date | null, deadline: Date | null, days: number, kind: string, cfr: string, st: string, metAt: Date | null) => {
      if (!deadline) return;
      deadlineRows.push([`idl_${id}_${dtype}`, id, dtype, basis, deadline, days, kind, cfr, st, metAt, null, null, null, eventTimes[0], eventTimes[targetIdx]]);
    };
    addDeadline("open_negotiation_end", eventTimes[0], onDeadline, 30, "business", "45 CFR 149.510(b)(1)", targetIdx >= 2 ? "met" : "open", targetIdx >= 2 ? eventTimes[2] : null);
    if (targetIdx >= 3) addDeadline("idr_initiation_window_end", eventTimes[2], idrDeadline, 4, "business", "45 CFR 149.510(b)(2)(i)", "met", eventTimes[3]);
    if (targetIdx >= 6) addDeadline("idre_selection", eventTimes[4], entitySelDeadline, 3, "business", "45 CFR 149.510(c)(1)", "met", eventTimes[6]);
    if (targetIdx >= 8) addDeadline("offer_submission", eventTimes[6], offerDeadline, 10, "business", "45 CFR 149.510(c)(3)(i)", "met", eventTimes[8]);
    if (targetIdx >= 12) addDeadline("determination_due", eventTimes[6], detDeadline, 30, "business", "45 CFR 149.510(c)(4)(ii)", "met", eventTimes[12]);
    if (targetIdx >= 13) addDeadline("payment_due", eventTimes[12], payDeadline, 30, "calendar", "PHSA 2799A-1(c)(6)", targetIdx >= 14 ? "met" : "open", targetIdx >= 14 ? eventTimes[14] : null);

    // Fee assessments + attestations
    if (targetIdx >= 3) {
      for (const role of ["initiating_party", "responding_party"] as const) {
        feeAssessmentRows.push([`ifa_${id}_${role}`, id, "ifs_2025", "administrative", role, role === "initiating_party" ? provider.name.slice(0, 32) : payer.payerId, 11500, "USD", targetIdx >= 15 ? "paid" : "invoiced", eventTimes[3], "system", eventTimes[4], targetIdx >= 15 ? eventTimes[15] : null, targetIdx >= 15 ? `PAY-${ref}-${role.slice(0, 4).toUpperCase()}` : null, null, `seed:${id}:admin:${role}`, eventTimes[3], eventTimes[targetIdx]]);
      }
      attestationRows.push([`att_${id}_init`, id, "idr_initiation", "initiating_party", creator.id, creator.name, "I attest that the information submitted in this IDR initiation is complete and accurate to the best of my knowledge.", true, true, "active", null, "10.12.8." + randInt(2, 250), "HealthPoint/2.5 (web)", eventTimes[3], eventTimes[3]]);
      if (targetIdx >= 8) {
        attestationRows.push([`att_${id}_offer`, id, "offer_submission", "initiating_party", creator.id, creator.name, "I attest that the offer and supporting information are complete and accurate.", true, true, "active", null, "10.12.8." + randInt(2, 250), "HealthPoint/2.5 (web)", eventTimes[8], eventTimes[8]]);
      }
    }

    // Compliance checks
    if (chance(0.5)) {
      for (const [sec, item] of [["eligibility","open_negotiation_completed"],["submission","idr_notice_within_4bd"],["fees","admin_fee_paid_both_parties"]] as const) {
        complianceRows.push([`cmp_${id}_${item}`, id, creator.id, sec, item, pick(["compliant","compliant","pending_review"]), null, chance(0.7) ? eventTimes[targetIdx] : null, chance(0.7) ? admin.id : null, eventTimes[0], eventTimes[targetIdx]]);
      }
    }

    // USCDI data elements
    if (chance(0.4)) {
      uscdiRows.push([`usd_${id}`, id, null, true, true, chance(0.8), true, true, true, true, true, true, true, true, true, chance(0.6), chance(0.3), randInt(60, 100), JSON.stringify(chance(0.6) ? [] : ["priorAuthNumber"]), eventTimes[targetIdx], eventTimes[0]]);
    }

    // Double-entry ledger for determined disputes
    if (determined && detAmount) {
      const accts = ["billed","allowed","paid","determination","adjustment","patient_responsibility"].map((t) => {
        return { id: `lac_${id}_${t}`, type: t };
      });
      const entries: Array<{ deb: string; cred: string; amt: number; type: string; desc: string; refType: string }> = [
        { deb: "billed", cred: "allowed", amt: billed, type: "debit", desc: "Claim billed by provider", refType: "claim" },
        { deb: "determination", cred: "billed", amt: detAmount, type: "credit", desc: `IDR determination selects ${detWinner} offer`, refType: "determination" },
      ];
      if (paid > 0) {
        entries.push({ deb: "paid", cred: "determination", amt: paid, type: "debit", desc: "Settlement payment evidenced by provider callback", refType: "payment" });
      }
      const balances: Record<string, number> = {};
      for (const e of entries) {
        balances[e.deb] = (balances[e.deb] ?? 0) + e.amt;
        balances[e.cred] = (balances[e.cred] ?? 0) - e.amt;
      }
      for (const a of accts) {
        ledgerAcctRows.push([a.id, id, a.type, balances[a.type] ?? 0, "USD", eventTimes[12], eventTimes[targetIdx]]);
      }
      entries.forEach((e, ei) => {
        ledgerEntryRows.push([`len_${id}_${ei}`, id, `lac_${id}_${e.deb}`, `lac_${id}_${e.cred}`, e.amt, "USD", e.type, e.desc, `off_${id}_det`, e.refType, `seed:${id}:entry:${ei}`, JSON.stringify({ seeded: true }), eventTimes[12]]);
      });
    }

    // Settlement lifecycle for paid (closed) disputes
    if (paid > 0 && detAmount) {
      const transferId = `str_${id}`;
      const providerTransferId = `tr_${sha256(id).slice(0, 20)}`;
      const provider = pick(["stripe","modern_treasury","increase"]);
      const settled = targetIdx >= 15;
      const st = settled ? (targetIdx >= 16 ? "reconciled" : "settled") : "accepted";
      transferRows.push([transferId, id, provider, providerTransferId, paid, "USD", st, admin.id, admin.name, `Settlement of determined amount $${(paid / 100).toFixed(2)} for ${ref}`, `seed:${id}:transfer`, eventTimes[13], eventTimes[14], eventTimes[14], settled ? eventTimes[15] : null, null, null, targetIdx >= 16 ? eventTimes[16] : null, null, null, null, eventTimes[13], eventTimes[targetIdx]]);
      approvalRows.push([`sap_${id}`, transferId, "approved", admin.id, admin.name, "Determination amount matches ledger; approved for submission.", addBusinessDays(eventTimes[13], 5), eventTimes[13], eventTimes[13]]);
      callbackRows.push([`scb_${id}`, provider, `evt_${sha256(id + "cb").slice(0, 20)}`, providerTransferId, id, paid, "USD", "settled", eventTimes[15] ?? eventTimes[14], "v1", JSON.stringify({ type: "transfer.settled", transfer: providerTransferId, amount: paid }), `len_${id}_2`, null, targetIdx >= 16 ? eventTimes[16] : null, eventTimes[15] ?? eventTimes[14]]);
      if (settled) {
        providerReportRows.push([`spr_${id}`, provider, `rpt_${sha256(id + "rpt").slice(0, 20)}`, transferId, providerTransferId, "settled", paid, "USD", eventTimes[16] ?? eventTimes[15], JSON.stringify({ report: "daily", transfer: providerTransferId }), eventTimes[16] ?? eventTimes[15]]);
        const mismatched = chance(0.08);
        reconRows.push([`src_${id}`, transferId, `spr_${id}`, mismatched ? "mismatched" : "matched", paid, mismatched ? paid - 1000 : paid, "settled", "settled", mismatched ? "Reported amount differs by $10.00 (fee netting)." : null, admin.id, eventTimes[16] ?? eventTimes[15], eventTimes[16] ?? eventTimes[15]]);
        if (mismatched) {
          exceptionReviewRows.push([`ser_${id}`, `src_${id}`, chance(0.5) ? "resolved" : "open", "Amount mismatch: provider netted a processing fee.", chance(0.5) ? admin.id : null, chance(0.5) ? admin.name : null, chance(0.5) ? "Accepted fee netting; ledger adjusted via adjustment account." : null, chance(0.5) ? daysBefore(5) : null, eventTimes[16] ?? eventTimes[15]]);
        }
      }
    }

    // Event bus rows (representative)
    eventLogRows.push([`evl_${id}_adv`, "idr.disputes.state_changes", "dispute.advanced", id, "dispute", JSON.stringify({ newStep: currentStep, newStatus: status }), JSON.stringify({ seeded: true }), `seed:${id}:advanced`, "delivered", eventTimes[targetIdx], null, 0, eventTimes[targetIdx], null, eventTimes[targetIdx]]);
    if (chance(0.2)) {
      eventLogRows.push([`evl_${id}_notif`, "idr.notifications.outbound", "notification.queued", id, "dispute", JSON.stringify({ disputeId: id }), null, null, "pending", null, null, 0, null, daysAfter(1), eventTimes[targetIdx]]);
    }

    // Audit log
    auditRows.push([`aud_${id}_create`, creator.id, "dispute.create", "dispute", id, null, JSON.stringify({ referenceNumber: ref }), "10.12.8." + randInt(2, 250), "HealthPoint/2.5 (web)", eventTimes[0]]);
    if (determined) {
      auditRows.push([`aud_${id}_det`, idre?.id ?? "system", "dispute.determination_recorded", "dispute", id, null, JSON.stringify({ determinationAmount: detAmount }), "10.12.8." + randInt(2, 250), "HealthPoint/2.5 (worker)", eventTimes[12]]);
    }

    // Submission automation (assisted-manual portal submissions)
    if (targetIdx >= 4 && chance(0.5)) {
      const subId = `sub_${id}`;
      const tenantId = "tenant_healthpoint";
      const saStates = ["DRAFT","ATTESTED","SUBMITTED","CONFIRMED"];
      const upto = targetIdx >= 6 ? 3 : targetIdx >= 5 ? 2 : 0;
      saSubRows.push([subId, tenantId, id, saStates[Math.min(upto, 3)], upto, targetIdx >= 6 ? `CMS-${ref}` : null, targetIdx >= 5 ? JSON.stringify({ actorId: creator.id, attestedAt: eventTimes[5].toISOString(), portalConfirmationText: "I confirm manual portal submission." }) : null, eventTimes[4], eventTimes[Math.min(6, targetIdx)], null]);
      let prevHash = "0".repeat(64);
      for (let s = 0; s <= upto; s++) {
        const evJson = JSON.stringify({ seq: s, fromState: s === 0 ? null : saStates[s - 1], toState: saStates[s], at: eventTimes[Math.min(4 + s, targetIdx)].toISOString(), actorId: creator.id });
        const h = sha256(prevHash + evJson);
        saEventRows.push([`sae_${subId}_${s}`, subId, tenantId, id, s, s === 0 ? null : saStates[s - 1], saStates[s], eventTimes[Math.min(4 + s, targetIdx)], creator.id, `Submission ${saStates[s].toLowerCase()}`, prevHash, h, eventTimes[Math.min(4 + s, targetIdx)]]);
        prevHash = h;
        saIdemRows.push([`sai_${subId}_${s}`, tenantId, id, `seed:${subId}:${s}`, s === 0 ? "create" : "transition", subId, JSON.stringify({ state: saStates[s], version: s }), eventTimes[Math.min(4 + s, targetIdx)]]);
      }
    }

    // FSM cases (notice-consent / priorauth / gfe-ppdr) with hash-chained events
    if (chance(0.45)) {
      const caseType = pick(["notice-consent","priorauth","gfe-ppdr"]);
      const caseId = `case_${id}`;
      const rowId = `fsm_${id}`;
      const tenantId = "tenant_healthpoint";
      const flows: Record<string, string[]> = {
        "notice-consent": ["DRAFT","NOTICE_SENT","CONSENT_REQUESTED","CONSENT_SIGNED"],
        "priorauth": ["DRAFT","SUBMITTED","PENDED","APPROVED"],
        "gfe-ppdr": ["DRAFT","GFE_SENT","DISPUTE_OPEN","RESOLVED"],
      };
      const states = flows[caseType];
      const upto = randInt(1, states.length - 1);
      const caseJson: Record<string, unknown> = { id: caseId, type: caseType, state: states[upto], disputeId: id, patientRef: `pat_${sha256(id).slice(0, 10)}` };
      fsmCaseRows.push([rowId, tenantId, caseType, caseId, states[upto], upto, JSON.stringify(caseJson), eventTimes[0], eventTimes[Math.min(upto, targetIdx)], null]);
      let prevHash = "0".repeat(64);
      for (let s = 0; s <= upto; s++) {
        const evJson = JSON.stringify({ seq: s, eventType: s === 0 ? "create" : "transition", fromState: s === 0 ? null : states[s - 1], toState: states[s], at: eventTimes[Math.min(s, targetIdx)].toISOString() });
        const h = sha256(prevHash + evJson);
        fsmEventRows.push([`fsme_${rowId}_${s}`, rowId, tenantId, caseType, caseId, s, s === 0 ? "create" : "transition", s === 0 ? null : states[s - 1], states[s], eventTimes[Math.min(s, targetIdx)], null, evJson, prevHash, h, eventTimes[Math.min(s, targetIdx)]]);
        prevHash = h;
        if (s === 0) {
          fsmIdemRows.push([`fsmi_${rowId}_create`, tenantId, caseType, caseId, `seed:${rowId}:create`, "create", JSON.stringify({ state: states[0], version: 0 }), eventTimes[0]]);
        }
      }
    }

    // Smart form extractions / Da Vinci transactions (representative)
    if (chance(0.25)) {
      smartFormRows.push([`sfe_${id}`, creator.id, "dispute", id, "pdf_base64", `EOB for claim ${ref}: billed $${(billed / 100).toFixed(2)}, allowed $${(qpa / 100).toFixed(2)}...`, `eob_${ref}.pdf`, JSON.stringify({ billedAmount: { value: (billed / 100).toFixed(2), confidence: 0.97, source: "page1" }, cptCode: { value: cptEntry.cpt, confidence: 0.99, source: "page1" } }), randInt(80, 99), randInt(8, 20), randInt(6, 16), randInt(0, 3), "complete", null, randInt(800, 6000), "hermes-extract-v3", eventTimes[0], JSON.stringify(["billedAmount","cptCode"]), eventTimes[0]]);
    }
    if (chance(0.2)) {
      davinciRows.push([`dvtx_${id}`, id, null, pick(["pas_prior_auth","pdex_payer_network","hrex_member_match"]), pick(["approved","pended","pending"]), JSON.stringify({ resourceType: "Claim", id: `clm_${sha256(id).slice(0, 10)}` }), chance(0.5) ? JSON.stringify({ outcome: "complete" }) : null, chance(0.4) ? `PA-${randInt(100000, 999999)}` : null, pick(["approved", null]), null, null, randInt(200, 3000), eventTimes[1] ?? eventTimes[0], eventTimes[targetIdx]]);
    }
  }

  // Guarantee at least one settlement exception review when any reconciliation
  // exists: flip the first matched reconciliation to mismatched and add a review.
  if (exceptionReviewRows.length === 0 && reconRows.length > 0) {
    const r = reconRows[0];
    r[3] = "mismatched"; // status
    r[5] = (r[4] as number) - 1500; // reportedAmountCents
    r[8] = "Reported amount differs by $15.00 (provider fee netting).";
    exceptionReviewRows.push(["ser_forced_0001", r[0], "open", "Amount mismatch: provider netted a processing fee.", null, null, null, null, r[11]]);
  }

  // ═══ Bulk inserts ═════════════════════════════════════════════════════════
  await seedTable("disputes",
    ["id","referenceNumber","initiatingPartyId","initiatingPartyType","initiatingPartyName","initiatingPartyNpi","respondingPartyId","respondingPartyType","respondingPartyName","respondingPartyNpi","serviceType","serviceDate","patientState","facilityState","cptCodes","icd10Codes","billedAmount","qpaAmount","initiatingPartyOffer","respondingPartyOffer","determinationAmount","paidAmount","adminFeeAmount","currentStep","status","idrEntityId","idrEntityName","openNegotiationDeadline","idrInitiationDeadline","entitySelectionDeadline","eligibilityDeadline","offerSubmissionDeadline","additionalInfoDeadline","determinationDeadline","paymentDeadline","isEligible","ineligibilityReason","determinationBasis","determinationWinner","notes","createdBy","createdAt","updatedAt","closedAt"],
    disputeRows, `("referenceNumber")`);
  await seedTable("dispute_events", ["id","disputeId","step","previousStep","eventType","description","performedBy","performedByName","metadata","createdAt"], eventRows, `("id")`);
  await seedTable("dispute_offers", ["id","disputeId","offerType","amount","rationale","supportingDocIds","submittedBy","submittedAt","isAccepted"], offerRows, `("id")`);
  await seedTable("dispute_documents", ["id","disputeId","documentType","fileName","fileSize","mimeType","s3Key","uploadedBy","uploadedAt","description"], docRows, `("id")`);
  await seedTable("document_versions", ["id","documentId","disputeId","versionNumber","s3Key","fileName","fileSize","mimeType","uploadedBy","uploadedAt","changeNote","isLatest"], docVersionRows, `("id")`);
  await seedTable("document_expiry_alerts", ["id","disputeId","documentId","documentName","expiresAt","alertSentAt","dismissed","createdAt"], docExpiryRows, `("id")`);
  await seedTable("notifications", ["id","disputeId","userId","notificationType","title","message","dueDate","isRead","createdAt"], notifRows, `("id")`);
  await seedTable("dispute_comments", ["id","disputeId","authorId","authorName","content","parentId","edited","createdAt","updatedAt"], commentRows, `("id")`);
  await seedTable("step_notes", ["id","disputeId","stepId","authorId","authorName","note","attachments","createdAt","updatedAt"], stepNoteRows, `("id")`);
  await seedTable("dispute_watchlist", ["id","userId","disputeId","note","alertOnStatusChange","alertOnDeadline","createdAt"], watchRows, `("id")`);
  await seedTable("dispute_access", ["id","disputeId","userId","permission","grantedBy","grantedAt"], accessRows, `("disputeId", "userId")`);
  await seedTable("dispute_appeals", ["id","disputeId","submittedBy","submittedByName","status","groundsForAppeal","supportingEvidence","originalDetermination","appealDecision","decidedAt","submittedAt","createdAt","updatedAt"], appealRows, `("id")`);
  await seedTable("dispute_escalations", ["id","disputeId","raisedBy","raisedByName","assignedTo","priority","status","reason","resolution","resolvedAt","createdAt","updatedAt"], escalationRows, `("id")`);
  await seedTable("sla_breaches", ["id","disputeId","step","deadlineDays","actualDays","breachDays","detectedAt","resolvedAt","severity"], slaRows, `("id")`);
  await seedTable("outcome_predictions", ["id","disputeId","winProbability","confidenceScore","keyFactors","recommendation","modelVersion","createdAt","updatedAt"], predictionRows, `("id")`);
  await seedTable("dispute_narratives", ["id","disputeId","generatedBy","narrativeType","content","wordCount","approved","approvedBy","approvedAt","createdAt"], narrativeRows, `("id")`);
  await seedTable("ledger_accounts", ["id","disputeId","accountType","balanceCents","currency","createdAt","updatedAt"], ledgerAcctRows, `("disputeId", "accountType")`);
  await seedTable("ledger_entries", ["id","disputeId","debitAccountId","creditAccountId","amountCents","currency","entryType","description","referenceId","referenceType","idempotencyKey","metadata","createdAt"], ledgerEntryRows, `("disputeId", "idempotencyKey")`);
  await seedTable("settlement_transfers", ["id","disputeId","provider","providerTransferId","amountCents","currency","status","requestedBy","requestedByName","requestReason","idempotencyKey","authorizedAt","submittedAt","acceptedAt","settledAt","failedAt","reversedAt","reconciledAt","failureCode","failureReason","metadata","createdAt","updatedAt"], transferRows, `("idempotencyKey")`);
  await seedTable("settlement_approvals", ["id","transferId","decision","decidedBy","decidedByName","decisionReason","expiresAt","decidedAt","createdAt"], approvalRows, `("transferId")`);
  await seedTable("settlement_callbacks", ["id","provider","providerEventId","providerTransferId","disputeId","amountCents","currency","status","occurredAt","signatureVersion","rawPayload","ledgerEntryId","reconciliationNote","reconciledAt","createdAt"], callbackRows, `("provider", "providerEventId")`);
  await seedTable("settlement_provider_reports", ["id","provider","providerReportId","transferId","providerTransferId","reportedStatus","amountCents","currency","reportedAt","rawPayload","createdAt"], providerReportRows, `("provider", "providerReportId")`);
  await seedTable("settlement_reconciliations", ["id","transferId","providerReportId","status","expectedAmountCents","reportedAmountCents","expectedStatus","reportedStatus","exceptionReason","reconciledBy","reconciledAt","createdAt"], reconRows, `("providerReportId")`);
  await seedTable("settlement_exception_reviews", ["id","reconciliationId","status","reviewReason","reviewedBy","reviewedByName","resolution","reviewedAt","createdAt"], exceptionReviewRows, `("reconciliationId")`);
  await seedTable("cms_drafts", ["id","disputeId","createdBy","status","isEligible","eligibilityReason","missingRequirements","warnings","estimatedDeadline","regulatoryBasis","formFields","attachmentChecklist","submissionNarrative","draftRegulatoryBasis","estimatedOutcome","nextSteps","additionalContext","processingTimeSeconds","agentTrace","submittedAt","createdAt","updatedAt"], cmsDraftRows, `("id")`);
  await seedTable("idr_deadline_events", ["id","disputeId","deadlineType","basisDate","computedDeadline","dayCount","dayKind","cfrReference","status","metAt","tMinus5SentAt","tMinus1SentAt","overdueSentAt","createdAt","updatedAt"], deadlineRows, `("disputeId", "deadlineType")`);
  await seedTable("idr_fee_assessments", ["id","disputeId","feeScheduleId","feeType","partyRole","partyId","amountCents","currency","status","assessedAt","assessedBy","invoicedAt","paidAt","paymentReference","statusReason","idempotencyKey","createdAt","updatedAt"], feeAssessmentRows, `("idempotencyKey")`);
  await seedTable("idr_attestations", ["id","disputeId","attestationType","partyRole","attestedBy","attestedByName","attestationText","informationComplete","informationAccurate","status","supersededBy","ipAddress","userAgent","attestedAt","createdAt"], attestationRows, `("id")`);
  await seedTable("compliance_checks", ["id","disputeId","userId","sectionKey","itemKey","status","notes","checkedAt","checkedBy","createdAt","updatedAt"], complianceRows, `("id")`);
  await seedTable("uscdi_data_elements", ["id","disputeId","emrConnectionId","patientName","patientDOB","patientAddress","patientInsuranceMemberId","diagnosisCodes","procedureCodes","encounterDate","facilityNPI","providerNPI","billedAmount","allowedAmount","payerName","planType","priorAuthNumber","completenessScore","missingElements","lastUpdatedAt","createdAt"], uscdiRows, `("id")`);
  await seedTable("hermes_jobs", ["id","userId","disputeId","jobType","status","inputPayload","outputText","outputJson","modelUsed","promptTokens","completionTokens","latencyMs","errorMessage","startedAt","completedAt","createdAt"], hermesJobRows, `("id")`);
  await seedTable("hermes_insights", ["id","disputeId","jobId","insightType","riskScore","riskLevel","riskFactors","narrative","narrativeVersion","providerWinPct","payerWinPct","splitPct","withdrawnPct","simulationBasis","payerBehaviorSummary","payerAcceptanceRate","payerAvgRoundToAccept","arbitratorId","arbitratorWinRate","arbitratorAvgAward","arbitratorNotes","enrichedFields","generatedAt","expiresAt"], hermesInsightRows, `("id")`);
  await seedTable("event_log", ["id","topic","eventType","aggregateId","aggregateType","payload","metadata","idempotencyKey","status","publishedAt","failureReason","retryCount","lastAttemptAt","nextAttemptAt","createdAt"], eventLogRows, `("id")`);
  await seedTable("audit_log", ["id","userId","action","entityType","entityId","oldValue","newValue","ipAddress","userAgent","createdAt"], auditRows, `("id")`);
  await seedTable("submission_automation_submissions", ["id","tenantId","disputeId","state","version","cmsDisputeReferenceNumber","attestation","createdAt","updatedAt","closedAt"], saSubRows, `("id")`);
  await seedTable("submission_automation_events", ["id","submissionId","tenantId","disputeId","seq","fromState","toState","at","actorId","detail","prevEventHash","eventHash","createdAt"], saEventRows, `("submissionId", "seq")`);
  await seedTable("submission_automation_idempotency", ["id","tenantId","disputeId","idempotencyKey","operation","submissionId","resultJson","createdAt"], saIdemRows, `("tenantId", "disputeId", "idempotencyKey")`);
  await seedTable("fsm_cases", ["id","tenantId","caseType","caseId","state","version","caseJson","createdAt","updatedAt","closedAt"], fsmCaseRows, `("tenantId", "caseType", "caseId")`);
  await seedTable("fsm_case_events", ["id","caseRowId","tenantId","caseType","caseId","seq","eventType","fromState","toState","at","detail","eventJson","prevEventHash","eventHash","createdAt"], fsmEventRows, `("caseRowId", "seq")`);
  await seedTable("fsm_case_idempotency", ["id","tenantId","caseType","caseId","idempotencyKey","operation","resultJson","createdAt"], fsmIdemRows, `("tenantId", "caseType", "caseId", "idempotencyKey")`);
  await seedTable("smart_form_extractions", ["id","userId","targetForm","disputeId","inputType","inputPreview","documentName","extractedFields","overallConfidence","fieldCount","highConfidenceCount","lowConfidenceCount","status","errorMessage","processingMs","modelUsed","appliedAt","appliedFields","createdAt"], smartFormRows, `("id")`);
  await seedTable("davinci_transactions", ["id","disputeId","emrConnectionId","txType","status","requestPayload","responsePayload","priorAuthNumber","coverageDecision","errorCode","errorMessage","processingTimeMs","createdAt","updatedAt"], davinciRows, `("id")`);

  // ═══ Per-user/org misc tables ════════════════════════════════════════════
  await seedTable("dispute_drafts", ["id","userId","formData","currentStep","lastSavedAt","createdAt"],
    providerUsers.slice(0, 6).map((u, i) => [`drf_${u.id}_${i}`, u.id, JSON.stringify({ referenceHint: `HP-2025-${200000 + i}`, serviceType: pick(CPT_BOOK).serviceType, billedAmount: randInt(500, 9000) }), randInt(1, 5), daysBefore(randInt(1, 20)), daysBefore(randInt(20, 60))]),
    `("id")`);
  await seedTable("dispute_templates", ["id","createdBy","name","description","serviceType","initiatingPartyName","initiatingPartyType","respondingPartyName","respondingPartyType","billedAmount","qpaAmount","dateOfService","patientName","claimNumber","cptCodes","icdCodes","notes","usageCount","createdAt","updatedAt"],
    providerUsers.slice(0, 4).map((u, i) => {
      const c = CPT_BOOK[i];
      return [`tpl_${u.id}`, u.id, `${c.desc} vs ${PAYERS[i].name}`, `Template for ${c.serviceType} disputes`, c.serviceType, PROVIDERS[i].name, PROVIDERS[i].type, PAYERS[i].name, "payer", String((c.p50 * 2) / 100), String(c.p50 / 100), "", "", "", JSON.stringify([c.cpt]), JSON.stringify([ICD10[i]]), null, randInt(0, 12), daysBefore(90), daysBefore(10)];
    }),
    `("id")`);
  await seedTable("webhooks", ["id","userId","name","url","secret","events","status","lastTriggeredAt","failureCount","createdAt","updatedAt"],
    users.slice(1, 5).map((u, i) => [`whk_${u.id}`, u.id, `${u.org} SIEM forwarder`, `https://hooks.${slug(u.org).replace(/\./g, "")}.example.com/healthpoint`, "whsec_" + sha256(u.id).slice(0, 24), "dispute.advanced,determination.issued", "active", daysBefore(randInt(1, 10)), 0, daysBefore(100), daysBefore(1)]),
    `("id")`);
  await seedTable("webhook_deliveries", ["id","webhookId","eventType","payload","status","attempts","lastAttemptAt","nextRetryAt","responseStatus","responseBody","errorMessage","createdAt"],
    users.slice(1, 5).flatMap((u, i) => [
      [`whd_${u.id}_1`, `whk_${u.id}`, "dispute.advanced", JSON.stringify({ disputeId: `dsp_${String(i + 1).padStart(5, "0")}`, newStep: "STEP_09_OFFER_SUBMISSION" }), "delivered", 1, daysBefore(3), null, 200, "ok", null, daysBefore(3)],
      [`whd_${u.id}_2`, `whk_${u.id}`, "determination.issued", JSON.stringify({ disputeId: `dsp_${String(i + 2).padStart(5, "0")}` }), "failed", 3, daysBefore(1), daysAfter(0.5), 500, "upstream timeout", "HTTP 500 from receiver", daysBefore(1)],
    ]),
    `("id")`);
  // EMR connections + FHIR ecosystem
  const emrSystems = ["epic","cerner","meditech","athenahealth"];
  const emrRows = providerUsers.slice(0, 4).map((u, i) => ({
    id: `emr_${String(i).padStart(3, "0")}`,
    user: u,
    sys: emrSystems[i % emrSystems.length],
  }));
  await seedTable("emr_connections", ["id","name","emrSystem","authType","baseUrl","fhirVersion","credentialsEncrypted","fieldMappings","status","lastTestAt","lastTestSuccess","lastTestMessage","aiConfidenceScore","resourcesFound","createdBy","createdAt","updatedAt"],
    emrRows.map((e) => [e.id, `${e.user.org} ${e.sys} connection`, e.sys, "oauth2", `https://fhir.${slug(e.user.org).replace(/\./g, "")}.example.com/R4`, "R4", "enc:" + sha256(e.id).slice(0, 48), JSON.stringify({ patientName: "Patient.name", claimNumber: "Claim.identifier", billedAmount: "Claim.total" }), "active", daysBefore(2), true, "Connected; 14 resources discovered", "0.940", JSON.stringify(["Patient","Claim","Coverage","Encounter"]), e.user.id, daysBefore(120), daysBefore(2)]),
    `("id")`);
  await seedTable("emr_sync_logs", ["id","connectionId","triggeredBy","triggerType","status","fieldsExtracted","fhirResourcesAccessed","patientId","claimId","disputeId","durationMs","errorMessage","warnings","fieldConfidence","summary","createdAt"],
    emrRows.flatMap((e, i) => [
      [`esl_${e.id}_1`, e.id, e.user.id, "dispute_pull", "success", randInt(20, 60), JSON.stringify(["Patient","Claim","Coverage"]), `pat_${sha256(e.id).slice(0, 8)}`, `clm_${100000 + i}`, `dsp_${String(i + 1).padStart(5, "0")}`, randInt(400, 5000), null, JSON.stringify([]), JSON.stringify({ billedAmount: 0.98 }), "Pull completed.", daysBefore(10)],
      [`esl_${e.id}_2`, e.id, null, "heartbeat", pick(["success","partial"]), randInt(0, 5), JSON.stringify(["Coverage"]), null, null, null, randInt(100, 900), null, JSON.stringify(["stale token refreshed"]), null, "Heartbeat OK.", daysBefore(1)],
    ]),
    `("id")`);
  await seedTable("fhir_capability_statements", ["id","emrConnectionId","fhirVersion","softwareName","softwareVersion","supportedResources","supportedSearchParams","smartScopes","bulkExportSupported","cdsHooksSupported","rawStatement","fetchedAt","createdAt"],
    emrRows.map((e) => [`fcs_${e.id}`, e.id, "R4", e.sys === "epic" ? "Epic" : e.sys, "2025.1", JSON.stringify(["Patient","Claim","Coverage","Encounter","ExplanationOfBenefit"]), JSON.stringify({ Patient: ["identifier","name"], Claim: ["patient","created"] }), JSON.stringify(["system/Claim.read","system/Patient.read"]), true, e.sys === "epic", JSON.stringify({ resourceType: "CapabilityStatement", status: "active" }), daysBefore(60), daysBefore(60)]),
    `("id")`);
  await seedTable("smart_tokens", ["id","emrConnectionId","userId","accessToken","refreshToken","tokenType","scope","expiresAt","patientContext","encounterContext","createdAt","updatedAt"],
    emrRows.map((e) => [`stk_${e.id}`, e.id, e.user.id, "eyJ" + sha256(e.id + "at").slice(0, 60), "rt_" + sha256(e.id + "rt").slice(0, 40), "Bearer", "system/Claim.read system/Patient.read", daysAfter(0.5), null, null, daysBefore(1), daysBefore(1)]),
    `("id")`);
  await seedTable("bulk_fhir_export_jobs", ["id","emrConnectionId","initiatedBy","exportType","resourceTypes","since","statusUrl","status","progress","outputFiles","errorFiles","totalRecords","disputesCreated","errorMessage","startedAt","completedAt","createdAt"],
    emrRows.slice(0, 2).map((e, i) => [`bfe_${e.id}`, e.id, e.user.id, "Group", JSON.stringify(["Claim","ExplanationOfBenefit"]), daysBefore(90), `https://fhir.${slug(e.user.org).replace(/\./g, "")}.example.com/bulk/${i}`, "completed", 100, JSON.stringify([{ type: "Claim", url: "https://files.example.com/claim.ndjson", count: 1240 }]), JSON.stringify([]), 1240, randInt(3, 18), null, daysBefore(30), daysBefore(30), daysBefore(30)]),
    `("id")`);
  await seedTable("cds_hooks", ["id","emrConnectionId","hookId","title","description","prefetch","status","invocationCount","lastInvokedAt","createdAt"],
    emrRows.map((e) => [`cds_${e.id}`, e.id, "order-sign", "OON risk alert", "Alerts when an ordered service may be out-of-network.", JSON.stringify({ patient: "Patient/{{context.patientId}}" }), "active", randInt(10, 900), daysBefore(1), daysBefore(100)]),
    `("id")`);
  await seedTable("fhir_resource_cache", ["id","emrConnectionId","resourceType","resourceId","fhirVersion","resourceData","disputeId","expiresAt","fetchedAt","createdAt"],
    emrRows.flatMap((e, i) => [
      [`frc_${e.id}_p`, e.id, "Patient", `pat_${sha256(e.id).slice(0, 8)}`, "R4", JSON.stringify({ resourceType: "Patient", id: `pat_${sha256(e.id).slice(0, 8)}`, name: [{ family: pick(LAST), given: [pick(FIRST)] }] }), null, daysAfter(1), daysBefore(1), daysBefore(1)],
      [`frc_${e.id}_c`, e.id, "Claim", `clm_${100000 + i}`, "R4", JSON.stringify({ resourceType: "Claim", id: `clm_${100000 + i}`, total: { value: 1240.5, currency: "USD" } }), `dsp_${String(i + 1).padStart(5, "0")}`, daysAfter(1), daysBefore(1), daysBefore(1)],
    ]),
    `("id")`);
  await seedTable("document_analyses", ["id","disputeId","userId","fileName","fileType","s3Key","status","ocrText","extractedFields","confidence","processingTimeMs","errorMessage","createdAt","updatedAt"],
    Array.from({ length: Math.min(8, DISPUTE_COUNT) }, (_, i) => {
      const u = providerUsers[i % providerUsers.length] ?? users[1];
      const id = `dsp_${String(i + 1).padStart(5, "0")}`;
      return [`dan_${String(i).padStart(3, "0")}`, id, u.id, `eob_HP-2025-${100000 + i}.pdf`, "application/pdf", `s3://healthpoint-docs/${id}/eob.pdf`, "completed", "EXPLANATION OF BENEFITS ... ALLOWED AMOUNT ...", JSON.stringify({ billedAmount: 1240.5, allowedAmount: 512.3 }), randInt(80, 98), randInt(1200, 9000), null, daysBefore(randInt(5, 40)), daysBefore(randInt(1, 4))];
    }),
    `("id")`);

  // Hermes regulatory feed + chat (representative)
  await seedTable("hermes_regulatory_entries", ["id","title","summary","source","sourceUrl","impactLevel","affectedSteps","tags","effectiveDate","isRead","createdAt"],
    [
      ["hreg_001","CY2026 IDR administrative fee notice","Departments announce the 2026 administrative fee and IDRE fee ranges.","CMS","https://www.cms.gov/nosa-idr","high", JSON.stringify(["STEP_16_ADMINISTRATIVE_FEE_PAID"]), JSON.stringify(["fees"]), daysBefore(60), false, daysBefore(60)],
      ["hreg_002","Batching rules litigation update","Court order affects batched dispute eligibility criteria.","E.D. Tex.",null,"critical", JSON.stringify(["STEP_04_IDR_INITIATED","STEP_08_ELIGIBILITY_REVIEW"]), JSON.stringify(["litigation","batching"]), daysBefore(30), true, daysBefore(30)],
    ],
    `("id")`);
  await seedTable("hermes_chat_messages", ["id","sessionId","userId","disputeId","role","content","jobId","createdAt"],
    users.slice(1, 4).flatMap((u, i) => {
      const sid = `sess_${u.id}`;
      return [
        [`hcm_${sid}_1`, sid, u.id, `dsp_${String(i + 1).padStart(5, "0")}`, "user", "What is the likelihood our offer prevails for this knee arthroscopy dispute?", null, daysBefore(2)],
        [`hcm_${sid}_2`, sid, u.id, `dsp_${String(i + 1).padStart(5, "0")}`, "assistant", "Based on comparable outcomes in TX for CPT 29881, provider offers within 1.4x of median contracted rates prevail ~62% of the time.", null, daysBefore(2)],
      ];
    }),
    `("id")`);

  // Settlement balance proofs (daily)
  await seedTable("settlement_balance_proofs", ["id","proofDate","status","transferCount","reconciledTransferCount","ledgerPaymentCents","ledgerReversalCents","unresolvedExceptionCount","ledgerMismatchCount","evidenceHash","summary","createdAt"],
    Array.from({ length: 7 }, (_, i) => {
      const d = new Date(EPOCH - (i + 1) * dayMs).toISOString().slice(0, 10);
      const tc = randInt(2, 20);
      const ledger = randInt(50000, 9000000);
      return [`sbp_${d}`, d, "passed", tc, tc, ledger, 0, 0, 0, sha256(`proof:${d}:${SEED}`), JSON.stringify({ generatedBy: "seed-all", transfers: tc }), daysBefore(i + 1)];
    }),
    `("proofDate")`);

  // Reconciliation runs (Postgres vs TigerBeetle)
  await seedTable("reconciliation_runs", ["id","runKey","status","tigerBeetleEnabled","accountsCompared","driftCount","drifts","errorMessage","triggeredBy","startedAt","completedAt","createdAt"],
    Array.from({ length: 5 }, (_, i) => {
      const started = new Date(EPOCH - (i + 1) * 3600000 * 6);
      const runKey = `recon-${started.toISOString().slice(0, 13)}`;
      const drift = chance(0.15);
      return [`rrn_${String(i).padStart(3, "0")}`, runKey, drift ? "drift" : "passed", false, randInt(50, 500), drift ? 1 : 0, JSON.stringify(drift ? [{ accountId: "lac_dsp_00001_paid", expected: 120000, actual: 119000 }] : []), null, "scheduler", started, new Date(started.getTime() + randInt(2, 20) * 1000), started];
    }),
    `("runKey")`);

  // ═══ Summary ══════════════════════════════════════════════════════════════
  const dbCounts = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1`;
  console.log("\n=== Row counts (inserted this run / total in table) ===");
  let totalInserted = 0, totalRows = 0;
  for (const { table_name } of dbCounts) {
    const [{ c }] = await sql`SELECT count(*)::int AS c FROM ${sql(table_name)}`;
    const ins = counts[table_name] ?? 0;
    totalInserted += ins;
    totalRows += c;
    console.log(`${table_name.padEnd(42)} +${String(ins).padStart(6)}  total=${c}`);
  }
  console.log(`${"TOTAL".padEnd(42)} +${totalInserted}  total=${totalRows}`);
  await sql.end();
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
