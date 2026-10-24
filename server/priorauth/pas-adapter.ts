/**
 * HL7 Da Vinci PAS (Prior Authorization Support) bridge — STATIC-ONLY.
 *
 * CMS-0057-F requires impacted payers to implement a Prior Authorization API
 * using the Da Vinci PAS/CRD/DTR implementation guides, with compliance
 * generally 2027-01-01 (managed care: rating periods on/after that date;
 * QHPs: plan years on/after). Payer endpoints are not expected before then,
 * so submission is feature-flagged (PA_API_2027_ENABLED) and BLOCKED unless a
 * payer endpoint is explicitly configured. No network code path executes
 * without configuration.
 */

import type { PaRequest } from './fsm';

// Ambient declaration so this module typechecks without @types/node installed.
declare const process: { env: Record<string, string | undefined> } | undefined;

function defaultEnv(): Record<string, string | undefined> {
  return typeof process !== 'undefined' ? process.env : {};
}

/**
 * Canonical HL7 Da Vinci PAS Claim profile URL form.
 * NOTE: profile URL and IG version MUST be verified against the current
 * published Da Vinci PAS implementation guide (STU) before go-live; IG
 * versions and profile URLs change between ballot/publish versions.
 */
export const PAS_CLAIM_PROFILE_URL =
  'http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-claim';

export interface PasConfig {
  /** Feature flag: PA_API_2027_ENABLED=true */
  paApi2027Enabled: boolean;
  /** Configured payer PAS endpoint base URL; undefined = not configured. */
  payerEndpoint?: string;
  /** Da Vinci PAS $submit endpoint (DAVINCI_PAS_ENDPOINT). */
  davinciPasEndpoint?: string;
  /** Optional mTLS material (file paths) for payer connections. */
  mtlsCertPath?: string;
  mtlsKeyPath?: string;
  mtlsCaPath?: string;
  /** HTTP timeout in ms (DAVINCI_PAS_TIMEOUT_MS, default 15000). */
  timeoutMs?: number;
}

export function loadPasConfig(env: Record<string, string | undefined> = defaultEnv()): PasConfig {
  return {
    paApi2027Enabled: env.PA_API_2027_ENABLED === 'true',
    payerEndpoint: env.PA_PAYER_ENDPOINT,
    davinciPasEndpoint: env.DAVINCI_PAS_ENDPOINT,
    mtlsCertPath: env.DAVINCI_PAS_MTLS_CERT_PATH,
    mtlsKeyPath: env.DAVINCI_PAS_MTLS_KEY_PATH,
    mtlsCaPath: env.DAVINCI_PAS_MTLS_CA_PATH,
    timeoutMs: env.DAVINCI_PAS_TIMEOUT_MS ? Number(env.DAVINCI_PAS_TIMEOUT_MS) : undefined,
  };
}

export interface FhirMeta {
  profile: string[];
}

export interface FhirClaim {
  resourceType: 'Claim';
  id: string;
  meta: FhirMeta;
  status: 'active';
  use: 'preauthorization';
  created: string;
  priority?: {
    coding: Array<{
      system: string;
      code: 'normal' | 'urgent';
    }>;
  };
}

export interface FhirBundleEntry {
  resource: FhirClaim;
}

export interface FhirBundle {
  resourceType: 'Bundle';
  type: 'collection';
  entry: FhirBundleEntry[];
}

const PROCESS_PRIORITY_SYSTEM = 'http://terminology.hl7.org/CodeSystem/processpriority';

/** Build a FHIR R4 PAS Bundle skeleton for a PA request. Pure/static; no I/O. */
export function buildPasBundle(request: Pick<PaRequest, 'id' | 'urgency'> & { createdAt?: Date }): FhirBundle {
  if (!request.id) throw new Error('request.id is required');
  const created = (request.createdAt ?? new Date()).toISOString();
  const claim: FhirClaim = {
    resourceType: 'Claim',
    id: request.id,
    meta: { profile: [PAS_CLAIM_PROFILE_URL] },
    status: 'active',
    use: 'preauthorization',
    created,
    priority: {
      coding: [
        {
          system: PROCESS_PRIORITY_SYSTEM,
          code: request.urgency === 'EXPEDITED' ? 'urgent' : 'normal',
        },
      ],
    },
  };
  return {
    resourceType: 'Bundle',
    type: 'collection',
    entry: [{ resource: claim }],
  };
}

export type SubmitResult =
  | { status: 'BLOCKED'; reason: string }
  | { status: 'READY'; bundle: FhirBundle };

/**
 * Submit a PA request via the PAS API. STATIC-ONLY: returns BLOCKED unless
 * the 2027 API feature flag is enabled AND a payer endpoint is configured.
 * Even when enabled+configured, this function performs no network I/O — it
 * returns the prepared bundle for a future wired transport to send. Actual
 * transport remains unimplemented until payer endpoints exist.
 */
export function submitViaPas(
  request: Pick<PaRequest, 'id' | 'urgency'>,
  config: PasConfig = loadPasConfig(),
): SubmitResult {
  if (!config.paApi2027Enabled) {
    return {
      status: 'BLOCKED',
      reason:
        'PA_API_2027_ENABLED is not true. CMS-0057-F Prior Authorization API ' +
        '(Da Vinci PAS) compliance is generally required 2027-01-01; payer ' +
        'endpoints are not expected before then. Submission is disabled.',
    };
  }
  if (!config.payerEndpoint && !config.davinciPasEndpoint) {
    return {
      status: 'BLOCKED',
      reason:
        'No payer PAS endpoint configured (PA_PAYER_ENDPOINT / ' +
        'DAVINCI_PAS_ENDPOINT unset). No network code path may execute ' +
        'without explicit endpoint configuration.',
    };
  }
  // STATIC-ONLY: prepare the payload; transport is intentionally not wired.
  return { status: 'READY', bundle: buildPasBundle(request) };
}

// ── W6: live Da Vinci PAS transport ─────────────────────────────────────────
//
// submitViaPasHttp performs the actual HTTP POST of the PAS Bundle to a
// configured payer endpoint (DAVINCI_PAS_ENDPOINT). It remains FAIL-CLOSED:
// with no endpoint configured it returns BLOCKED and performs no network I/O.
// mTLS is optional (DAVINCI_PAS_MTLS_{CERT,KEY,CA}_PATH file paths).

export interface PasReceipt {
  /** Payer-side receipt/transaction identifier parsed from the response. */
  receiptId: string | null;
  /** Raw parsed JSON body (FHIR or plain JSON). */
  body: unknown;
}

export type PasSubmitOutcome =
  | { status: 'BLOCKED'; reason: string }
  | { status: 'SUBMITTED'; receipt: PasReceipt; httpStatus: number }
  | { status: 'ERROR'; reason: string; httpStatus?: number };

interface PasPollOutcome {
  reachable: boolean;
  httpStatus?: number;
  /** Payer adjudication state when derivable: approved | denied | pended. */
  decision?: 'approved' | 'denied' | 'pended';
  body?: unknown;
  reason?: string;
}

/** Parse a payer receipt id out of common FHIR/JSON response shapes. */
export function parsePasReceiptId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.receiptId === 'string') return b.receiptId;
  if (typeof b.id === 'string' && b.id) return b.id;
  // FHIR Parameters: parameter[name=receiptId|id].valueString
  const params = (b.parameter ?? b.entry) as unknown;
  if (Array.isArray(params)) {
    for (const p of params) {
      const rec = p as Record<string, unknown>;
      const name = rec.name as string | undefined;
      if (name && /receipt|transaction|^id$/i.test(name)) {
        const v = rec.valueString ?? rec.valueId ?? rec.valueIdentifier;
        if (typeof v === 'string') return v;
        if (v && typeof v === 'object' && typeof (v as Record<string, unknown>).value === 'string') {
          return (v as Record<string, unknown>).value as string;
        }
      }
      const res = rec.resource as Record<string, unknown> | undefined;
      if (res && typeof res.id === 'string') return res.id;
    }
  }
  return null;
}

async function buildMtlsDispatcher(config: PasConfig): Promise<unknown> {
  if (!config.mtlsCertPath || !config.mtlsKeyPath) return undefined;
  const { readFileSync } = await import('node:fs');
  // undici (Node's fetch implementation) accepts a `dispatcher` option.
  // Specifier cast: undici ships with Node at runtime but has no bundled
  // type declarations in this repo.
  const { Agent } = (await import('undici' as any)) as any;
  return new Agent({
    connect: {
      cert: readFileSync(config.mtlsCertPath),
      key: readFileSync(config.mtlsKeyPath),
      ca: config.mtlsCaPath ? readFileSync(config.mtlsCaPath) : undefined,
    },
  });
}

function pasEndpoint(config: PasConfig): string | undefined {
  return config.davinciPasEndpoint ?? config.payerEndpoint;
}

/**
 * POST the PAS Bundle to the configured payer endpoint.
 * Fail-closed: BLOCKED when the feature flag is off or no endpoint configured.
 */
export async function submitViaPasHttp(
  request: Pick<PaRequest, 'id' | 'urgency'>,
  config: PasConfig = loadPasConfig(),
): Promise<PasSubmitOutcome> {
  const gate = submitViaPas(request, config);
  const endpoint = pasEndpoint(config);
  if (gate.status === 'BLOCKED' || !endpoint) {
    return gate.status === 'BLOCKED'
      ? gate
      : { status: 'BLOCKED', reason: 'No DAVINCI_PAS_ENDPOINT configured. No network code path may execute without explicit endpoint configuration.' };
  }
  const url = endpoint.replace(/\/$/, '') + '/$submit';
  const dispatcher = (await buildMtlsDispatcher(config).catch(() => undefined)) as any;
  const timeoutMs = config.timeoutMs ?? 15_000;
  try {
    // eslint-disable-next-line no-undef
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/fhir+json', Accept: 'application/fhir+json, application/json' },
      body: JSON.stringify(gate.bundle),
      // @ts-expect-error undici dispatcher option (mTLS) is not in the TS fetch types
      dispatcher,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    if (!res.ok) {
      return { status: 'ERROR', reason: `PAS endpoint returned HTTP ${res.status}`, httpStatus: res.status };
    }
    return { status: 'SUBMITTED', receipt: { receiptId: parsePasReceiptId(body), body }, httpStatus: res.status };
  } catch (err) {
    return { status: 'ERROR', reason: `PAS submit failed: ${(err as Error)?.message ?? String(err)}` };
  }
}

/**
 * Poll the payer for the adjudication status of a previously submitted PAS
 * transaction. GET {endpoint}/$status?id={receiptId}.
 */
export async function pollPasStatusHttp(
  receiptId: string,
  config: PasConfig = loadPasConfig(),
): Promise<PasPollOutcome> {
  const endpoint = pasEndpoint(config);
  if (!config.paApi2027Enabled || !endpoint) {
    return { reachable: false, reason: 'PAS endpoint not configured (fail-closed).' };
  }
  const url = `${endpoint.replace(/\/$/, '')}/$status?id=${encodeURIComponent(receiptId)}`;
  try {
    // eslint-disable-next-line no-undef
    const res = await fetch(url, {
      headers: { Accept: 'application/fhir+json, application/json' },
      signal: AbortSignal.timeout(config.timeoutMs ?? 15_000),
    });
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    if (!res.ok) return { reachable: true, httpStatus: res.status, body, reason: `HTTP ${res.status}` };
    return { reachable: true, httpStatus: res.status, decision: parsePasDecision(body), body };
  } catch (err) {
    return { reachable: false, reason: (err as Error)?.message ?? String(err) };
  }
}

/** Extract an adjudication decision from common FHIR/JSON status shapes. */
export function parsePasDecision(body: unknown): 'approved' | 'denied' | 'pended' | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  const direct = (b.decision ?? b.status ?? b.outcome) as string | undefined;
  const norm = (v: string) => {
    const s = v.toLowerCase();
    if (/(approv|affirm|grant)/.test(s)) return 'approved' as const;
    if (/(deni|reject)/.test(s)) return 'denied' as const;
    if (/(pend|queue|review|progress)/.test(s)) return 'pended' as const;
    return undefined;
  };
  if (direct) { const d = norm(direct); if (d) return d; }
  // FHIR ClaimResponse.outcome: complete | error | partial
  const outcome = b.outcome as string | undefined;
  if (b.resourceType === 'ClaimResponse' && outcome) {
    if (outcome === 'complete') {
      const disp = (b.disposition as string | undefined) ?? '';
      return norm(disp) ?? 'approved';
    }
    return 'pended';
  }
  return undefined;
}
