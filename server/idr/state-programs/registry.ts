/**
 * HealthPoint NSA/IDR — State IDR Program Registry.
 *
 * VERIFIED aggregate facts (Peterson-KFF Health System Tracker explainer,
 * as of 2024-07; federal NSA framework):
 *  - 22 states have some surprise-billing protections applying to
 *    fully-insured plans.
 *  - In 21 of those 22, state law covers only a PORTION of federal
 *    surprise-billing protections ("bifurcated process": federal IDR
 *    applies where the bill is not covered under state law).
 *  - Some states permit self-funded employer plans to opt into the state
 *    process.
 *  - Federal floor: NSA / 45 CFR 149 applies to self-funded plans
 *    everywhere and to fully-insured coverage where no specified state
 *    law applies.
 *
 * CMS-9897-F context (federal rules continue to evolve):
 *  - $15 administrative fee for disputes initiated on/after 2026-06-11.
 *  - 50-item batching cap for open negotiation periods beginning on/after
 *    2026-11-01.
 *
 * HONESTY: per-state specifics are NOT verified in our source set, so this
 * module ships ZERO hardcoded per-state factual entries. Entries are added
 * at runtime via registerStateProgram(). registerStateProgram REJECTS any
 * entry claiming verificationStatus 'VERIFIED' unless every citation
 * field is non-empty (deadline citations AND a non-null authorityUrl).
 */

import type {
  RegistryMetadata,
  StateProgramEntry,
} from './types';

export const REGISTRY_METADATA: RegistryMetadata = {
  statesWithSomeProtections: 22,
  bifurcatedOfThose: 21,
  source: 'Peterson-KFF Health System Tracker explainer',
  asOf: '2024-07',
};

const STATE_CODE_RE = /^[A-Z]{2}$/;

const entries = new Map<string, StateProgramEntry>();

export class StateProgramRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StateProgramRegistrationError';
  }
}

/** Normalizes and validates the state code; throws on bad format. */
function normalizeStateCode(code: unknown): string {
  if (typeof code !== 'string' || !STATE_CODE_RE.test(code)) {
    throw new StateProgramRegistrationError(
      `Invalid stateCode: expected 2-letter uppercase USPS code, got ${JSON.stringify(code)}`,
    );
  }
  return code;
}

/**
 * Registers a state program entry. Fail-closed:
 *  - Rejects malformed state codes.
 *  - Rejects any entry claiming VERIFIED status unless every citation
 *    field is non-empty: every keyDeadline must have a non-empty
 *    `citation`, and `authorityUrl` must be a non-null, non-empty string.
 *
 * Re-registering the same stateCode replaces the prior entry.
 * Returns the stored entry (defensive copy).
 */
export function registerStateProgram(
  entry: StateProgramEntry,
): StateProgramEntry {
  if (entry === null || typeof entry !== 'object') {
    throw new StateProgramRegistrationError('Entry must be an object.');
  }
  const stateCode = normalizeStateCode(entry.stateCode);

  if (entry.verificationStatus !== 'VERIFIED' && entry.verificationStatus !== 'UNVERIFIED') {
    throw new StateProgramRegistrationError(
      `verificationStatus must be 'VERIFIED' or 'UNVERIFIED', got ${JSON.stringify(entry.verificationStatus)}`,
    );
  }

  if (entry.verificationStatus === 'VERIFIED') {
    const deadlines = Array.isArray(entry.keyDeadlines) ? entry.keyDeadlines : [];
    const missingCitation = deadlines.find(
      (d) => typeof d.citation !== 'string' || d.citation.trim().length === 0,
    );
    if (missingCitation) {
      throw new StateProgramRegistrationError(
        `VERIFIED entry for ${stateCode} rejected: deadline "${missingCitation.name}" has an empty citation.`,
      );
    }
    if (typeof entry.authorityUrl !== 'string' || entry.authorityUrl.trim().length === 0) {
      throw new StateProgramRegistrationError(
        `VERIFIED entry for ${stateCode} rejected: authorityUrl is null/empty.`,
      );
    }
  }

  const stored: StateProgramEntry = {
    ...entry,
    stateCode,
    keyDeadlines: (entry.keyDeadlines ?? []).map((d) => ({ ...d })),
    effectiveDates: (entry.effectiveDates ?? []).map((r) => ({ ...r })),
  };
  entries.set(stateCode, stored);
  return { ...stored };
}

/** Looks up a registered program by state code; undefined if absent. */
export function getStateProgram(stateCode: string): StateProgramEntry | undefined {
  const found = entries.get(normalizeStateCode(stateCode));
  return found ? { ...found } : undefined;
}

/** True if a program is registered for the state code. */
export function hasStateProgram(stateCode: string): boolean {
  return entries.has(normalizeStateCode(stateCode));
}

/** All registered state codes, sorted. */
export function listRegisteredStates(): string[] {
  return [...entries.keys()].sort();
}

/** Test hook: clears all runtime-registered entries. */
export function clearRegistry(): void {
  entries.clear();
}
