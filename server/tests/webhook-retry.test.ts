/**
 * server/tests/webhook-retry.test.ts
 *
 * Wave-W3 webhook delivery remediation:
 *   - backoff schedule: attempts at 0 / 1m / 5m / 15m / 1h, then terminal
 *   - X-HealthPoint-Event header carries the event TYPE only (never the body)
 *   - every attempt is recorded on the webhook_deliveries row (attempts,
 *     responseStatus, nextRetryAt, durationMs via raw SQL)
 *   - auto-disable writes webhooks.status='failed' (not a bogus `active` col)
 *
 * `../db` is replaced with an in-memory fake at the module boundary; fetch is
 * stubbed per-test. Timers are exercised via the pure computeNextRetryAt
 * schedule plus vi.setSystemTime for nextRetryAt assertions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeWebhook { id: string; url: string; secret: string; events: string; status: string; failureCount: number; }
interface FakeDelivery {
  id: string; webhookId: string; eventType: string; payload: string;
  status: string; attempts: number; lastAttemptAt: Date | null; nextRetryAt: Date | null;
  responseStatus: number | null; errorMessage: string | null; durationMs?: number;
}

const state = {
  webhooks: [] as FakeWebhook[],
  deliveries: [] as FakeDelivery[],
  webhookUpdates: [] as Array<Record<string, unknown>>,
};

function fakeDb() {
  return {
    select: (fields?: any) => ({
      from: (table: any) => ({
        where: (..._args: any[]) => {
          const rows = table?._name === "webhooks" ? state.webhooks : state.deliveries;
          const limited = {
            limit: async (_n: number) => rows.slice(0, _n),
            then: (resolve: any) => resolve(fields ? rows.map(r => ({ id: r.id })) : rows),
          };
          return limited;
        },
      }),
    }),
    insert: (_table: any) => ({
      values: async (v: any) => { state.deliveries.push({ lastAttemptAt: null, nextRetryAt: null, responseStatus: null, errorMessage: null, ...v }); },
    }),
    update: (table: any) => ({
      set: (vals: Record<string, unknown>) => ({
        where: async (..._a: any[]) => {
          if (table?._name === "webhooks") {
            state.webhookUpdates.push(vals);
            Object.assign(state.webhooks[0] ?? {}, vals);
          } else {
            // delivery update: apply to the first delivery (tests use one)
            Object.assign(state.deliveries[0] ?? {}, vals);
          }
        },
      }),
    }),
    execute: async (query: any) => {
      // durationMs raw SQL — record on the fake row
      const text = String(query?.sql ?? query?.queryChunks?.map((c: any) => String(c?.value ?? "")).join("") ?? "");
      const m = text.match(/durationMs/);
      if (m && state.deliveries[0]) state.deliveries[0].durationMs = 1;
      return { rows: [] };
    },
  };
}

vi.mock("../db", () => ({
  getDb: async () => fakeDb(),
}));

import { computeNextRetryAt, dispatchWebhooksForEvent, attemptDelivery, WEBHOOK_RETRY_SCHEDULE_MS } from "../webhook-dispatcher";

// drizzle table objects expose their name differently across versions; the
// fake above keys off _name, so tag the imported tables.
import { webhooks as webhooksTable, webhookDeliveries as deliveriesTable } from "../../drizzle/schema";
(webhooksTable as any)._name = "webhooks";
(deliveriesTable as any)._name = "webhook_deliveries";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function seedWebhook(failureCount = 0) {
  state.webhooks = [{ id: "wh-1", url: "https://receiver.example.com/hook", secret: "s3cret", events: JSON.stringify(["*"]), status: "active", failureCount }];
}

beforeEach(() => {
  state.webhooks = [];
  state.deliveries = [];
  state.webhookUpdates = [];
  fetchMock.mockReset();
  vi.setSystemTime(new Date("2026-09-05T00:00:00Z"));
});

describe("computeNextRetryAt schedule (0/1m/5m/15m/1h)", () => {
  it("follows the documented schedule then terminates", () => {
    const t0 = new Date("2026-09-05T00:00:00Z");
    expect(WEBHOOK_RETRY_SCHEDULE_MS).toEqual([0, 60_000, 300_000, 900_000, 3_600_000]);
    expect(computeNextRetryAt(1, t0)?.getTime()).toBe(t0.getTime() + 60_000);
    expect(computeNextRetryAt(2, t0)?.getTime()).toBe(t0.getTime() + 300_000);
    expect(computeNextRetryAt(3, t0)?.getTime()).toBe(t0.getTime() + 900_000);
    expect(computeNextRetryAt(4, t0)?.getTime()).toBe(t0.getTime() + 3_600_000);
    expect(computeNextRetryAt(5, t0)).toBeNull();
  });
});

describe("dispatch + attempt recording", () => {
  it("persists a delivery row before attempting and records success", async () => {
    seedWebhook();
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await dispatchWebhooksForEvent("dispute.advanced", "disp-1", { to: "step_2" });
    expect(state.deliveries).toHaveLength(1);
    const d = state.deliveries[0];
    expect(d.status).toBe("delivered");
    expect(d.attempts).toBe(1);
    expect(d.responseStatus).toBe(200);
    expect(d.durationMs).toBeDefined();
    // webhook failure counter reset
    expect(state.webhookUpdates[0]).toMatchObject({ failureCount: 0 });
  });

  it("sends the event TYPE only in X-HealthPoint-Event", async () => {
    seedWebhook();
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await dispatchWebhooksForEvent("dispute.advanced", "disp-1", { secretData: "must-not-leak" });
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers["X-HealthPoint-Event"]).toBe("dispute.advanced");
    expect(JSON.stringify(headers)).not.toContain("must-not-leak");
  });

  it("schedules a retry on failure and records the HTTP status", async () => {
    seedWebhook();
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await dispatchWebhooksForEvent("dispute.advanced", "disp-1", {});
    const d = state.deliveries[0];
    expect(d.status).toBe("pending");
    expect(d.attempts).toBe(1);
    expect(d.responseStatus).toBe(500);
    expect(d.nextRetryAt?.getTime()).toBe(new Date("2026-09-05T00:00:00Z").getTime() + 60_000);
  });

  it("auto-disable writes status='failed' (never an `active` column)", async () => {
    seedWebhook(9); // one more failure hits the threshold of 10
    fetchMock.mockRejectedValue(new Error("connection refused"));
    state.deliveries = [{
      id: "del-1", webhookId: "wh-1", eventType: "dispute.advanced", payload: "{}",
      status: "pending", attempts: 4, lastAttemptAt: null, nextRetryAt: new Date(), responseStatus: null, errorMessage: null,
    }];
    await attemptDelivery("del-1");
    const disableUpdate = state.webhookUpdates.find(u => "status" in u);
    expect(disableUpdate).toMatchObject({ status: "failed", failureCount: 10 });
    expect(disableUpdate).not.toHaveProperty("active");
  });

  it("marks the delivery terminally failed after the schedule is exhausted", async () => {
    seedWebhook();
    fetchMock.mockRejectedValue(new Error("down"));
    state.deliveries = [{
      id: "del-1", webhookId: "wh-1", eventType: "x", payload: "{}",
      status: "pending", attempts: 5, lastAttemptAt: null, nextRetryAt: new Date(), responseStatus: null, errorMessage: null,
    }];
    await attemptDelivery("del-1");
    expect(state.deliveries[0].status).toBe("failed");
    expect(state.deliveries[0].nextRetryAt).toBeNull();
  });

  it("replay reuses the same delivery row (no duplicate ids)", async () => {
    seedWebhook();
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    state.deliveries = [{
      id: "del-replay", webhookId: "wh-1", eventType: "x", payload: "{}",
      status: "pending", attempts: 0, lastAttemptAt: null, nextRetryAt: new Date(), responseStatus: null, errorMessage: null,
    }];
    await attemptDelivery("del-replay");
    expect(state.deliveries).toHaveLength(1);
    expect(state.deliveries[0].id).toBe("del-replay");
    expect(state.deliveries[0].status).toBe("delivered");
  });
});
