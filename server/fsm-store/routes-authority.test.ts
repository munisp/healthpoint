/**
 * Route-authority checks (STATIC): assert the notice-consent, priorauth, and
 * gfe-ppdr transition procedures address cases by id only and never accept a
 * client-supplied case/state object. Complements the EXECUTED-VERIFIED store
 * tests in store.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const nc = readFileSync(path.resolve(import.meta.dirname, "../notice-consent/routes.ts"), "utf8");
const pa = readFileSync(path.resolve(import.meta.dirname, "../priorauth/routes.ts"), "utf8");
const ppdr = readFileSync(path.resolve(import.meta.dirname, "../gfe-ppdr/routes.ts"), "utf8");

function transitionBlock(src: string): string {
  // Limit the window to the transition procedure itself (later procedures may
  // legitimately reference legacy schemas for pure read-only queries).
  return src.slice(src.indexOf("transition: protectedProcedure")).slice(0, 1200);
}

describe("FSM routes are server-authoritative (STATIC)", () => {
  it("notice-consent transition takes caseId, not a client case object", () => {
    const block = transitionBlock(nc);
    expect(block).toMatch(/caseId:\s*idSchema/);
    expect(block).not.toMatch(/case:\s*noticeConsentCaseSchema/);
    expect(nc).not.toMatch(/noticeConsentCaseSchema/);
    expect(nc).toMatch(/getFsmCaseStore\(\)\.transitionCase/);
  });

  it("priorauth transition takes requestId, not a client request object", () => {
    const block = transitionBlock(pa);
    expect(block).toMatch(/requestId:\s*idSchema/);
    expect(block).not.toMatch(/request:\s*paRequestSchema/);
    expect(pa).toMatch(/getFsmCaseStore\(\)\.transitionCase/);
  });

  it("gfe-ppdr transition takes disputeId, not a client dispute object", () => {
    const block = transitionBlock(ppdr);
    expect(block).toMatch(/disputeId:\s*idSchema/);
    expect(block).not.toMatch(/dispute:\s*ppdrDisputeSchema/);
    expect(ppdr).not.toMatch(/ppdrDisputeSchema/);
    expect(ppdr).toMatch(/getFsmCaseStore\(\)\.transitionCase/);
  });

  it("each router keeps a create/get pair backed by the fsm-store", () => {
    for (const src of [nc, pa, ppdr]) {
      expect(src).toMatch(/getFsmCaseStore\(\)\.createCase/);
      expect(src).toMatch(/getFsmCaseStore\(\)\.getCase/);
      expect(src).toMatch(/verifyEventChain/);
    }
  });
});
