/**
 * server/tests/notification-retry.test.ts
 *
 * Wave-W3 notification remediation:
 *   - no SMTP/Twilio configured → honest 'unconfigured', never success:true
 *   - real provider failure → enqueued into notification_attempts for retry
 *   - retry backoff schedule 1m/5m/15m/1h/4h then terminal
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const executed: string[] = [];
vi.mock("../db", () => ({
  getDb: async () => ({
    execute: async (q: any) => {
      executed.push("execute");
      return { rows: [] };
    },
  }),
}));

import { sendEmail, sendSMS, dispatchNotification, computeNotificationNextRetryAt, NOTIFICATION_RETRY_SCHEDULE_MS } from "../notifications";

describe("unconfigured honesty", () => {
  beforeEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SENDGRID_API_KEY;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_NUMBER;
    executed.length = 0;
  });

  it("email without SMTP reports unconfigured, not success", async () => {
    const r = await sendEmail({ to: "ops@example.com", subject: "s", body: "b" });
    expect(r.success).toBe(false);
    expect(r.deliveryStatus).toBe("unconfigured");
  });

  it("sms without Twilio reports unconfigured, not success", async () => {
    const r = await sendSMS({ to: "+15551234567", body: "b" });
    expect(r.success).toBe(false);
    expect(r.deliveryStatus).toBe("unconfigured");
  });
});

describe("failure enqueue", () => {
  beforeEach(() => {
    executed.length = 0;
    // Configure SMTP so the transport exists, then force sendMail to fail.
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "u";
    process.env.SMTP_PASS = "p";
  });

  it("provider failure enqueues a retry row", async () => {
    const nodemailer = (await import("nodemailer")).default;
    vi.spyOn(nodemailer, "createTransport").mockReturnValue({
      sendMail: async () => { throw new Error("SMTP 451 temporary failure"); },
    } as any);

    const results = await dispatchNotification({
      type: "deadline_warning",
      recipientEmail: "provider@example.com",
      disputeRef: "IDR-2026-0001",
      title: "Deadline approaching",
      message: "Offer submission deadline in 2 business days",
    });
    expect(results[0].success).toBe(false);
    expect(results[0].deliveryStatus).toBe("queued");
    expect(executed.length).toBeGreaterThan(0); // INSERT INTO notification_attempts
    vi.restoreAllMocks();
  });
});

describe("retry schedule", () => {
  it("is 1m/5m/15m/1h/4h then terminal", () => {
    const t0 = new Date("2026-09-05T00:00:00Z");
    expect(NOTIFICATION_RETRY_SCHEDULE_MS).toEqual([60_000, 300_000, 900_000, 3_600_000, 14_400_000]);
    expect(computeNotificationNextRetryAt(1, t0)?.getTime()).toBe(t0.getTime() + 60_000);
    expect(computeNotificationNextRetryAt(5, t0)?.getTime()).toBe(t0.getTime() + 14_400_000);
    expect(computeNotificationNextRetryAt(6, t0)).toBeNull();
  });
});
