/**
 * Notification Delivery Service
 * Handles email (SMTP/SendGrid) and SMS (Twilio) delivery for IDR workflow events.
 * Falls back gracefully when credentials are not configured.
 */

import nodemailer from "nodemailer";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NotificationPayload {
  to: string;           // Email address or phone number
  subject?: string;     // Email subject (ignored for SMS)
  body: string;         // Plain text body
  htmlBody?: string;    // HTML body for email (optional)
}

export interface DeliveryResult {
  channel: "email" | "sms";
  success: boolean;
  /** Honest delivery state: 'unconfigured' when no provider credentials exist
   *  (previously reported as success:true, silently losing statutory alerts). */
  deliveryStatus?: "delivered" | "unconfigured" | "failed" | "queued";
  messageId?: string;
  error?: string;
}

// ─── Email delivery (SMTP / SendGrid) ─────────────────────────────────────────

function getEmailTransport() {
  const sendgridKey = process.env.SENDGRID_API_KEY;
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpPort = parseInt(process.env.SMTP_PORT ?? "587", 10);

  if (sendgridKey) {
    // SendGrid via SMTP relay
    return nodemailer.createTransport({
      host: "smtp.sendgrid.net",
      port: 587,
      secure: false,
      auth: { user: "apikey", pass: sendgridKey },
    });
  }

  if (smtpHost && smtpUser && smtpPass) {
    return nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });
  }

  // Development: log to console (ethereal-style)
  return null;
}

export async function sendEmail(payload: NotificationPayload): Promise<DeliveryResult> {
  const fromAddress = process.env.NOTIFICATION_FROM_EMAIL ?? "noreply@idr-platform.example.com";
  const transport = getEmailTransport();

  if (!transport) {
    // No SMTP configured — report honestly instead of pretending success.
    console.warn(`[EMAIL] UNCONFIGURED (no SMTP/SendGrid credentials) — not delivered. To: ${payload.to} | Subject: ${payload.subject}`);
    return { channel: "email", success: false, deliveryStatus: "unconfigured", error: "SMTP/SendGrid not configured" };
  }

  try {
    const info = await transport.sendMail({
      from: `"IDR Workflow Platform" <${fromAddress}>`,
      to: payload.to,
      subject: payload.subject ?? "IDR Workflow Notification",
      text: payload.body,
      html: payload.htmlBody ?? `<pre style="font-family:sans-serif">${payload.body}</pre>`,
    });
    return { channel: "email", success: true, deliveryStatus: "delivered", messageId: info.messageId };
  } catch (err: any) {
    console.error("[EMAIL] Delivery failed:", err.message);
    return { channel: "email", success: false, deliveryStatus: "failed", error: err.message };
  }
}

// ─── SMS delivery (Twilio) ────────────────────────────────────────────────────

export async function sendSMS(payload: NotificationPayload): Promise<DeliveryResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    // No Twilio configured — report honestly instead of pretending success.
    console.warn(`[SMS] UNCONFIGURED (no Twilio credentials) — not delivered. To: ${payload.to}`);
    return { channel: "sms", success: false, deliveryStatus: "unconfigured", error: "Twilio not configured" };
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const body = new URLSearchParams({
      From: fromNumber,
      To: payload.to,
      Body: payload.body.slice(0, 1600), // Twilio max
    });

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Twilio API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as { sid: string };
    return { channel: "sms", success: true, deliveryStatus: "delivered", messageId: data.sid };
  } catch (err: any) {
    console.error("[SMS] Delivery failed:", err.message);
    return { channel: "sms", success: false, deliveryStatus: "failed", error: err.message };
  }
}

// ─── Unified notification dispatcher ─────────────────────────────────────────

export type NotificationType =
  | "deadline_warning"
  | "step_advanced"
  | "determination_issued"
  | "offer_received"
  | "document_uploaded"
  | "system_alert";

interface DispatchOptions {
  type: NotificationType;
  recipientEmail?: string;
  recipientPhone?: string;
  disputeRef: string;
  title: string;
  message: string;
  dueDate?: Date | null;
}

export async function dispatchNotification(opts: DispatchOptions): Promise<DeliveryResult[]> {
  const results: DeliveryResult[] = [];

  const htmlBody = buildEmailHtml({
    type: opts.type,
    title: opts.title,
    message: opts.message,
    disputeRef: opts.disputeRef,
    dueDate: opts.dueDate,
  });

  const smsBody = `[IDR Platform] ${opts.disputeRef}: ${opts.title}. ${opts.message}`.slice(0, 160);

  if (opts.recipientEmail) {
    const emailPayload = {
      to: opts.recipientEmail,
      subject: `[IDR] ${opts.title} — ${opts.disputeRef}`,
      body: `${opts.title}\n\n${opts.message}${opts.dueDate ? `\n\nDeadline: ${opts.dueDate.toLocaleDateString()}` : ""}`,
      htmlBody,
    };
    const result = await sendEmail(emailPayload);
    if (!result.success && result.deliveryStatus === "failed") {
      // Real provider failure — enqueue for retry so statutory deadline
      // alerts are not silently lost.
      const queued = await enqueueNotificationRetry("email", emailPayload, opts.type, opts.disputeRef, result.error);
      if (queued) result.deliveryStatus = "queued";
    }
    results.push(result);
  }

  if (opts.recipientPhone) {
    const smsPayload = { to: opts.recipientPhone, body: smsBody };
    const result = await sendSMS(smsPayload);
    if (!result.success && result.deliveryStatus === "failed") {
      const queued = await enqueueNotificationRetry("sms", smsPayload, opts.type, opts.disputeRef, result.error);
      if (queued) result.deliveryStatus = "queued";
    }
    results.push(result);
  }

  return results;
}

// ─── Notification retry outbox ────────────────────────────────────────────────
// Failed email/SMS deliveries are persisted to the notification_attempts table
// (migration 0039_wave_w3.sql — accessed via raw SQL because drizzle/schema.ts
// is owned by another wave) and drained by the scheduled worker in
// server/scheduled/notificationRetryWorker.ts. Backoff: 1m/5m/15m/1h/4h, then
// terminal 'failed'.

import crypto from "node:crypto";
import { getDb } from "./db";
import { sql } from "drizzle-orm";

export const NOTIFICATION_RETRY_SCHEDULE_MS = [60_000, 300_000, 900_000, 3_600_000, 14_400_000] as const;

export function computeNotificationNextRetryAt(attempts: number, now = new Date()): Date | null {
  const delay = NOTIFICATION_RETRY_SCHEDULE_MS[attempts - 1];
  if (delay === undefined) return null;
  return new Date(now.getTime() + delay);
}

async function enqueueNotificationRetry(
  channel: "email" | "sms",
  payload: NotificationPayload,
  type: NotificationType,
  disputeRef: string,
  error?: string,
): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;
    const id = crypto.randomUUID();
    const nextAttempt = computeNotificationNextRetryAt(1);
    await db.execute(sql`
      INSERT INTO notification_attempts
        (id, channel, recipient, subject, body, "htmlBody", "notificationType", "disputeRef",
         status, attempts, "nextAttemptAt", "errorMessage", "createdAt")
      VALUES
        (${id}, ${channel}, ${payload.to}, ${payload.subject ?? null}, ${payload.body}, ${payload.htmlBody ?? null},
         ${type}, ${disputeRef}, 'pending', 0, ${nextAttempt}, ${error ?? null}, NOW())
    `);
    console.warn(`[notifications] queued ${channel} retry ${id} for ${payload.to} (${type}/${disputeRef})`);
    return true;
  } catch (err) {
    console.error("[notifications] failed to enqueue notification retry:", err);
    return false;
  }
}

/** Drain due notification retries. Called by the scheduled worker. */
export async function processNotificationRetries(limit = 50): Promise<{ attempted: number }> {
  const db = await getDb();
  if (!db) return { attempted: 0 };

  const dueRaw = await db.execute(sql`
    SELECT id, channel, recipient, subject, body, "htmlBody", "notificationType", "disputeRef", attempts
    FROM notification_attempts
    WHERE status = 'pending' AND "nextAttemptAt" IS NOT NULL AND "nextAttemptAt" <= NOW()
    ORDER BY "nextAttemptAt" ASC
    LIMIT ${limit}
  `);
  const due: Array<Record<string, any>> = Array.isArray(dueRaw)
    ? (dueRaw as any)
    : (((dueRaw as any)?.rows ?? []) as Array<Record<string, any>>);

  let attempted = 0;
  for (const r of due) {
    attempted += 1;
    const attempts = Number(r.attempts ?? 0) + 1;
    const result = r.channel === "email"
      ? await sendEmail({ to: r.recipient, subject: r.subject ?? undefined, body: r.body, htmlBody: r.htmlBody ?? undefined })
      : await sendSMS({ to: r.recipient, body: r.body });

    if (result.success) {
      await db.execute(sql`
        UPDATE notification_attempts
        SET status = 'delivered', attempts = ${attempts}, "lastAttemptAt" = NOW(), "errorMessage" = NULL
        WHERE id = ${r.id}
      `);
      continue;
    }
    if (result.deliveryStatus === "unconfigured") {
      // Still nothing to send with — keep the row visible but stop burning retries.
      await db.execute(sql`
        UPDATE notification_attempts
        SET status = 'unconfigured', attempts = ${attempts}, "lastAttemptAt" = NOW(), "errorMessage" = ${result.error ?? null}
        WHERE id = ${r.id}
      `);
      continue;
    }
    const nextAttempt = computeNotificationNextRetryAt(attempts);
    await db.execute(sql`
      UPDATE notification_attempts
      SET status = ${nextAttempt ? "pending" : "failed"},
          attempts = ${attempts},
          "lastAttemptAt" = NOW(),
          "nextAttemptAt" = ${nextAttempt},
          "errorMessage" = ${result.error ?? null}
      WHERE id = ${r.id}
    `);
  }
  return { attempted };
}

// ─── HTML email template ──────────────────────────────────────────────────────

function buildEmailHtml(opts: {
  type: NotificationType;
  title: string;
  message: string;
  disputeRef: string;
  dueDate?: Date | null;
}): string {
  const typeColors: Record<NotificationType, string> = {
    deadline_warning: "#f59e0b",
    step_advanced: "#3b82f6",
    determination_issued: "#10b981",
    offer_received: "#8b5cf6",
    document_uploaded: "#6b7280",
    system_alert: "#ef4444",
  };
  const color = typeColors[opts.type] ?? "#3b82f6";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
    <div style="background:${color};padding:24px 32px">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700">IDR Workflow Platform</h1>
      <p style="margin:4px 0 0;color:rgba(255,255,255,.85);font-size:14px">No Surprises Act — Federal IDR Process</p>
    </div>
    <div style="padding:32px">
      <h2 style="margin:0 0 12px;color:#1e293b;font-size:18px">${opts.title}</h2>
      <p style="margin:0 0 16px;color:#475569;line-height:1.6">${opts.message}</p>
      <div style="background:#f1f5f9;border-radius:8px;padding:16px;margin-bottom:20px">
        <span style="color:#64748b;font-size:13px">Dispute Reference</span>
        <div style="color:#1e293b;font-weight:700;font-size:16px;margin-top:4px">${opts.disputeRef}</div>
        ${opts.dueDate ? `<div style="margin-top:8px;color:#ef4444;font-size:13px">⏰ Deadline: <strong>${opts.dueDate.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</strong></div>` : ""}
      </div>
      <p style="margin:0;color:#94a3b8;font-size:12px">
        This notification was generated by the IDR Workflow Platform. 
        For questions, contact your certified IDR entity or CMS at 
        <a href="https://www.cms.gov/nosurprises" style="color:#3b82f6">cms.gov/nosurprises</a>.
      </p>
    </div>
  </div>
</body>
</html>`;
}
