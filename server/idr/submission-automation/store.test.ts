import { describe, it, expect } from 'vitest';
import {
  InMemorySubmissionStore,
  VersionConflictError,
  DuplicateSubmissionError,
  SubmissionNotFoundError,
  verifyChain,
  hashEvent,
  canonicalJson,
  GENESIS_HASH,
  ChainedEvent,
} from './store';
import { InvalidTransitionError } from './submission-fsm';
import { recordDeterminationWithStore, DeterminationValidationError, OutcomeTelemetry } from './feedback';

const NOW = new Date('2026-09-05T12:00:00.000Z');
const ATTEST = { actorId: 'user-42', attestedAt: '2026-09-05T12:00:00.000Z' };

async function toOfferSubmitted(store: InMemorySubmissionStore) {
  await store.createSubmission({ tenantId: 'T-1', disputeId: 'D-1', now: NOW });
  await store.transitionSubmission('T-1', 'D-1', { to: 'PACKAGE_READY', now: NOW });
  await store.transitionSubmission('T-1', 'D-1', { to: 'SUBMITTED', attestation: ATTEST, now: NOW });
  await store.transitionSubmission('T-1', 'D-1', {
    to: 'ACKNOWLEDGED',
    cmsDisputeReferenceNumber: 'IDR-2026-123456',
    now: NOW,
  });
  await store.transitionSubmission('T-1', 'D-1', { to: 'IDRE_ASSIGNED', now: NOW });
  return store.transitionSubmission('T-1', 'D-1', { to: 'OFFER_SUBMITTED', now: NOW });
}

const DETERMINATION = {
  idreId: 'IDRE-9',
  determinationDate: '2026-09-05',
  prevailingParty: 'initiating' as const,
  prevailingOffer: 1200,
  qpa: 1000,
  otherOffer: 800,
  rationaleFactors: ['QPA proximity'],
  adminFeeAmount: 15,
  idreFeeAmount: 400,
};

describe('submission-automation store', () => {
  it('creates a DRAFT submission at version 1 with a genesis-chained event', async () => {
    const store = new InMemorySubmissionStore();
    const s = await store.createSubmission({ tenantId: 'T-1', disputeId: 'D-1', now: NOW });
    expect(s.state).toBe('DRAFT');
    expect(s.version).toBe(1);
    const log = await store.getEventLog('T-1', 'D-1');
    expect(log).toHaveLength(1);
    expect(log[0].prevEventHash).toBe(GENESIS_HASH);
    expect(log[0].eventHash).toBe(
      hashEvent(GENESIS_HASH, { seq: log[0].seq, from: log[0].from, to: log[0].to, at: log[0].at, actorId: log[0].actorId, detail: log[0].detail })
    );
  });

  it('rejects a second ACTIVE submission with DuplicateSubmissionError carrying the existing id', async () => {
    const store = new InMemorySubmissionStore();
    const first = await store.createSubmission({ tenantId: 'T-1', disputeId: 'D-1' });
    await expect(store.createSubmission({ tenantId: 'T-1', disputeId: 'D-1' })).rejects.toMatchObject({
      name: 'DuplicateSubmissionError',
      existingSubmissionId: first.id,
    });
  });

  it('allows a new submission after the prior one is WITHDRAWN', async () => {
    const store = new InMemorySubmissionStore();
    await store.createSubmission({ tenantId: 'T-1', disputeId: 'D-1' });
    await store.transitionSubmission('T-1', 'D-1', { to: 'PACKAGE_READY' });
    await store.transitionSubmission('T-1', 'D-1', { to: 'WITHDRAWN' });
    const second = await store.createSubmission({ tenantId: 'T-1', disputeId: 'D-1' });
    expect(second.state).toBe('DRAFT');
  });

  it('allows a new submission after the prior one is CLOSED', async () => {
    const store = new InMemorySubmissionStore();
    await store.createSubmission({ tenantId: 'T-1', disputeId: 'D-1' });
    await store.transitionSubmission('T-1', 'D-1', { to: 'PACKAGE_READY' });
    await store.transitionSubmission('T-1', 'D-1', { to: 'SUBMITTED', attestation: ATTEST });
    await store.transitionSubmission('T-1', 'D-1', { to: 'ACKNOWLEDGED', cmsDisputeReferenceNumber: 'IDR-1' });
    await store.transitionSubmission('T-1', 'D-1', { to: 'IDRE_ASSIGNED' });
    await store.transitionSubmission('T-1', 'D-1', { to: 'OFFER_SUBMITTED' });
    await store.transitionSubmission('T-1', 'D-1', { to: 'DETERMINATION_RECEIVED' });
    await store.transitionSubmission('T-1', 'D-1', { to: 'PAYMENT_TRACKING' });
    await store.transitionSubmission('T-1', 'D-1', { to: 'CLOSED' });
    const second = await store.createSubmission({ tenantId: 'T-1', disputeId: 'D-1' });
    expect(second.state).toBe('DRAFT');
  });

  it('replayed createSubmission idempotencyKey returns the same submission without a duplicate error', async () => {
    const store = new InMemorySubmissionStore();
    const a = await store.createSubmission({ tenantId: 'T-1', disputeId: 'D-1', idempotencyKey: 'K-1' });
    const b = await store.createSubmission({ tenantId: 'T-1', disputeId: 'D-1', idempotencyKey: 'K-1' });
    expect(b.id).toBe(a.id);
    expect(b.version).toBe(a.version);
  });

  it('increments version on every transition and appends chained events', async () => {
    const store = new InMemorySubmissionStore();
    await store.createSubmission({ tenantId: 'T-1', disputeId: 'D-1' });
    const s1 = await store.transitionSubmission('T-1', 'D-1', { to: 'PACKAGE_READY' });
    expect(s1.version).toBe(2);
    const s2 = await store.transitionSubmission('T-1', 'D-1', { to: 'SUBMITTED', attestation: ATTEST });
    expect(s2.version).toBe(3);
    const log = await store.getEventLog('T-1', 'D-1');
    expect(log.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(log[2].prevEventHash).toBe(log[1].eventHash);
  });

  it('rejects invalid transitions through the store (fail-closed guard)', async () => {
    const store = new InMemorySubmissionStore();
    await store.createSubmission({ tenantId: 'T-1', disputeId: 'D-1' });
    await expect(
      store.transitionSubmission('T-1', 'D-1', { to: 'CLOSED' })
    ).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it('CAS: a concurrent version bump between load and persist yields VersionConflictError', async () => {
    class ConflictStore extends InMemorySubmissionStore {
      armed = true;
      override async getActiveSubmission(t: string, d: string) {
        const s = await super.getActiveSubmission(t, d);
        if (this.armed && s) {
          this.armed = false;
          // Simulate a racing writer: bump the stored version after our load.
          (this as unknown as { submissions: Map<string, { version: number }> })
            .submissions.get(s.id)!.version += 1;
        }
        return s;
      }
    }
    const store = new ConflictStore();
    await store.createSubmission({ tenantId: 'T-1', disputeId: 'D-1' });
    await expect(
      store.transitionSubmission('T-1', 'D-1', { to: 'PACKAGE_READY' })
    ).rejects.toBeInstanceOf(VersionConflictError);
  });

  it('replayed transition idempotencyKey returns the prior result without double-applying', async () => {
    const store = new InMemorySubmissionStore();
    await store.createSubmission({ tenantId: 'T-1', disputeId: 'D-1' });
    const a = await store.transitionSubmission('T-1', 'D-1', { to: 'PACKAGE_READY', idempotencyKey: 'T-K' });
    const b = await store.transitionSubmission('T-1', 'D-1', { to: 'PACKAGE_READY', idempotencyKey: 'T-K' });
    expect(b.version).toBe(a.version);
    expect(b.state).toBe('PACKAGE_READY');
    const log = await store.getEventLog('T-1', 'D-1');
    expect(log).toHaveLength(2); // create + one transition only
  });

  it('throws SubmissionNotFoundError for unknown dispute', async () => {
    const store = new InMemorySubmissionStore();
    await expect(
      store.transitionSubmission('T-1', 'NOPE', { to: 'PACKAGE_READY' })
    ).rejects.toBeInstanceOf(SubmissionNotFoundError);
  });

  it('verifyEventChain passes for an untouched chain', async () => {
    const store = new InMemorySubmissionStore();
    await toOfferSubmitted(store);
    const v = await store.verifyEventChain('T-1', 'D-1');
    expect(v).toEqual({ ok: true, eventCount: 6 });
  });

  it('detects tampering when an event detail is altered after the fact', async () => {
    const store = new InMemorySubmissionStore();
    await store.createSubmission({ tenantId: 'T-1', disputeId: 'D-1' });
    await store.transitionSubmission('T-1', 'D-1', { to: 'PACKAGE_READY' });
    const events = (store as unknown as { events: Map<string, ChainedEvent[]> }).events;
    const chain = events.get([...events.keys()][0])!;
    chain[1].detail = 'forged by attacker';
    const v = await store.verifyEventChain('T-1', 'D-1');
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/eventHash mismatch/);
  });

  it('detects tampering when the prevEventHash link is broken', async () => {
    const store = new InMemorySubmissionStore();
    await store.createSubmission({ tenantId: 'T-1', disputeId: 'D-1' });
    await store.transitionSubmission('T-1', 'D-1', { to: 'PACKAGE_READY' });
    const log = await store.getEventLog('T-1', 'D-1');
    log[1].prevEventHash = 'f'.repeat(64);
    const v = verifyChain(log);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/prevEventHash mismatch/);
  });

  it('detects a sequence gap (deleted event)', async () => {
    const store = new InMemorySubmissionStore();
    await store.createSubmission({ tenantId: 'T-1', disputeId: 'D-1' });
    await store.transitionSubmission('T-1', 'D-1', { to: 'PACKAGE_READY' });
    const log = await store.getEventLog('T-1', 'D-1');
    const v = verifyChain([log[1]]); // genesis event removed
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/seq gap/);
  });

  it('canonicalJson is key-order independent', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
});

describe('recordDeterminationWithStore', () => {
  it('fails closed when no active submission exists', async () => {
    const store = new InMemorySubmissionStore();
    await expect(
      recordDeterminationWithStore('T-1', 'D-1', DETERMINATION, store)
    ).rejects.toBeInstanceOf(DeterminationValidationError);
  });

  it('fails closed when the submission is not in a determination-appropriate state', async () => {
    const store = new InMemorySubmissionStore();
    await store.createSubmission({ tenantId: 'T-1', disputeId: 'D-1' }); // DRAFT
    await expect(
      recordDeterminationWithStore('T-1', 'D-1', DETERMINATION, store)
    ).rejects.toMatchObject({ name: 'DeterminationValidationError' });
  });

  it('records from OFFER_SUBMITTED, auto-transitions to DETERMINATION_RECEIVED, and emits telemetry', async () => {
    const store = new InMemorySubmissionStore();
    await toOfferSubmitted(store);
    const seen: OutcomeTelemetry[] = [];
    const rec = await recordDeterminationWithStore('T-1', 'D-1', DETERMINATION, store, (t) => seen.push(t));
    expect(rec.paymentDueDate).toBe('2026-10-05');
    expect(seen).toHaveLength(1);
    const after = await store.getActiveSubmission('T-1', 'D-1');
    expect(after!.state).toBe('DETERMINATION_RECEIVED');
    // PAYMENT_TRACKING is NOT automatic — remains an explicit step.
    expect(after!.state).not.toBe('PAYMENT_TRACKING');
  });

  it('records from DETERMINATION_RECEIVED without re-transitioning', async () => {
    const store = new InMemorySubmissionStore();
    await toOfferSubmitted(store);
    await store.transitionSubmission('T-1', 'D-1', { to: 'DETERMINATION_RECEIVED' });
    const before = await store.getEventLog('T-1', 'D-1');
    await recordDeterminationWithStore('T-1', 'D-1', DETERMINATION, store);
    const after = await store.getEventLog('T-1', 'D-1');
    expect(after.length).toBe(before.length);
  });
});
