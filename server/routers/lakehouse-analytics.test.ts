/**
 * server/routers/lakehouse-analytics.test.ts
 *
 * Fallback-contract honesty verification:
 *  - queryLakehouse returns null when LAKEHOUSE_QUERY_URL is unset
 *    (→ postgres_fallback), when the endpoint errors/times out, and when the
 *    envelope is malformed (EXECUTED-VERIFIED with injected fetch stubs).
 *  - A well-formed endpoint response yields rows (lakehouse path contract).
 *  - The Postgres fallback aggregate runs against embedded PG when
 *    DATABASE_URL is set (EXECUTED-VERIFIED).
 */
import { describe, it, expect } from "vitest";
import postgres from "postgres";
import { queryLakehouse } from "./lakehouse-analytics";

describe("queryLakehouse fallback contract", () => {
  it("returns null when LAKEHOUSE_QUERY_URL is unset", async () => {
    const rows = await queryLakehouse({ query: "qpaTrends", params: {} }, { url: "" });
    expect(rows).toBeNull();
  });

  it("returns rows for a well-formed lakehouse response", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ rows: [{ payerName: "Aetna", disputeCount: 3 }] }), { status: 200 });
    const rows = await queryLakehouse(
      { query: "payerBehaviorSummary", params: { orgId: "o1" } },
      { url: "http://lakehouse.test/query", fetchImpl: fetchImpl as any },
    );
    expect(rows).toEqual([{ payerName: "Aetna", disputeCount: 3 }]);
  });

  it("returns null on non-2xx (never fakes lakehouse results)", async () => {
    const fetchImpl = async () => new Response("boom", { status: 500 });
    const rows = await queryLakehouse(
      { query: "claimVolumeStats", params: {} },
      { url: "http://lakehouse.test/query", fetchImpl: fetchImpl as any },
    );
    expect(rows).toBeNull();
  });

  it("returns null on malformed envelope", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ nope: true }), { status: 200 });
    const rows = await queryLakehouse(
      { query: "claimVolumeStats", params: {} },
      { url: "http://lakehouse.test/query", fetchImpl: fetchImpl as any },
    );
    expect(rows).toBeNull();
  });

  it("returns null on network failure/timeout", async () => {
    const fetchImpl = async () => { throw new Error("ECONNREFUSED"); };
    const rows = await queryLakehouse(
      { query: "claimVolumeStats", params: {} },
      { url: "http://lakehouse.test/query", fetchImpl: fetchImpl as any },
    );
    expect(rows).toBeNull();
  });
});

const DB_URL = process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

describeDb("postgres fallback aggregates (DB)", () => {
  const sql = postgres(DB_URL!, { max: 1 });
  const run = `lhana-${Date.now()}`;
  const orgId = `lh-org-${run}`;
  const userId = `lh-an-${run}`;

  it("claimVolumeStats fallback returns source=postgres_fallback with real rows", async () => {
    await sql`
      INSERT INTO users (id, email, name, role)
      VALUES (${userId}, ${userId + "@example.test"}, 'LH Analytics Test', 'user')
      ON CONFLICT (id) DO NOTHING
    `;
    await sql`
      INSERT INTO organizations (id, name, type, status) VALUES (${orgId}, 'LH Org', 'provider', 'active')
      ON CONFLICT (id) DO NOTHING
    `;
    await sql`
      INSERT INTO org_memberships (id, "orgId", "userId", role)
      VALUES (${"lh-m-" + run}, ${orgId}, ${userId}, 'owner')
      ON CONFLICT (id) DO NOTHING
    `;
    await sql`
      INSERT INTO disputes (
        id, "referenceNumber", "initiatingPartyId", "initiatingPartyType", "initiatingPartyName",
        "respondingPartyName", "serviceType", "serviceDate", "patientState", "facilityState",
        "cptCodes", "billedAmount", "qpaAmount", "paidAmount",
        "currentStep", "status", "createdAt", "updatedAt"
      ) VALUES (
        ${"lh-an-d-" + run}, ${"REF-AN-" + run}, ${userId}, 'provider', 'LH Provider',
        'LH Payer', 'radiology', now(), 'CA', 'CA',
        '["70450"]'::jsonb, 2000, 500, 400,
        'STEP_01_OPEN_NEGOTIATION_INITIATED', 'open_negotiation', now(), now()
      )
      ON CONFLICT (id) DO NOTHING
    `;

    // Exercise the router through its caller factory with a stub ctx.
    const { lakehouseAnalyticsRouter } = await import("./lakehouse-analytics");
    const caller = lakehouseAnalyticsRouter.createCaller({ user: { id: userId, role: "user" } } as any);

    delete process.env.LAKEHOUSE_QUERY_URL; // force the honest fallback
    const vol = await caller.claimVolumeStats({ orgId });
    expect(vol.source).toBe("postgres_fallback");
    const statuses = vol.rows.map((r: any) => r.status);
    expect(statuses).toContain("open_negotiation");

    const payer = await caller.payerBehaviorSummary({ orgId });
    expect(payer.source).toBe("postgres_fallback");
    const row = payer.rows.find((r: any) => r.payerName === "LH Payer");
    expect(row).toBeTruthy();
    expect(Number(row.totalUnderpayment)).toBeCloseTo(1600, 0);

    const qpa = await caller.qpaTrends({ orgId });
    expect(qpa.source).toBe("postgres_fallback");
    expect(qpa.rows.some((r: any) => r.code === "70450" && r.state === "CA")).toBe(true);

    const density = await caller.disputeDensityByState();
    expect(density.source).toBe("postgres_fallback");
    expect(density.rows.some((r: any) => r.stateCode === "CA")).toBe(true);
  });

  it("rejects non-members (FORBIDDEN)", async () => {
    const { lakehouseAnalyticsRouter } = await import("./lakehouse-analytics");
    const caller = lakehouseAnalyticsRouter.createCaller({ user: { id: `outsider-${run}`, role: "user" } } as any);
    await expect(caller.claimVolumeStats({ orgId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
