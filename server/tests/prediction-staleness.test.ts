/**
 * server/tests/prediction-staleness.test.ts
 *
 * Wave-W3 prediction staleness flow:
 *   - lifecycle events (dispute.advanced / offers / determination / payment)
 *     mark outcome_predictions.isStale = true via the event bus
 *   - getOutcomePrediction surfaces the flag as { stale }
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const executedSql: string[] = [];

vi.mock("../db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    getDb: async () => ({
      select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) }),
      execute: async (q: any) => {
        executedSql.push(JSON.stringify(q?.queryChunks ?? q ?? {}));
        return { rows: [] };
      },
    }),
  };
});

// webhook-dispatcher is exercised by the bus "*" consumer; keep it quiet.
vi.mock("../webhook-dispatcher", () => ({ dispatchWebhooksForEvent: async () => {} }));

import { eventBus } from "../events/bus";

describe("prediction staleness listeners", () => {
  beforeEach(() => {
    executedSql.length = 0;
  });

  for (const eventType of [
    "dispute.advanced",
    "dispute.offer_submitted",
    "offer.accepted",
    "offer.rejected",
    "determination.issued",
    "payment.recorded",
    "payment.settled",
  ] as const) {
    it(`${eventType} marks predictions stale`, async () => {
      eventBus.emit(eventType, {
        id: "evt-1",
        eventType,
        aggregateId: "disp-42",
        aggregateType: "dispute",
        payload: {},
        timestamp: new Date(),
      } as any);
      await new Promise(r => setTimeout(r, 250)); // listener is fire-and-forget (100ms)
      const staleWrites = executedSql.filter(s => s.includes("isStale"));
      expect(staleWrites.length).toBeGreaterThan(0);
      expect(staleWrites[0]).toContain("disp-42");
    });
  }
});
