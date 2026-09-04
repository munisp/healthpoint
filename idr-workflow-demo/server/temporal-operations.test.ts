import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLog } from "../drizzle/schema";
import { createAuditEntry, getDb, listAuditEntries } from "./db";
import { runControlledTemporalDispatchDrill } from "./temporal";

function runNoNetworkTemporalDrill() {
  process.env.PAYMENT_EXECUTION_MODE = "disabled";
  return runControlledTemporalDispatchDrill(
    "temporal-drill-test",
    new Date("2026-08-19T12:00:00.000Z"),
  );
}

describe("controlled Temporal dispatch drill safety", () => {
  it("creates a no-network, payment-disabled drill envelope", () => {
    const drill = runNoNetworkTemporalDrill();

    expect(drill).toMatchObject({
      transport: "mock",
      outcome: "verified_no_network_dispatch",
      paymentExecution: "disabled",
    });
    expect(drill.syntheticDisputeId).toMatch(/^synthetic-tdr_[0-9a-f-]{36}$/);
  });
});

const runPostgresIntegrationTests = process.env.RUN_POSTGRES_INTEGRATION_TESTS === "true";
const describePostgresIntegration = runPostgresIntegrationTests ? describe : describe.skip;

describePostgresIntegration("controlled Temporal dispatch durable audit evidence", () => {
  let auditId: string | undefined;

  afterEach(async () => {
    if (!auditId) return;
    const db = await getDb();
    await db?.delete(auditLog).where(eq(auditLog.id, auditId));
    auditId = undefined;
  });

  it("persists the no-network drill as PostgreSQL audit evidence without a real dispute", async () => {
    const drill = runNoNetworkTemporalDrill();
    const entry = await createAuditEntry({
      userId: "temporal-drill-test",
      action: "temporal.controlled_drill.verified",
      entityType: "temporal_dispatch",
      entityId: drill.drillId,
      oldValue: null,
      newValue: JSON.stringify(drill),
      ipAddress: null,
      userAgent: null,
    });
    auditId = entry.id;

    const history = await listAuditEntries({
      entityType: "temporal_dispatch",
      limit: 10,
    });
    const persisted = history.find(item => item.id === entry.id);
    expect(persisted?.entityId).toBe(drill.drillId);
    expect(persisted?.action).toBe("temporal.controlled_drill.verified");
    expect(JSON.parse(persisted?.newValue ?? "{}")).toMatchObject({
      transport: "mock",
      outcome: "verified_no_network_dispatch",
      paymentExecution: "disabled",
      syntheticDisputeId: drill.syntheticDisputeId,
    });
  });
});
