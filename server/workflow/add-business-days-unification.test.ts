/**
 * server/workflow/add-business-days-unification.test.ts
 *
 * Verifies that server/workflow/idr-workflow.ts no longer maintains its own
 * weekend-only addBusinessDays and instead delegates to the canonical
 * holiday-aware implementation in server/idr/deadlines.ts, so statutory
 * workflow deadlines skip US federal holidays identically everywhere.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn(async () => null) }));
vi.mock("../../drizzle/schema", () => ({ disputes: {}, disputeEvents: {} }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));
vi.mock("../events/bus", () => ({ eventBus: { publish: vi.fn(async () => undefined) } }));
vi.mock("../redis", () => ({ withDisputeLock: vi.fn(async (_id: string, _ttl: number, fn: () => unknown) => fn()) }));

import { addBusinessDays as workflowAddBusinessDays, IDR_WORKFLOW_STEPS } from "./idr-workflow";
import { addBusinessDays as canonicalAddBusinessDays } from "../idr/deadlines";

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("idr-workflow addBusinessDays unification", () => {
  it("delegates to the canonical holiday-aware implementation", () => {
    const start = new Date("2026-09-04T12:00:00Z"); // Friday before Labor Day
    expect(iso(workflowAddBusinessDays(start, 1))).toBe(iso(canonicalAddBusinessDays(start, 1)));
    expect(iso(workflowAddBusinessDays(start, 1))).toBe("2026-09-08"); // skips Sat/Sun AND Labor Day
  });

  it("skips observed federal holidays for years beyond any hardcoded table", () => {
    // Wed 2027-06-30 + 3 BD: Jul 4 2027 is Sunday → observed Mon Jul 5 → result Tue Jul 6
    expect(iso(workflowAddBusinessDays(new Date("2027-06-30T09:00:00Z"), 3))).toBe("2027-07-06");
  });
});

describe("workflow step statutory definitions", () => {
  it("STEP_06 joint IDRE selection deadline is 3 business days", () => {
    expect(IDR_WORKFLOW_STEPS.STEP_06_IDR_ENTITY_SELECTION.deadlineBusinessDays).toBe(3);
  });

  it("STEP_04 IDR initiation window remains 4 business days", () => {
    expect(IDR_WORKFLOW_STEPS.STEP_04_IDR_INITIATED.deadlineBusinessDays).toBe(4);
  });

  it("STEP_16 administrative fee is paid by each party (45 CFR § 149.510(d)(1))", () => {
    expect(IDR_WORKFLOW_STEPS.STEP_16_ADMINISTRATIVE_FEE_PAID.nsaReference).toBe("45 CFR § 149.510(d)(1)");
    expect(IDR_WORKFLOW_STEPS.STEP_16_ADMINISTRATIVE_FEE_PAID.description).toMatch(/each party/i);
  });
});
