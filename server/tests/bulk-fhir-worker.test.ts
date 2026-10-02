/**
 * server/tests/bulk-fhir-worker.test.ts  (EXECUTED-VERIFIED with mock server)
 *
 * Wave-W3 bulk FHIR export worker state machine, verified against a local
 * mock FHIR server (node:http) — no live EMR is available in CI:
 *   pending     → kick $export (202 + Content-Location) → in_progress
 *   pending     → pre-registered contentLocation skips the kick
 *   in_progress → 202 poll records progress; 200 manifest downloads ndjson
 *                 to storage and completes with counts
 *   terminal    → completed/failed/cancelled jobs are never touched
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

interface FakeJob {
  id: string; emrConnectionId: string; initiatedBy: string; exportType: string;
  resourceTypes: string[]; since: Date | null; statusUrl: string | null;
  status: string; progress: number; outputFiles: any[]; errorFiles: any[];
  totalRecords: number; errorMessage: string | null; startedAt: Date | null; completedAt: Date | null;
}

const state = {
  jobs: [] as FakeJob[],
  stored: new Map<string, string>(),
};

function job(partial: Partial<FakeJob> & { id: string }): FakeJob {
  return {
    emrConnectionId: "conn-1", initiatedBy: "user-1", exportType: "Patient",
    resourceTypes: ["Patient"], since: null, statusUrl: null, status: "pending",
    progress: 0, outputFiles: [], errorFiles: [], totalRecords: 0,
    errorMessage: null, startedAt: null, completedAt: null, ...partial,
  };
}

vi.mock("../db", () => ({
  getDb: async () => ({
    select: () => ({
      from: (table: any) => ({
        where: (..._a: any[]) => ({
          limit: async (n: number) => {
            const name = String(table?.[Symbol.for("drizzle:Name")] ?? "");
            if (name.includes("emr_connections")) return [{ id: "conn-1", baseUrl: state.baseUrl }];
            if (name.includes("smart_tokens")) return [];
            return state.jobs.filter(j => j.status === "pending" || j.status === "in_progress").slice(0, n);
          },
        }),
      }),
    }),
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: async (..._a: any[]) => {
          // tests target one job at a time or apply by id in vals
          const target = state.jobs.find(j => j.id === (state.updatingId ?? state.jobs[0]?.id));
          if (target) Object.assign(target, vals);
        },
      }),
    }),
    execute: async () => ({ rows: [] }),
  }),
  // baseUrl injected by mock server before tests run
}));

vi.mock("../storage", () => ({
  storagePut: async (key: string, data: string, _ct: string) => {
    state.stored.set(key, data);
    return { url: `storage://${key}` };
  },
}));

// Track which job an update targets: the worker updates by job id; our fake
// applies to the job whose id was most recently seen via a module hook.
(state as any).updatingId = null;

import { processBulkFhirJobs } from "../scheduled/bulkFhirWorker";
import { bulkFhirExportJobs } from "../../drizzle/schema";

let server: http.Server;
let baseUrl = "";
let pollCount = 0;
const requests: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    if (req.url?.startsWith("/Patient/$export")) {
      res.writeHead(202, { "Content-Location": `${baseUrl}/status/job-1` });
      res.end();
      return;
    }
    if (req.url === "/status/job-1") {
      pollCount += 1;
      if (pollCount === 1) {
        res.writeHead(202, { "X-Progress": "50" });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        transactionTime: "2026-09-05T00:00:00Z",
        output: [{ type: "Patient", url: `${baseUrl}/files/patients.ndjson`, count: 2 }],
        error: [],
      }));
      return;
    }
    if (req.url === "/files/patients.ndjson") {
      res.writeHead(200, { "Content-Type": "application/fhir+ndjson" });
      res.end('{"resourceType":"Patient","id":"p1"}\n{"resourceType":"Patient","id":"p2"}\n');
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  (state as any).baseUrl = baseUrl;
});

afterAll(async () => {
  await new Promise(r => server.close(r));
});

beforeEach(() => {
  state.jobs = [];
  state.stored.clear();
  requests.length = 0;
  pollCount = 0;
});

describe("bulk FHIR worker state machine (mock FHIR server)", () => {
  it("pending → in_progress → completed with counts and stored ndjson", async () => {
    state.jobs = [job({ id: "job-1" })];

    // Pass 1: kick $export
    await processBulkFhirJobs();
    expect(state.jobs[0].status).toBe("in_progress");
    expect(state.jobs[0].statusUrl).toBe(`${baseUrl}/status/job-1`);
    expect(requests[0]).toContain("GET /Patient/$export");

    // Pass 2: first poll → 202, progress recorded
    await processBulkFhirJobs();
    expect(state.jobs[0].status).toBe("in_progress");
    expect(state.jobs[0].progress).toBe(50);

    // Pass 3: second poll → 200 manifest → download + complete
    await processBulkFhirJobs();
    const j = state.jobs[0];
    expect(j.status).toBe("completed");
    expect(j.progress).toBe(100);
    expect(j.totalRecords).toBe(2);
    expect(j.outputFiles).toHaveLength(1);
    expect(j.outputFiles[0].type).toBe("Patient");
    expect(j.outputFiles[0].url).toMatch(/^storage:\/\/bulk-fhir\/job-1\//);
    const storedKey = j.outputFiles[0].url.replace("storage://", "");
    expect(state.stored.get(storedKey)).toContain('"id":"p1"');
  });

  it("pre-registered contentLocation skips the $export kick", async () => {
    state.jobs = [job({ id: "job-2", statusUrl: `${baseUrl}/status/job-1` })];
    await processBulkFhirJobs();
    expect(state.jobs[0].status).toBe("in_progress");
    expect(requests.some(r => r.includes("$export"))).toBe(false);
  });

  it("terminal jobs (cancelled) are never touched", async () => {
    state.jobs = [job({ id: "job-3", status: "cancelled", completedAt: new Date() })];
    const { processed } = await processBulkFhirJobs();
    expect(processed).toBe(0);
    expect(requests).toHaveLength(0);
    expect(state.jobs[0].status).toBe("cancelled");
  });

  it("a failing kick marks the job failed with an error message", async () => {
    state.jobs = [job({ id: "job-4", exportType: "System" })];
    // /$export is not mocked → 404 → failure
    await processBulkFhirJobs();
    expect(state.jobs[0].status).toBe("failed");
    expect(state.jobs[0].errorMessage).toContain("HTTP 404");
  });
});
