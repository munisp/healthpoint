import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLog } from "../drizzle/schema";
import { createAuditEntry, getDb, listAuditEntries } from "./db";
import { runControlledTemporalDispatchDrill } from "./temporal";

describe("controlled Temporal dispatch drill evidence", () => {
  let auditId: string | undefined;

  afterEach(async () => {
    if (!auditId) return;
    const db = await getDb();
    await db?.delete(auditLog).where(eq(auditLog.id, auditId));
    auditId = undefined;
  });

  it("records a synthetic mock-transport drill as durable audit evidence without a real dispute", async () => {
    process.env.PAYMENT_EXECUTION_MODE = "disabled";
    const drill = runControlledTemporalDispatchDrill("temporal-drill-test", new Date("2026-08-19T12:00:00.000Z"));
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

    const history = await listAuditEntries({ entityType: "temporal_dispatch", limit: 10 });
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
