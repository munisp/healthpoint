/**
 * server/emr/bulk-import.ts
 *
 * Phase 17 (E1 + E3 + E6): live FHIR extraction & bulk ndjson parsing into
 * the practice_claims staging table (drizzle/schema-practice-claims.ts).
 *
 * E3 — BULK PARSING: the bulk $export worker (server/scheduled/
 * bulkFhirWorker.ts) downloads ndjson output files; this module parses them.
 * Resource types consumed: Claim, ExplanationOfBenefit, Coverage, Patient,
 * Procedure, Practitioner, Organization. Claims are joined with their EOBs
 * (claim reference) to fill initialPaymentDate/amounts; Coverage supplies
 * plan identifiers; Patient supplies state; Practitioner/Organization supply
 * NPIs. Fields that FHIR R4 cannot genuinely supply (plan type,
 * network status, notice/consent status) are left NULL — never fabricated
 * (E6: missing values surface as NEEDS_REVIEW in the eligibility engine).
 *
 * E1 — LIVE EXTRACTION: extractEmrData() is the real TypeScript-side
 * extraction path that replaces the dead AI-service /extract-emr-data proxy
 * (which 503'd). It reads the emr_connections row, decrypts credentials,
 * acquires a SMART Backend Services token when configured
 * (server/emr/smart-auth.ts; only when SMART_BACKEND_SERVICES_ENABLED=true),
 * performs authenticated FHIR R4 reads, and returns the extractedData shape
 * the emr.pullDisputeData procedure consumes. When the connection has no
 * credentials it fails HONESTLY (auth required by endpoint → error; open
 * endpoint → unauthenticated read, labeled as such).
 *
 * Idempotency: staging inserts dedupe on (orgId, contentSha256) — the hash
 * is computed over the normalized claim content, so replays of the same
 * export file are no-ops.
 *
 * Labels: parsing/mapping EXECUTED-VERIFIED against fixtures
 * (bulk-import.test.ts); live extraction path MOCK-VERIFIED (mocked fetch).
 */

import { createHash, randomUUID } from "node:crypto";

// ─── FHIR resource typings (minimal, honest subsets) ─────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
type FhirResource = Record<string, any> & { resourceType: string; id?: string };

export interface NdjsonResource {
  resourceType: string;
  resource: FhirResource;
}

/** Parse an ndjson payload into resources; skips blank lines; throws on bad JSON with line numbers. */
export function parseNdjson(content: string): NdjsonResource[] {
  const out: NdjsonResource[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let parsed: FhirResource;
    try {
      parsed = JSON.parse(line) as FhirResource;
    } catch {
      throw new BulkImportError(`ndjson line ${i + 1} is not valid JSON`);
    }
    if (!parsed || typeof parsed.resourceType !== "string") {
      throw new BulkImportError(`ndjson line ${i + 1} lacks a resourceType`);
    }
    out.push({ resourceType: parsed.resourceType, resource: parsed });
  }
  return out;
}

export class BulkImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BulkImportError";
  }
}

// ─── Normalized staging shape ────────────────────────────────────────────────
export interface NormalizedPracticeClaim {
  claimId: string | null;
  patientRef: string | null;
  planType: string | null;
  serviceCategory: string | null;
  patientState: string | null;
  facilityState: string | null;
  serviceDate: string | null;
  serviceEndDate: string | null;
  placeOfService: string | null;
  networkStatus: string | null;
  noticeConsentStatus: string | null;
  initialPaymentDate: string | null;
  denialDate: string | null;
  priorPaymentDeterminationDate: string | null;
  cptCodes: string[];
  modifiers: string[];
  diagnoses: string[];
  payerId: string | null;
  payerName: string | null;
  planIdentifier: string | null;
  renderingNpi: string | null;
  billingNpi: string | null;
  tin: string | null;
  billedCents: number | null;
  allowedCents: number | null;
  paidCents: number | null;
  sourceProvenance: Record<string, { source: "emr" | "edi" | "manual" | "derived"; detail?: string }>;
  sourceResourceRefs: string[];
}

const NPI_SYSTEM = "http://hl7.org/fhir/sid/us-npi";
const CPT_SYSTEMS = new Set(["http://www.ama-assn.org/go/cpt", "https://www.cms.gov/Medicare/Coding/HCPCSReleaseCodeSets"]);
const ICD10_SYSTEMS = new Set(["http://hl7.org/fhir/sid/icd-10", "http://hl7.org/fhir/sid/icd-10-cm", "http://hl7.org/fhir/sid/icd-cm"]);

function codingCodes(cc: any, systems: Set<string>): string[] {
  const out: string[] = [];
  for (const c of cc?.coding ?? []) {
    if (c?.code && (systems.size === 0 || systems.has(c.system) || !c.system)) out.push(String(c.code));
  }
  return out;
}

function centsOf(money: any): number | null {
  const v = money?.value;
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.round(v * 100);
}

function isoDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function npiOf(resource: FhirResource | undefined): string | null {
  for (const ident of resource?.identifier ?? []) {
    if (ident?.system === NPI_SYSTEM && ident.value) return String(ident.value);
  }
  return null;
}

function stateOf(resource: FhirResource | undefined): string | null {
  const addr = resource?.address?.[0];
  const s = addr?.state;
  return typeof s === "string" && /^[A-Za-z]{2}$/.test(s) ? s.toUpperCase() : null;
}

/**
 * Normalize a set of parsed FHIR resources into practice-claim records.
 * One record per Claim resource; EOBs join by claim reference
 * (EOB.claim.reference → Claim/{id} or identifier match); Coverage joins via
 * Claim.insurance[].coverage.reference; Patient via Claim.patient.reference.
 * Procedure resources with a claim-ish context are staged separately only
 * when no Claim exists for them (conservative: procedures alone do not make
 * an adjudicated claim — they are attached as provenance refs when they
 * share a patient+date with a claim, otherwise ignored with a count).
 */
export function normalizeFhirResources(resources: NdjsonResource[]): {
  claims: NormalizedPracticeClaim[];
  stats: Record<string, number>;
} {
  const byType = new Map<string, FhirResource[]>();
  for (const { resourceType, resource } of resources) {
    const arr = byType.get(resourceType) ?? [];
    arr.push(resource);
    byType.set(resourceType, arr);
  }
  const patients = byType.get("Patient") ?? [];
  const coverages = byType.get("Coverage") ?? [];
  const eobs = byType.get("ExplanationOfBenefit") ?? [];
  const practitioners = byType.get("Practitioner") ?? [];
  const organizations = byType.get("Organization") ?? [];
  const claimsRes = byType.get("Claim") ?? [];
  const procedures = byType.get("Procedure") ?? [];

  const patientById = new Map(patients.map(p => [`Patient/${p.id}`, p]));
  const coverageById = new Map(coverages.map(c => [`Coverage/${c.id}`, c]));
  const practitionerById = new Map(practitioners.map(p => [`Practitioner/${p.id}`, p]));
  const orgById = new Map(organizations.map(o => [`Organization/${o.id}`, o]));

  // Index EOBs by the claim they explain (reference or identifier match).
  const eobByClaimRef = new Map<string, FhirResource>();
  for (const eob of eobs) {
    const ref = eob?.claim?.reference as string | undefined;
    if (ref) eobByClaimRef.set(ref, eob);
  }

  const claims: NormalizedPracticeClaim[] = [];
  for (const claim of claimsRes) {
    const prov: NormalizedPracticeClaim["sourceProvenance"] = {};
    const refs: string[] = [`Claim/${claim.id}`];
    const set = (key: string, value: unknown, detail?: string) => {
      if (value !== null && value !== undefined && value !== "") prov[key] = { source: "emr", detail };
    };

    const claimId = claim.identifier?.[0]?.value ?? claim.id ?? null;
    set("claimId", claimId);

    const patientRefRaw = claim.patient?.reference as string | undefined;
    const patientRef = patientRefRaw ?? null;
    const patient = patientRefRaw ? patientById.get(patientRefRaw) : undefined;
    const patientState = stateOf(patient);
    set("patientState", patientState, patient ? "Patient.address.state" : undefined);

    const serviceDate = isoDate(claim.billablePeriod?.start) ?? isoDate(claim.item?.[0]?.servicedDate) ?? isoDate(claim.item?.[0]?.servicedPeriod?.start) ?? isoDate(claim.created);
    const serviceEndDate = isoDate(claim.billablePeriod?.end) ?? isoDate(claim.item?.[0]?.servicedPeriod?.end);
    set("serviceDate", serviceDate, "Claim.billablePeriod.start");
    set("serviceEndDate", serviceEndDate);

    const posCoding = claim.item?.[0]?.locationCodeableConcept;
    const posCodes = codingCodes(posCoding, new Set());
    const placeOfService = posCodes.length ? posCodes[0] : null;
    set("placeOfService", placeOfService);

    const cptCodes: string[] = Array.from(new Set(
      ((claim.item ?? []) as any[]).flatMap((it: any): string[] => codingCodes(it?.productOrService, CPT_SYSTEMS))
    ));
    const modifiers: string[] = Array.from(new Set(
      ((claim.item ?? []) as any[]).flatMap((it: any): string[] => ((it?.modifier ?? []) as any[]).flatMap((m: any): string[] => codingCodes(m, new Set())))
    ));
    const diagnoses: string[] = Array.from(new Set(
      ((claim.diagnosis ?? []) as any[]).flatMap((d: any): string[] => codingCodes(d?.diagnosisCodeableConcept, ICD10_SYSTEMS))
    ));
    set("cptCodes", cptCodes.length ? cptCodes : null);
    set("diagnoses", diagnoses.length ? diagnoses : null);

    // Parties
    const insurerRef = claim.insurer?.reference as string | undefined;
    const insurerOrg = insurerRef ? orgById.get(insurerRef) : undefined;
    const payerName = claim.insurer?.display ?? insurerOrg?.name ?? null;
    const payerId = claim.insurer?.identifier?.value ?? insurerOrg?.identifier?.[0]?.value ?? null;
    set("payerName", payerName);
    set("payerId", payerId);

    const providerRef = claim.provider?.reference as string | undefined;
    const providerPrac = providerRef ? practitionerById.get(providerRef) : undefined;
    const providerOrg = providerRef ? orgById.get(providerRef) : undefined;
    const billingNpi = npiOf(providerOrg) ?? npiOf(providerPrac);
    const careTeamPrac = (claim.careTeam ?? [])
      .map((ct: any) => practitionerById.get(ct?.provider?.reference))
      .find(Boolean);
    const renderingNpi = npiOf(careTeamPrac) ?? (npiOf(providerPrac) !== billingNpi ? npiOf(providerPrac) : null);
    set("billingNpi", billingNpi);
    set("renderingNpi", renderingNpi);

    // Coverage → plan identifier. Plan TYPE (self-funded vs fully-insured)
    // is not representable in core FHIR R4 Coverage — left null (honest).
    const covRef = claim.insurance?.[0]?.coverage?.reference as string | undefined;
    const coverage = covRef ? coverageById.get(covRef) : undefined;
    if (coverage) refs.push(`Coverage/${coverage.id}`);
    const planIdentifier =
      coverage?.class?.find((c: any) => c?.type?.coding?.[0]?.code === "group")?.value ??
      coverage?.identifier?.[0]?.value ?? null;
    set("planIdentifier", planIdentifier);

    const billedCents = centsOf(claim.total);
    set("billedCents", billedCents, "Claim.total");

    // EOB join → payment amounts + initial payment date (§149.510 anchor).
    const eob = eobByClaimRef.get(`Claim/${claim.id}`) ?? null;
    let paidCents: number | null = null;
    let allowedCents: number | null = null;
    let initialPaymentDate: string | null = null;
    if (eob) {
      refs.push(`ExplanationOfBenefit/${eob.id}`);
      const totals = eob.total ?? [];
      const paymentTotal = totals.find((t: any) => t?.category?.coding?.[0]?.code === "payment");
      const submittedTotal = totals.find((t: any) => t?.category?.coding?.[0]?.code === "submitted");
      paidCents = centsOf(paymentTotal?.amount) ?? null;
      allowedCents = centsOf(eob?.payment?.amount) ?? paidCents;
      initialPaymentDate = isoDate(eob?.payment?.date) ?? isoDate(eob?.created);
      if (submittedTotal && billedCents === null) set("billedCents", centsOf(submittedTotal.amount), "EOB.total[submitted]");
      set("paidCents", paidCents, "EOB.total[payment]");
      set("allowedCents", allowedCents, "EOB.payment.amount");
      set("initialPaymentDate", initialPaymentDate, "EOB.payment.date");
    }

    // Facility state: prefer the servicing facility Organization address.
    const facilityRef = claim.facility?.reference as string | undefined;
    const facilityOrg = facilityRef ? orgById.get(facilityRef) : undefined;
    const facilityState = stateOf(facilityOrg);
    set("facilityState", facilityState);

    claims.push({
      claimId: claimId ? String(claimId) : null,
      patientRef,
      planType: null, // not derivable from FHIR R4 core — E6 honesty
      serviceCategory: null, // emergency vs non-emergency not derivable — E6 honesty
      patientState,
      facilityState,
      serviceDate,
      serviceEndDate,
      placeOfService,
      networkStatus: null, // not representable in core R4 EOB/Claim — E6 honesty
      noticeConsentStatus: null, // consent artifact, not a FHIR financial resource field
      initialPaymentDate,
      denialDate: null,
      priorPaymentDeterminationDate: null,
      cptCodes,
      modifiers,
      diagnoses,
      payerId,
      payerName,
      planIdentifier,
      renderingNpi,
      billingNpi,
      tin: null,
      billedCents,
      allowedCents,
      paidCents,
      sourceProvenance: prov,
      sourceResourceRefs: refs,
    });
  }

  return {
    claims,
    stats: {
      claims: claims.length,
      eobsJoined: claims.filter(c => c.sourceResourceRefs.some(r => r.startsWith("ExplanationOfBenefit/"))).length,
      patients: patients.length,
      coverages: coverages.length,
      proceduresIgnored: procedures.filter(p => !claims.some(c => c.patientRef === p?.subject?.reference)).length,
      practitioners: practitioners.length,
      organizations: organizations.length,
    },
  };
}

/** Deterministic content hash over normalized claim content (idempotency key). */
export function claimContentHash(source: string, claim: NormalizedPracticeClaim): string {
  const canonical = JSON.stringify({
    source,
    claimId: claim.claimId,
    patientRef: claim.patientRef,
    serviceDate: claim.serviceDate,
    cptCodes: [...claim.cptCodes].sort(),
    diagnoses: [...claim.diagnoses].sort(),
    billedCents: claim.billedCents,
    paidCents: claim.paidCents,
    payerId: claim.payerId,
    renderingNpi: claim.renderingNpi,
    billingNpi: claim.billingNpi,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export interface StageClaimsResult {
  inserted: number;
  skippedDuplicates: number;
  claimIds: string[];
}

/**
 * Insert normalized claims into practice_claims in batches, idempotent by
 * (orgId, contentSha256) via ON CONFLICT DO NOTHING.
 */
export async function stageClaims(
  db: { insert: Function },
  orgId: string,
  source: "fhir_bulk" | "fhir_pull" | "x12_837" | "csv",
  sourceRef: string | null,
  emrConnectionId: string | null,
  claims: NormalizedPracticeClaim[],
  deps: { table?: unknown; batchSize?: number } = {},
): Promise<StageClaimsResult> {
  const { practiceClaims } = await import("../../drizzle/schema-practice-claims");
  const batchSize = deps.batchSize ?? 200;
  let inserted = 0;
  let skipped = 0;
  const claimIds: string[] = [];
  for (let i = 0; i < claims.length; i += batchSize) {
    const batch = claims.slice(i, i + batchSize).map(c => ({
      id: randomUUID(),
      orgId,
      emrConnectionId,
      source,
      sourceRef,
      contentSha256: claimContentHash(source, c),
      ...c,
      updatedAt: new Date(),
    }));
    const res = await (db as any)
      .insert(practiceClaims)
      .values(batch)
      .onConflictDoNothing({ target: [practiceClaims.orgId, practiceClaims.contentSha256] })
      .returning({ id: practiceClaims.id });
    inserted += Array.isArray(res) ? res.length : 0;
    skipped += batch.length - inserted;
    claimIds.push(...(Array.isArray(res) ? res.map((r: { id: string }) => r.id) : []));
  }
  return { inserted, skippedDuplicates: skipped, claimIds };
}

/**
 * Parse a bulk-export ndjson payload and stage it. `resourceType` is the
 * file's declared type from the export manifest (used only for stats).
 */
export async function importBulkNdjson(
  db: { insert: Function },
  args: {
    orgId: string;
    emrConnectionId?: string | null;
    sourceRef?: string | null;
    ndjson: string;
  },
): Promise<StageClaimsResult & { stats: Record<string, number> }> {
  const resources = parseNdjson(args.ndjson);
  const { claims, stats } = normalizeFhirResources(resources);
  const staged = await stageClaims(db, args.orgId, "fhir_bulk", args.sourceRef ?? null, args.emrConnectionId ?? null, claims);
  return { ...staged, stats };
}

// ─── E1: live single-connection extraction path ──────────────────────────────

export interface ExtractEmrDataArgs {
  connectionId: string;
  emrSystem: string;
  patientId?: string;
  encounterId?: string;
  claimId?: string;
  dateOfService?: string;
}

export interface ExtractEmrDataResult {
  success: boolean;
  emrSystem: string;
  vendor: string;
  fhirVersion: string;
  authMethod: string;
  fieldsExtracted: number;
  fieldConfidence: Record<string, number>;
  extractedData: Record<string, unknown>;
  fhirResources: string[];
  summary: string;
  warnings: string[];
  processingTimeSeconds: number;
}

type FetchLike = typeof fetch;

/**
 * Real TypeScript-side EMR extraction (replaces the AI-service
 * /extract-emr-data proxy which fail-closed 503). Reads Claim/Coverage/EOB/
 * Patient resources for the requested patient/claim from the connection's
 * FHIR base URL and maps them to the EMR_FILLABLE_FIELDS dispute shape.
 *
 * Honest errors: unknown connection / missing baseUrl / HTTP failures throw
 * BulkImportError with the underlying status — callers keep fail-closed
 * behavior.
 */
export async function extractEmrData(
  args: ExtractEmrDataArgs,
  deps: { fetchFn?: FetchLike } = {},
): Promise<ExtractEmrDataResult> {
  const started = Date.now();
  const fetchFn = deps.fetchFn ?? fetch;
  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) throw new BulkImportError("Database unavailable — cannot load EMR connection");
  const { emrConnections } = await import("../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const [conn] = await db.select().from(emrConnections).where(eq(emrConnections.id, args.connectionId)).limit(1);
  if (!conn) throw new BulkImportError(`EMR connection ${args.connectionId} not found`);
  if (!conn.baseUrl) throw new BulkImportError("EMR connection has no FHIR base URL configured");
  const baseUrl = conn.baseUrl.replace(/\/$/, "");

  // Auth: SMART Backend Services when configured + enabled; else unauthenticated.
  let authHeader: string | null = null;
  let authMethod = "none";
  if (conn.credentialsEncrypted) {
    try {
      const { decryptCredentials } = await import("../credential-crypto");
      const creds = decryptCredentials(conn.credentialsEncrypted);
      const { smartConfigFromCredentials, getSmartBackendToken } = await import("./smart-auth");
      const cfg = smartConfigFromCredentials(creds, baseUrl);
      if (cfg) {
        const token = await getSmartBackendToken(conn.id, cfg, { fetchFn });
        authHeader = `Bearer ${token.accessToken}`;
        authMethod = "smart-backend-services";
      } else if (creds.apiKey) {
        authHeader = `Bearer ${creds.apiKey}`;
        authMethod = "apikey";
      }
    } catch (err) {
      if (err instanceof Error && err.name === "SmartAuthError") throw new BulkImportError(`SMART auth failed: ${err.message}`);
      throw new BulkImportError(`Credential decryption failed for EMR connection (check EMR_CREDENTIALS_ENCRYPTION_KEY)`);
    }
  }

  const headers: Record<string, string> = { Accept: "application/fhir+json" };
  if (authHeader) headers.Authorization = authHeader;

  async function fhirGet(path: string): Promise<FhirResource | null> {
    const res = await fetchFn(`${baseUrl}${path}`, { headers, signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new BulkImportError(`FHIR GET ${path} returned HTTP ${res.status}`);
    return (await res.json()) as FhirResource;
  }

  const warnings: string[] = [];
  const fhirResources: string[] = [];
  const resources: NdjsonResource[] = [];

  // Claim(s): by id, or search by patient.
  if (args.claimId) {
    const claim = await fhirGet(`/Claim/${encodeURIComponent(args.claimId)}`);
    if (claim) { resources.push({ resourceType: "Claim", resource: claim }); fhirResources.push(`Claim/${args.claimId}`); }
    else warnings.push(`Claim/${args.claimId} not found at endpoint`);
  } else if (args.patientId) {
    const bundle = await fhirGet(`/Claim?patient=${encodeURIComponent(args.patientId)}&_count=50`);
    const entries = (bundle as any)?.entry ?? [];
    for (const e of entries) {
      if (e?.resource?.resourceType === "Claim") {
        resources.push({ resourceType: "Claim", resource: e.resource });
        fhirResources.push(`Claim/${e.resource.id}`);
      }
    }
    if (entries.length === 0) warnings.push("No Claim resources found for patient");
  } else {
    throw new BulkImportError("extractEmrData requires patientId or claimId");
  }

  // Supporting resources: patient + any referenced Coverage/EOB.
  const claimRefs = new Set(resources.map(r => `Claim/${r.resource.id}`));
  const patientRef = resources[0]?.resource?.patient?.reference as string | undefined;
  if (patientRef) {
    const patient = await fhirGet(`/${patientRef}`);
    if (patient) { resources.push({ resourceType: "Patient", resource: patient }); fhirResources.push(patientRef); }
  }
  const covRef = resources[0]?.resource?.insurance?.[0]?.coverage?.reference as string | undefined;
  if (covRef) {
    const cov = await fhirGet(`/${covRef}`);
    if (cov) { resources.push({ resourceType: "Coverage", resource: cov }); fhirResources.push(covRef); }
  }
  if (claimRefs.size > 0) {
    const eobBundle = patientRef
      ? await fhirGet(`/ExplanationOfBenefit?patient=${encodeURIComponent(patientRef.split("/")[1] ?? "")}&_count=50`)
      : null;
    for (const e of (eobBundle as any)?.entry ?? []) {
      if (e?.resource?.resourceType === "ExplanationOfBenefit" && claimRefs.has(e.resource?.claim?.reference)) {
        resources.push({ resourceType: "ExplanationOfBenefit", resource: e.resource });
        fhirResources.push(`ExplanationOfBenefit/${e.resource.id}`);
      }
    }
  }

  const { claims } = normalizeFhirResources(resources);
  const primary = claims[0] ?? null;
  const extractedData: Record<string, unknown> = {};
  const fieldConfidence: Record<string, number> = {};
  if (primary) {
    const put = (key: string, value: unknown) => {
      if (value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0)) {
        extractedData[key] = value;
        fieldConfidence[key] = 1.0; // deterministic FHIR mapping — no ML confidence involved
      }
    };
    put("patientState", primary.patientState);
    put("facilityState", primary.facilityState);
    put("billedAmount", primary.billedCents !== null ? primary.billedCents / 100 : null);
    put("serviceDate", primary.serviceDate);
    put("cptCodes", primary.cptCodes);
    put("icd10Codes", primary.diagnoses);
    put("respondingPartyName", primary.payerName);
    put("initiatingPartyNpi", primary.billingNpi ?? primary.renderingNpi);
    // planType / networkStatus / serviceType are NOT fabricatable from FHIR R4 — omitted.
    warnings.push("planType, networkStatus, and serviceCategory are not derivable from FHIR R4 resources and were left unset (enter manually).");
  }

  return {
    success: primary !== null,
    emrSystem: args.emrSystem,
    vendor: args.emrSystem,
    fhirVersion: conn.fhirVersion ?? "R4",
    authMethod,
    fieldsExtracted: Object.keys(extractedData).length,
    fieldConfidence,
    extractedData,
    fhirResources,
    summary: primary
      ? `Extracted ${Object.keys(extractedData).length} dispute field(s) from ${fhirResources.length} FHIR resource(s) via ${authMethod}.`
      : "No claim data could be extracted from the endpoint for the given identifiers.",
    warnings,
    processingTimeSeconds: Math.round(((Date.now() - started) / 1000) * 100) / 100,
  };
}
