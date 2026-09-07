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
}

export function loadPasConfig(env: Record<string, string | undefined> = defaultEnv()): PasConfig {
  return {
    paApi2027Enabled: env.PA_API_2027_ENABLED === 'true',
    payerEndpoint: env.PA_PAYER_ENDPOINT,
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
  if (!config.payerEndpoint) {
    return {
      status: 'BLOCKED',
      reason:
        'No payer PAS endpoint configured (PA_PAYER_ENDPOINT unset). No ' +
        'network code path may execute without explicit endpoint configuration.',
    };
  }
  // STATIC-ONLY: prepare the payload; transport is intentionally not wired.
  return { status: 'READY', bundle: buildPasBundle(request) };
}
