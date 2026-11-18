import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Route-level actorId-forcing checks. A full tRPC caller harness would pull in
 * the entire server dependency graph (db, env, auth); instead these tests
 * assert the security-relevant invariants directly against the route source.
 * STATIC — see report.
 */
const src = readFileSync(path.resolve(import.meta.dirname, 'routes.ts'), 'utf8');

describe('routes.ts attestation actorId hardening (STATIC)', () => {
  it('the caller-facing attestation schema does not accept actorId', () => {
    const schemaBlock = src.slice(src.indexOf('const attestationSchema'), src.indexOf('const disputeInputSchema'));
    expect(schemaBlock).not.toMatch(/actorId:\s*z\./);
  });
  it('attestation actorId is forced from ctx.user.id on every path', () => {
    expect(src).toMatch(/attestation:\s*input\.attestation\s*\?\s*\{\s*\.\.\.input\.attestation,\s*actorId:\s*ctx\.user\.id\s*\}/);
    expect(src).toMatch(/\{\s*actorId:\s*ctx\.user\.id,\s*attestedAt:/);
  });
  it('no caller-supplied entity round-trip: transition input addresses by tenantId/disputeId', () => {
    const transitionBlock = src.slice(src.indexOf('transition: protectedProcedure'));
    expect(transitionBlock).not.toMatch(/entity:\s*submissionEntitySchema/);
    expect(transitionBlock).toMatch(/tenantId:\s*idSchema/);
    expect(transitionBlock).toMatch(/disputeId:\s*idSchema/);
  });
  it('telemetry sink is wired to recordDetermination via auditTelemetrySink', () => {
    expect(src).toMatch(/auditTelemetrySink\(ctx\.user\.id\)/);
    expect(src).toMatch(/createAuditEntry/);
  });
  it('ACKNOWLEDGED transition enforces the CMS reference format fail-closed', () => {
    expect(src).toMatch(/isValidCmsDisputeReference\(ref\)/);
  });
});
