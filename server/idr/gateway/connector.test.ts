/**
 * Phase 20-B: CMS IDR Gateway connector tests — MOCK-VERIFIED.
 *
 * Every HTTP interaction runs through an injected fetchImpl; NO live CMS
 * endpoint exists or is contacted. Live transmission is UNVERIFIABLE
 * without CMS-issued credentials and a published Gateway API spec.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createGatewayConnector,
  getGatewayConnector,
  resolveGatewayConfig,
  GatewayUnavailableError,
  GatewayRejectedError,
} from "./connector";
import { portalFieldsToGatewayIntake } from "./mapping";

const ENV_OK = {
  CMS_GATEWAY_BASE_URL: "https://gateway.example.invalid",
  CMS_GATEWAY_CLIENT_ID: "client-abc",
  CMS_GATEWAY_CLIENT_SECRET: "super-secret-value",
  CMS_GATEWAY_ORG_REGISTRATION_ID: "ORG-REG-1",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mockFetch(handlers: Array<{ match: (url: string) => boolean; respond: () => Response | Promise<Response> }>) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    for (const h of handlers) if (h.match(url)) return h.respond();
    return jsonResponse(404, { message: "not found" });
  }) as unknown as typeof fetch;
}

describe("resolveGatewayConfig", () => {
  it("returns null and names missing vars when env absent (fail-closed)", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(resolveGatewayConfig({})).toBeNull();
    expect(resolveGatewayConfig({ CMS_GATEWAY_CLIENT_ID: "x" })).toBeNull();
    const out = spy.mock.calls.map(c => String(c[0])).join("\n");
    expect(out).toContain("DISABLED");
    expect(out).toContain("CMS_GATEWAY_BASE_URL");
    spy.mockRestore();
  });

  it("returns config when all env present; secret never logged", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const cfg = resolveGatewayConfig(ENV_OK);
    expect(cfg).not.toBeNull();
    expect(cfg!.baseUrl).toBe("https://gateway.example.invalid");
    expect(spy.mock.calls.flat().join(" ")).not.toContain(ENV_OK.CMS_GATEWAY_CLIENT_SECRET);
    spy.mockRestore();
  });
});

describe("getGatewayConnector disabled stub", () => {
  it("mode is disabled and every method throws GatewayUnavailableError", async () => {
    const c = getGatewayConnector({});
    expect(c.mode).toBe("disabled");
    await expect(c.submitInitiation({ disputeId: "d1", orgRegistrationId: "o", initiation: {}, supportingDocumentRefs: [] }))
      .rejects.toBeInstanceOf(GatewayUnavailableError);
    await expect(c.pollStatus("gs_1")).rejects.toBeInstanceOf(GatewayUnavailableError);
  });
});

describe("createGatewayConnector (mocked transport, MOCK-VERIFIED)", () => {
  const cfg = resolveGatewayConfig(ENV_OK)!;

  it("acquires token, submits initiation, returns gateway id", async () => {
    const f = mockFetch([
      { match: u => u.endsWith("/oauth/token"), respond: () => jsonResponse(200, { access_token: "tok-1", expires_in: 600 }) },
      { match: u => u.includes("/v1/idr/initiations"), respond: () => jsonResponse(200, { gatewaySubmissionId: "gs_123", status: "received" }) },
    ]);
    const c = createGatewayConnector(cfg, f);
    expect(c.mode).toBe("configured");
    const res = await c.submitInitiation({
      disputeId: "d1",
      orgRegistrationId: "ORG-REG-1",
      initiation: { claimNumber: "C-1" },
      supportingDocumentRefs: ["doc-1"],
    });
    expect(res.gatewaySubmissionId).toBe("gs_123");
    expect(res.status).toBe("received");
    const calls = (f as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const submitCall = calls.find(([u]) => String(u).includes("/v1/idr/initiations"))!;
    expect(String(submitCall[1].headers.authorization)).toBe("Bearer tok-1");
    // Secret never appears in any request except the token POST body.
    const leaked = calls.filter(([u, i]) => !String(u).includes("/oauth/token") && JSON.stringify(i ?? {}).includes(ENV_OK.CMS_GATEWAY_CLIENT_SECRET));
    expect(leaked).toHaveLength(0);
  });

  it("maps HTTP 422 to GatewayRejectedError", async () => {
    const f = mockFetch([
      { match: u => u.endsWith("/oauth/token"), respond: () => jsonResponse(200, { access_token: "t", expires_in: 600 }) },
      { match: u => u.includes("/v1/idr/initiations"), respond: () => jsonResponse(422, { detail: "claimNumber missing" }) },
    ]);
    const c = createGatewayConnector(cfg, f);
    await expect(c.submitInitiation({ disputeId: "d", orgRegistrationId: "o", initiation: {}, supportingDocumentRefs: [] }))
      .rejects.toBeInstanceOf(GatewayRejectedError);
  });

  it("maps transport/5xx failures to GatewayUnavailableError", async () => {
    const f = mockFetch([
      { match: u => u.endsWith("/oauth/token"), respond: () => { throw new Error("ECONNREFUSED"); } },
    ]);
    const c = createGatewayConnector(cfg, f);
    await expect(c.pollStatus("gs_1")).rejects.toBeInstanceOf(GatewayUnavailableError);
    const f2 = mockFetch([
      { match: u => u.endsWith("/oauth/token"), respond: () => jsonResponse(200, { access_token: "t", expires_in: 600 }) },
      { match: () => true, respond: () => jsonResponse(503, {}) },
    ]);
    const c2 = createGatewayConnector(cfg, f2);
    await expect(c2.pollStatus("gs_1")).rejects.toBeInstanceOf(GatewayUnavailableError);
  });

  it("never fabricates an id when response lacks gatewaySubmissionId", async () => {
    const f = mockFetch([
      { match: u => u.endsWith("/oauth/token"), respond: () => jsonResponse(200, { access_token: "t", expires_in: 600 }) },
      { match: () => true, respond: () => jsonResponse(200, { status: "received" }) },
    ]);
    const c = createGatewayConnector(cfg, f);
    await expect(c.submitInitiation({ disputeId: "d", orgRegistrationId: "o", initiation: {}, supportingDocumentRefs: [] }))
      .rejects.toBeInstanceOf(GatewayUnavailableError);
  });

  it("pollStatus maps unknown statuses to 'unknown'", async () => {
    const f = mockFetch([
      { match: u => u.endsWith("/oauth/token"), respond: () => jsonResponse(200, { access_token: "t", expires_in: 600 }) },
      { match: () => true, respond: () => jsonResponse(200, { status: "strange_new_state" }) },
    ]);
    const c = createGatewayConnector(cfg, f);
    const res = await c.pollStatus("gs_1");
    expect(res.status).toBe("unknown");
    expect(res.polledAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("portalFieldsToGatewayIntake", () => {
  it("carries statutory 45 CFR 149.510(b) fields 1:1 and drops empties", () => {
    const portalFields = {
      initiatingPartyName: "Lakeshore Emergency Physicians",
      claimNumber: "CLM-1001",
      serviceCode: "99285",
      dateOfService: "2026-08-10",
      billedCharge: "4200.00",
      qualifyingPaymentAmount: "900.00",
      initialPlanPayment: "300.00",
      openNegotiationInitiationDate: "2026-08-20",
      initiatingOffer: "1200.00",
      emptyField: "",
    };
    const intake = portalFieldsToGatewayIntake(portalFields);
    expect(intake.claimNumber).toBe("CLM-1001");
    expect(intake.initiatingOffer).toBe("1200.00");
    expect(intake).not.toHaveProperty("emptyField");
    expect(Object.keys(intake)).toHaveLength(9);
  });
});
