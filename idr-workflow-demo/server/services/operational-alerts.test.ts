import { describe, expect, it } from "vitest";
import {
  sanitizeAlertmanagerDelivery,
  verifyAlertmanagerBearer,
} from "./operational-alerts";

const validDelivery = {
  status: "firing",
  alerts: [
    {
      status: "firing",
      fingerprint: "fingerprint_abc-1",
      labels: {
        alertname: "HealthPointHighServerErrorRate",
        service: "healthpoint-api",
        severity: "critical",
      },
      annotations: {
        summary: "This must never be persisted",
        patient: "this must never be persisted",
      },
      startsAt: "2026-09-01T12:00:00.000Z",
    },
  ],
};

describe("Alertmanager operational receiver", () => {
  it("accepts only bounded allow-listed delivery fields", () => {
    const [alert] = sanitizeAlertmanagerDelivery(validDelivery);

    expect(alert).toEqual({
      fingerprint: "fingerprint_abc-1",
      alertName: "HealthPointHighServerErrorRate",
      service: "healthpoint-api",
      severity: "critical",
      status: "firing",
      startsAt: new Date("2026-09-01T12:00:00.000Z"),
      endsAt: null,
    });
    expect(JSON.stringify(alert)).not.toContain("patient");
    expect(JSON.stringify(alert)).not.toContain("summary");
  });

  it("rejects missing or unbounded labels", () => {
    expect(() => sanitizeAlertmanagerDelivery({ alerts: [] })).toThrow("at least one alert");
    expect(() =>
      sanitizeAlertmanagerDelivery({
        alerts: [{
          status: "firing",
          labels: { alertname: "Unsafe Alert", service: "healthpoint-api", severity: "critical" },
          startsAt: "2026-09-01T12:00:00.000Z",
        }],
      })
    ).toThrow("alertname");
  });

  it("requires a sufficiently strong bearer secret and exact token", () => {
    const token = "a".repeat(32);
    expect(verifyAlertmanagerBearer(`Bearer ${token}`, token)).toBe(true);
    expect(verifyAlertmanagerBearer(`Bearer ${"b".repeat(32)}`, token)).toBe(false);
    expect(verifyAlertmanagerBearer(undefined, token)).toBe(false);
    expect(verifyAlertmanagerBearer(`Bearer ${token}`, "short")).toBe(false);
  });
});
