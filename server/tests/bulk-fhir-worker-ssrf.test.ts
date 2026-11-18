/**
 * server/tests/bulk-fhir-worker-ssrf.test.ts
 *
 * Phase 24 (F1): the bulk FHIR worker fetches URLs that originate from the
 * EMR ($export Content-Location → statusUrl; manifest → file.url) and from
 * the stored connection baseUrl — all now go through emrFetch
 * (server/emr-url-guard.ts). This file uses the REAL guard (unlike
 * bulk-fhir-worker.test.ts, which mocks the boundary to test the state
 * machine against a 127.0.0.1 fixture): private/loopback targets must fail
 * the job without any network fetch happening.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeJob {
  id: string; emrConnectionId: string; exportType: string; statusUrl: string | null;
  status: string; errorMessage: string | null; [k: string]: unknown;
}

const state = {
  jobs: [] as FakeJob[],
  // baseUrl the fake emr_connections row returns
  baseUrl: "https://emr.example.com/fhir",
};
const fetchSpy = vi.fn();
vi.stubGlobal("fetch", fetchSpy);

vi.mock("../db", () => ({
  getDb: async () => ({
    select: () => ({
      from: (table: any) => ({
        where: () => ({
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
        where: async () => {
          const target = state.jobs[0];
          if (target) Object.assign(target, vals);
        },
      }),
    }),
  }),
}));

vi.mock("../storage", () => ({
  storagePut: async () => ({ url: "storage://x" }),
}));

import { processBulkFhirJobs } from "../scheduled/bulkFhirWorker";

function job(partial: Partial<FakeJob> & { id: string }): FakeJob {
  return {
    emrConnectionId: "conn-1", exportType: "Patient", statusUrl: null,
    status: "pending", errorMessage: null, progress: 0, ...partial,
  };
}

beforeEach(() => {
  state.jobs = [];
  state.baseUrl = "https://emr.example.com/fhir";
  fetchSpy.mockReset();
});

describe("bulk FHIR worker SSRF guard (F1, real guard)", () => {
  it("fails a job whose $export statusUrl is the cloud metadata endpoint", async () => {
    state.jobs = [job({ id: "j1", status: "in_progress", statusUrl: "https://169.254.169.254/latest/meta-data" })];
    await processBulkFhirJobs();
    expect(state.jobs[0].status).toBe("failed");
    expect(state.jobs[0].errorMessage).toMatch(/internal, private, or restricted/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails a job whose statusUrl is loopback", async () => {
    state.jobs = [job({ id: "j2", status: "in_progress", statusUrl: "http://127.0.0.1:8080/status" })];
    await processBulkFhirJobs();
    expect(state.jobs[0].status).toBe("failed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails the kick when the stored EMR baseUrl is RFC1918", async () => {
    state.baseUrl = "https://10.0.0.4/fhir";
    state.jobs = [job({ id: "j3", status: "pending" })];
    await processBulkFhirJobs();
    expect(state.jobs[0].status).toBe("failed");
    expect(state.jobs[0].errorMessage).toMatch(/internal, private, or restricted/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
