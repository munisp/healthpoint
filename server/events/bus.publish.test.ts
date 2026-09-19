/**
 * Phase 13 FB (O9): previously-starved bus topics must (a) be deliverable
 * through the bus to subscribers and (b) have real publish call sites at the
 * mutation handlers (static wiring assertion against the source).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eventBus, type IDREvent, type IDREventType } from "./bus";

describe("event bus starvation fix (O9)", () => {
  it("delivers previously-starved topics to subscribers", async () => {
    const received: IDREvent[] = [];
    const topics: IDREventType[] = ["dispute.created", "document.uploaded", "payment.recorded"];
    const listeners = topics.map((t) => {
      const fn = (e: IDREvent) => received.push(e);
      eventBus.on(t, fn);
      return { t, fn };
    });
    try {
      for (const t of topics) {
        await eventBus.publish(t, "agg-1", "dispute", { probe: true }, { timestamp: new Date().toISOString() });
      }
      expect(received.map((e) => e.eventType).sort()).toEqual([...topics].sort());
      // Topic mapping still correct for the starved types
      expect(received.find((e) => e.eventType === "dispute.created")?.topic).toBe("idr.disputes.state_changes");
      expect(received.find((e) => e.eventType === "document.uploaded")?.topic).toBe("idr.documents");
      expect(received.find((e) => e.eventType === "payment.recorded")?.topic).toBe("idr.payments");
    } finally {
      for (const { t, fn } of listeners) eventBus.off(t, fn);
    }
  });

  it("mutation sites publish the previously-starved topics (source wiring)", () => {
    const routers = readFileSync(join(__dirname, "..", "routers.ts"), "utf8");
    const lifecycle = readFileSync(join(__dirname, "..", "settlement-lifecycle.ts"), "utf8");
    const expiry = readFileSync(join(__dirname, "..", "notice-consent", "expiry.ts"), "utf8");
    for (const t of [
      "dispute.created",
      "dispute.closed",
      "dispute.offer_submitted",
      "dispute.arbitrator_selected",
      "document.uploaded",
      "document.analyzed",
      "offer.accepted",
      "offer.rejected",
      "determination.issued",
      "payment.recorded",
      "notification.sent",
    ] as const) {
      expect(routers.includes(`"${t}"`), `routers.ts missing publish for ${t}`).toBe(true);
    }
    expect(lifecycle.includes('"payment.settled"')).toBe(true);
    expect(lifecycle.includes('"payment.settlement_failed"')).toBe(true);
    expect(expiry.includes('"consent.expired"')).toBe(true);
  });
});
