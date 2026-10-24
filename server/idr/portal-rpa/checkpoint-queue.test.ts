import { describe, it, expect } from "vitest";
import { InMemoryCheckpointQueue, type CheckpointEventType } from "./checkpoint-queue";
import type { RunResult } from "./driver";

function parkedRun(kind: "MFA" | "CAPTCHA" | "SELECTOR_MISSING" = "MFA"): RunResult {
  return {
    runId: "run-1",
    submissionId: "sub-1",
    mode: "DRY_RUN",
    status: "CHECKPOINT_REQUIRED",
    checkpoint: { kind, reason: "test", stepId: "LOGIN" },
    resumeToken: "tok-1",
    evidence: [],
    filledFields: [],
    timeline: [],
    startedAt: new Date().toISOString(),
  };
}

describe("portal-rpa checkpoint-queue", () => {
  it("enqueues only CHECKPOINT_REQUIRED runs with a resume token", async () => {
    const q = new InMemoryCheckpointQueue();
    await expect(q.enqueue({ ...parkedRun(), status: "COMPLETED" })).rejects.toThrow();
    const e = await q.enqueue(parkedRun());
    expect(e.resumeToken).toBe("tok-1");
  });

  it("lists, claims, and resolves an MFA checkpoint without storing the code", async () => {
    const events: CheckpointEventType[] = [];
    const q = new InMemoryCheckpointQueue({ emit: (t) => events.push(t) });
    const e = await q.enqueue(parkedRun());
    expect((await q.list()).length).toBe(1);
    await q.claim(e.checkpointId, "op-1");
    await expect(q.claim(e.checkpointId, "op-2")).rejects.toThrow(/claimed/);
    await expect(q.resolve(e.checkpointId, {})).rejects.toThrow(/mfaCode/);
    const r = await q.resolve(e.checkpointId, { mfaCode: "123456" });
    expect(r.resolution?.mfaCodeProvided).toBe(true);
    expect(JSON.stringify(r)).not.toContain("123456");
    expect(events).toEqual(["rpa.checkpoint.enqueued", "rpa.checkpoint.claimed", "rpa.checkpoint.resolved"]);
  });

  it("expires entries after the TTL (default 30 min semantics via injected clock)", async () => {
    let now = 1_000_000;
    const q = new InMemoryCheckpointQueue({ now: () => now, ttlMs: 30 * 60 * 1000 });
    await q.enqueue(parkedRun());
    now += 31 * 60 * 1000;
    expect((await q.list()).length).toBe(0);
    expect((await q.list({ includeExpired: true })).length).toBe(1);
    expect(await q.sweepExpired()).toBe(1);
    const e = (await q.list({ includeExpired: true, includeResolved: true }))[0];
    await expect(q.claim(e.checkpointId, "op")).rejects.toThrow(/expired|resolved/);
  });

  it("re-enqueue of the same run replaces the live entry", async () => {
    const q = new InMemoryCheckpointQueue({ idGen: (() => { let n = 0; return () => `cp-${++n}`; })() });
    await q.enqueue(parkedRun());
    await q.enqueue({ ...parkedRun(), resumeToken: "tok-2" });
    const list = await q.list();
    expect(list.length).toBe(1);
    expect(list[0].resumeToken).toBe("tok-2");
  });

  it("emitter failure never mutates queue state", async () => {
    const q = new InMemoryCheckpointQueue({ emit: () => { throw new Error("boom"); } });
    const e = await q.enqueue(parkedRun());
    expect(e.checkpointId).toBeTruthy();
    expect((await q.list()).length).toBe(1);
  });
});
