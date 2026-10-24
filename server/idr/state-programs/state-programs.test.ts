import { beforeEach, describe, expect, it } from 'vitest';

import {
  REGISTRY_METADATA,
  StateProgramRegistrationError,
  clearRegistry,
  getStateProgram,
  hasStateProgram,
  listRegisteredStates,
  registerStateProgram,
} from './registry';
import { JurisdictionInputError, resolveJurisdiction } from './resolver';
import type { StateProgramEntry } from './types';

const baseInput = {
  planType: 'FULLY_INSURED' as const,
  stateCode: 'TX',
  serviceCategory: 'EMERGENCY' as const,
  dateOfService: '2026-09-01',
};

function makeEntry(overrides: Partial<StateProgramEntry> = {}): StateProgramEntry {
  return {
    stateCode: 'TX',
    programName: 'Test State Program',
    appliesToFullyInsured: true,
    selfFundedOptIn: 'UNKNOWN',
    scopeVsFederal: 'PARTIAL',
    paymentDeterminationMethod: 'UNKNOWN',
    keyDeadlines: [],
    effectiveDates: [],
    authorityUrl: null,
    verificationStatus: 'UNVERIFIED',
    notes: 'Synthetic test entry; not a real state program.',
    ...overrides,
  };
}

beforeEach(() => clearRegistry());

describe('registry metadata', () => {
  it('exposes verified aggregate facts only', () => {
    expect(REGISTRY_METADATA.statesWithSomeProtections).toBe(22);
    expect(REGISTRY_METADATA.bifurcatedOfThose).toBe(21);
    expect(REGISTRY_METADATA.asOf).toBe('2024-07');
  });

  it('ships with zero hardcoded per-state entries', () => {
    expect(listRegisteredStates()).toEqual([]);
    expect(hasStateProgram('TX')).toBe(false);
  });
});

describe('registerStateProgram verification enforcement', () => {
  it('accepts an UNVERIFIED entry with empty citations', () => {
    const stored = registerStateProgram(makeEntry());
    expect(stored.stateCode).toBe('TX');
    expect(hasStateProgram('TX')).toBe(true);
  });

  it('rejects VERIFIED entry when authorityUrl is null', () => {
    expect(() =>
      registerStateProgram(makeEntry({ verificationStatus: 'VERIFIED' })),
    ).toThrow(StateProgramRegistrationError);
  });

  it('rejects VERIFIED entry when a deadline citation is empty', () => {
    expect(() =>
      registerStateProgram(
        makeEntry({
          verificationStatus: 'VERIFIED',
          authorityUrl: 'https://example.gov/statute',
          keyDeadlines: [{ name: 'Open negotiation', calendarDays: 30, citation: '  ' }],
        }),
      ),
    ).toThrow(/empty citation/);
  });

  it('accepts VERIFIED entry when all citations are non-empty', () => {
    const stored = registerStateProgram(
      makeEntry({
        verificationStatus: 'VERIFIED',
        authorityUrl: 'https://example.gov/statute',
        keyDeadlines: [{ name: 'Open negotiation', calendarDays: 30, citation: 'Test Code § 1.1' }],
      }),
    );
    expect(stored.verificationStatus).toBe('VERIFIED');
  });

  it('rejects malformed state codes', () => {
    expect(() => registerStateProgram(makeEntry({ stateCode: 'texas' }))).toThrow(
      StateProgramRegistrationError,
    );
    expect(() => registerStateProgram(makeEntry({ stateCode: 'T1' }))).toThrow(
      StateProgramRegistrationError,
    );
  });

  it('re-registering a state replaces the prior entry', () => {
    registerStateProgram(makeEntry({ programName: 'Old' }));
    registerStateProgram(makeEntry({ programName: 'New' }));
    expect(getStateProgram('TX')?.programName).toBe('New');
    expect(listRegisteredStates()).toEqual(['TX']);
  });
});

describe('resolveJurisdiction — self-funded branch', () => {
  it('self-funded with no registered program → FEDERAL', () => {
    const r = resolveJurisdiction({ ...baseInput, planType: 'SELF_FUNDED' });
    expect(r.regime).toBe('FEDERAL');
    expect(r.rationale).toMatch(/45 CFR 149/);
  });

  it('self-funded + opt-in-capable state + optedIn=true → STATE', () => {
    registerStateProgram(makeEntry({ selfFundedOptIn: true }));
    const r = resolveJurisdiction({ ...baseInput, planType: 'SELF_FUNDED', optedIn: true });
    expect(r.regime).toBe('STATE');
    expect(r.stateProgramId).toBe('TX');
  });

  it('self-funded + opt-in-capable state but optedIn not true → FEDERAL with warning', () => {
    registerStateProgram(makeEntry({ selfFundedOptIn: true }));
    const r = resolveJurisdiction({ ...baseInput, planType: 'SELF_FUNDED' });
    expect(r.regime).toBe('FEDERAL');
    expect(r.warnings.join(' ')).toMatch(/optedIn was not set/);
  });

  it('self-funded + opt-in UNKNOWN + caller asserts optedIn → fails closed to FEDERAL', () => {
    registerStateProgram(makeEntry({ selfFundedOptIn: 'UNKNOWN' }));
    const r = resolveJurisdiction({ ...baseInput, planType: 'SELF_FUNDED', optedIn: true });
    expect(r.regime).toBe('FEDERAL');
    expect(r.warnings.join(' ')).toMatch(/failing closed to FEDERAL/);
  });
});

describe('resolveJurisdiction — fully-insured branches', () => {
  it('unregistered state → FEDERAL with note', () => {
    const r = resolveJurisdiction(baseInput);
    expect(r.regime).toBe('FEDERAL');
    expect(r.warnings.join(' ')).toMatch(/No registered state program/);
    expect(r.rationale).toMatch(/not proof that no state law applies/);
  });

  it('registered PARTIAL program → BIFURCATED_SPLIT explaining federal out-of-scope coverage', () => {
    registerStateProgram(makeEntry({ scopeVsFederal: 'PARTIAL' }));
    const r = resolveJurisdiction(baseInput);
    expect(r.regime).toBe('BIFURCATED_SPLIT');
    expect(r.stateProgramId).toBe('TX');
    expect(r.rationale).toMatch(/bifurcated/i);
    expect(r.rationale).toMatch(/out-of-scope/i);
    expect(r.warnings.join(' ')).toMatch(/in-scope \(STATE\) or out-of-scope \(FEDERAL\)/);
  });

  it('registered FULL program → STATE', () => {
    registerStateProgram(makeEntry({ scopeVsFederal: 'FULL' }));
    const r = resolveJurisdiction(baseInput);
    expect(r.regime).toBe('STATE');
    expect(r.stateProgramId).toBe('TX');
  });

  it('registered UNKNOWN scope → fails closed to FEDERAL with warning', () => {
    registerStateProgram(makeEntry({ scopeVsFederal: 'UNKNOWN' }));
    const r = resolveJurisdiction(baseInput);
    expect(r.regime).toBe('FEDERAL');
    expect(r.verificationStatus).toBe('UNVERIFIED');
    expect(r.warnings.join(' ')).toMatch(/failing closed to FEDERAL/);
  });

  it('UNVERIFIED registered program adds a provisional-resolution warning', () => {
    registerStateProgram(makeEntry({ scopeVsFederal: 'FULL' }));
    const r = resolveJurisdiction(baseInput);
    expect(r.warnings.join(' ')).toMatch(/UNVERIFIED/);
  });
});

describe('resolveJurisdiction — fail-closed inputs', () => {
  it('throws on unknown planType', () => {
    expect(() =>
      resolveJurisdiction({ ...baseInput, planType: 'HYBRID' as never }),
    ).toThrow(JurisdictionInputError);
  });

  it('throws on malformed stateCode', () => {
    expect(() => resolveJurisdiction({ ...baseInput, stateCode: 'texas' })).toThrow(
      JurisdictionInputError,
    );
    expect(() => resolveJurisdiction({ ...baseInput, stateCode: '' })).toThrow(
      JurisdictionInputError,
    );
  });

  it('throws on unknown serviceCategory and malformed dateOfService', () => {
    expect(() =>
      resolveJurisdiction({ ...baseInput, serviceCategory: 'DENTAL' as never }),
    ).toThrow(JurisdictionInputError);
    expect(() => resolveJurisdiction({ ...baseInput, dateOfService: '09/01/2026' })).toThrow(
      JurisdictionInputError,
    );
  });
});
