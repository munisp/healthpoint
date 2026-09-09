/**
 * server/tests/outbox-retry.test.ts
 *
 * Unit tests for the transactional-outbox dispatcher (server/outbox.ts):
 *   - exponential backoff schedule with a 1-hour cap (nextOutboxAttempt)
 *   - retry cap: at MAX_RETRIES (8) the event becomes terminal — status "failed",
 *     nextAttemptAt NULL (dead-letter state) — and is never re-claimed
 *   - stale "processing" leases are recovered and re-driven
 *   - successful delivery marks the event delivered exactly once
 *
 * `../db` and `../events/bus` are replaced with in-memory fakes at the module
 * boundary (vi.mock), matching how the rest of the suite isolates infrastructure.
 * The fake event_log applies the documented claim predicate (status pending/failed,
 * due nextAttemptAt, retryCount < MAX_RETRIES) so the dispatcher's state machine
 * is exercised end-to-end in memory.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const MAX_RETRIES = 8; // mirrors server/outbox.ts

interface FakeEventRow {
  id: string;
  topic: string;
  eventType: string;
  aggregateId: string;
  aggregateType: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
  idempotencyKey: string | null;
  status: string;
  publishedAt: Date | null;
  failureReason: string | null;
  retryCount: number;
  lastAttemptAt: Date | null;
  nextAttemptAt: Date | null;
  createdAt: Date;
}

const state = {
  rows: [] as FakeEventRow[],
  claimUpdates: 0,
};

function makeRow(partial: Partial<FakeEventRow> & { id: string }): FakeEventRow {
  return {
    topic: "idr.payments",
    eventType: "payment.recorded",
    aggregateId: "dispute-outbox-1",
    aggregateType: "dispute",
    payload: { type: "payment_evidence" },
    metadata: null,
    idempotencyKey: null,
    status: "pending",
    publishedAt: null,
    failureReason: null,
    retryCount: 0,
    lastAttemptAt: null,
    nextAttemptAt: null,
    createdAt: new Date(Date.now() - 60_000),
    ...partial,
  };
}

/** Emulates the event_log queries issued by dispatchOutboxBatch. */
function createOutboxDb() {
  function applySet(row: FakeEventRow, vals: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(vals)) {
      (row as Record<string, unknown>)[k] = v;
    }
  }

  function genericUpdate(vals: Record<string, unknown>, condId?: string): void {
    if (vals.status === "failed" && vals.failureReason === "outbox worker lease expired") {
      // Stale-lease recovery: claimed but never finished, retry budget remains.
      const staleBefore = Date.now() - 5 * 60 * 1000;
      for (const row of state.rows) {
        if (row.status === "processing" && row.retryCount < MAX_RETRIES
            && row.lastAttemptAt !== null && row.lastAttemptAt.getTime() <= staleBefore) {
          applySet(row, vals);
        }
      }
      return;
    }
    const row = state.rows.find(r => r.id === condId);
    if (row) applySet(row, vals);
  }

  function claim(vals: Record<string, unknown>, condId?: string): FakeEventRow[] {
    // WHERE id = ? AND status IN ('pending','failed') AND retryCount < MAX_RETRIES
    const row = state.rows.find(r => r.id === condId);
    state.claimUpdates++;
    if (!row) return [];
    if (row.status !== "pending" && row.status !== "failed") return [];
    if (row.retryCount >= MAX_RETRIES) return [];
    applySet(row, vals);
    return [row];
  }

  function extractId(cond: unknown): string | undefined {
    // eq(eventLog.id, <param>) is the first bound parameter of the claim/update predicates
    const seen: unknown[] = [];
    const walk = (n: unknown): void => {
      if (n === null || n === undefined || typeof n !== "object") return;
      const o = n as Record<string, unknown>;
      if (Array.isArray(o.queryChunks)) { for (const c of o.queryChunks) walk(c); return; }
      if ((n as object).constructor?.name === "Param") { seen.push(o.value); return; }
    };
    walk(cond);
    return seen[0] as string | undefined;
  }

  return {
    update() {
      return {
        set(vals: Record<string, unknown>) {
          return {
            where(cond: unknown) {
              const id = extractId(cond);
              const api: any = {
                returning: async () => claim(vals, id),
                then(onF: any, onR: any) {
                  return Promise.resolve().then(() => genericUpdate(vals, id)).then(onF, onR);
                },
              };
              return api;
            },
          };
        },
      };
    },
    select() {
      return {
        from() {
          return {
            where() {
              return {
                orderBy() {
                  return {
                    async limit(n: number) {
                      const now = Date.now();
                      return state.rows
                        .filter(r => (r.status === "pending" || r.status === "failed"))
                        .filter(r => r.nextAttemptAt === null || r.nextAttemptAt.getTime() <= now)
                        .filter(r => r.retryCount < MAX_RETRIES)
                        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
                        .slice(0, n);
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

// Delivery behavior is controlled per test through this mock.
const deliverMock = vi.fn<(event: { id: string }) => Promise<void>>();

vi.mock("../db", () => ({
  getDb: vi.fn(async () => createOutboxDb()),
}));

vi.mock("../events/bus", () => ({
  eventBus: {
    deliverOutboxEvent: (event: { id: string }) => deliverMock(event),
  },
}));

import { dispatchOutboxBatch, nextOutboxAttempt } from "../outbox";

beforeEach(() => {
  state.rows = [];
  state.claimUpdates = 0;
  deliverMock.mockReset();
  deliverMock.mockResolvedValue(undefined);
});

// ── Backoff schedule ─────────────────────────────────────────────────────────

describe("nextOutboxAttempt backoff schedule", () => {
  const now = new Date("2026-09-05T00:00:00.000Z");

  it("doubles the delay per retry: 1m, 2m, 4m, 8m…", () => {
    expect(nextOutboxAttempt(0, now).getTime() - now.getTime()).toBe(60_000);
    expect(nextOutboxAttempt(1, now).getTime() - now.getTime()).toBe(120_000);
    expect(nextOutboxAttempt(2, now).getTime() - now.getTime()).toBe(240_000);
    expect(nextOutboxAttempt(3, now).getTime() - now.getTime()).toBe(480_000);
  });

  it("caps the delay at one hour and never exceeds it", () => {
    expect(nextOutboxAttempt(8, now).getTime() - now.getTime()).toBe(3_600_000);
    expect(nextOutboxAttempt(20, now).getTime() - now.getTime()).toBe(3_600_000);
  });
});

// ── Dispatch state machine ───────────────────────────────────────────────────

describe("dispatchOutboxBatch", () => {
  it("marks a successfully delivered event as delivered exactly once", async () => {
    state.rows = [makeRow({ id: "e-ok" })];
    const result = await dispatchOutboxBatch(25);
    expect(result).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    const row = state.rows[0];
    expect(row.status).toBe("delivered");
    expect(row.publishedAt).toBeInstanceOf(Date);
    expect(row.failureReason).toBeNull();
    expect(deliverMock).toHaveBeenCalledTimes(1);
  });

  it("re-schedules a failed delivery with backoff while retries remain", async () => {
    deliverMock.mockRejectedValue(new Error("kafka broker unavailable"));
    state.rows = [makeRow({ id: "e-retry", retryCount: 2 })];
    const before = Date.now();
    const result = await dispatchOutboxBatch(25);
    expect(result).toEqual({ claimed: 1, delivered: 0, failed: 1 });
    const row = state.rows[0];
    expect(row.status).toBe("failed");
    expect(row.retryCount).toBe(3);
    expect(row.failureReason).toBe("kafka broker unavailable");
    // retryCount 3 → 2^3 minutes = 8 minutes of backoff
    expect(row.nextAttemptAt).not.toBeNull();
    const delay = row.nextAttemptAt!.getTime() - before;
    expect(delay).toBeGreaterThanOrEqual(480_000);
    expect(delay).toBeLessThan(480_000 + 30_000);
  });

  it("dead-letters an event at the retry cap: terminal failure with nextAttemptAt NULL", async () => {
    deliverMock.mockRejectedValue(new Error("permanent downstream outage"));
    state.rows = [makeRow({ id: "e-dlq", retryCount: MAX_RETRIES - 1 })];
    const result = await dispatchOutboxBatch(25);
    expect(result).toEqual({ claimed: 1, delivered: 0, failed: 1 });
    const row = state.rows[0];
    expect(row.status).toBe("failed");
    expect(row.retryCount).toBe(MAX_RETRIES);
    expect(row.nextAttemptAt).toBeNull(); // terminal — never eligible again
    expect(row.failureReason).toBe("permanent downstream outage");
  });

  it("never re-claims an exhausted (dead-lettered) event on later batches", async () => {
    deliverMock.mockRejectedValue(new Error("still down"));
    state.rows = [
      makeRow({ id: "e-terminal", retryCount: MAX_RETRIES, status: "failed", nextAttemptAt: null }),
    ];
    const result = await dispatchOutboxBatch(25);
    expect(result).toEqual({ claimed: 0, delivered: 0, failed: 0 });
    expect(deliverMock).not.toHaveBeenCalled();
    expect(state.rows[0].retryCount).toBe(MAX_RETRIES);
  });

  it("does not claim events whose backoff has not elapsed", async () => {
    state.rows = [
      makeRow({ id: "e-future", status: "failed", retryCount: 1, nextAttemptAt: new Date(Date.now() + 10 * 60_000) }),
    ];
    const result = await dispatchOutboxBatch(25);
    expect(result).toEqual({ claimed: 0, delivered: 0, failed: 0 });
    expect(deliverMock).not.toHaveBeenCalled();
  });

  it("recovers a stale processing lease and re-drives it in the same batch", async () => {
    state.rows = [
      makeRow({
        id: "e-stale",
        status: "processing",
        retryCount: 1,
        lastAttemptAt: new Date(Date.now() - 10 * 60_000),
      }),
    ];
    const result = await dispatchOutboxBatch(25);
    expect(result).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    expect(state.rows[0].status).toBe("delivered");
  });

  it("does not resurrect a stale lease whose retry budget is already exhausted", async () => {
    state.rows = [
      makeRow({
        id: "e-stale-terminal",
        status: "processing",
        retryCount: MAX_RETRIES,
        lastAttemptAt: new Date(Date.now() - 60 * 60_000),
      }),
    ];
    const result = await dispatchOutboxBatch(25);
    expect(result).toEqual({ claimed: 0, delivered: 0, failed: 0 });
    // Untouched: the lease-expired recovery deliberately skips exhausted events.
    expect(state.rows[0].status).toBe("processing");
    expect(deliverMock).not.toHaveBeenCalled();
  });

  it("claims in FIFO order up to the batch limit", async () => {
    state.rows = [
      makeRow({ id: "e-3", createdAt: new Date(Date.now() - 3_000) }),
      makeRow({ id: "e-1", createdAt: new Date(Date.now() - 5_000) }),
      makeRow({ id: "e-2", createdAt: new Date(Date.now() - 4_000) }),
    ];
    const result = await dispatchOutboxBatch(2);
    expect(result.claimed).toBe(2);
    const deliveredIds = deliverMock.mock.calls.map(call => call[0].id);
    expect(deliveredIds).toEqual(["e-1", "e-2"]);
    expect(state.rows.find(r => r.id === "e-3")!.status).toBe("pending");
  });
});
