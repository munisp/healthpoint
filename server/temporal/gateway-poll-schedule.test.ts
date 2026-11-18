/**
 * Phase 20-B: gateway status poller gate tests — mirror lakehouse-schedule
 * gate semantics. EXECUTED-VERIFIED for gates/interval math; live polling is
 * UNVERIFIABLE without CMS credentials (connector transport is ASSUMPTION-based).
 */
import { describe, expect, it, vi } from "vitest";
import {
  gatewayStatusPollEnabled,
  registerGatewayStatusPollSchedule,
} from "./gateway-poll-schedule";

const FULL_ENV = {
  GATEWAY_STATUS_POLL_ENABLED: "true",
  GATEWAY_STATUS_POLL_CRON: "@hourly",
  CMS_GATEWAY_BASE_URL: "https://gateway.example.invalid",
  CMS_GATEWAY_CLIENT_ID: "id",
  CMS_GATEWAY_CLIENT_SECRET: "secret",
  CMS_GATEWAY_ORG_REGISTRATION_ID: "org-reg",
};

describe("gateway status poll gates", () => {
  it("disabled when GATEWAY_STATUS_POLL_ENABLED is not 'true'", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(gatewayStatusPollEnabled({})).toBe(false);
    const reg = await registerGatewayStatusPollSchedule({ env: {} });
    expect(reg.mode).toBe("disabled");
    spy.mockRestore();
  });

  it("disabled when poll enabled but CMS_GATEWAY_* env missing (fail-closed)", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const reg = await registerGatewayStatusPollSchedule({ env: { GATEWAY_STATUS_POLL_ENABLED: "true" } });
    expect(reg.mode).toBe("disabled");
    spy.mockRestore();
  });

  it("interval-fallback registers when enabled + configured + no Temporal", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reg = await registerGatewayStatusPollSchedule({ env: FULL_ENV });
    expect(reg.mode).toBe("interval-fallback");
    expect(reg.intervalMs).toBe(60 * 60 * 1000);
    expect(warnSpy.mock.calls.flat().join(" ")).toContain("NOT durable");
    reg.stop?.();
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("unsupported cron falls back to hourly with an honest warning", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reg = await registerGatewayStatusPollSchedule({ env: { ...FULL_ENV, GATEWAY_STATUS_POLL_CRON: "0 3 * * 1-5" } });
    expect(reg.mode).toBe("interval-fallback");
    expect(reg.intervalMs).toBe(60 * 60 * 1000);
    expect(warnSpy.mock.calls.flat().join(" ")).toContain("outside the cron-lite fallback subset");
    reg.stop?.();
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("*/N minute cron parses to N minutes", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reg = await registerGatewayStatusPollSchedule({ env: { ...FULL_ENV, GATEWAY_STATUS_POLL_CRON: "*/15 * * * *" } });
    expect(reg.intervalMs).toBe(15 * 60 * 1000);
    reg.stop?.();
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
