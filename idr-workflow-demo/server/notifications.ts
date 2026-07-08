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
    // No SMTP configured — log to console for development
    console.log(`[EMAIL] To: ${payload.to} | Subject: ${payload.subject}\n${payload.body}`);
    return { channel: "email", success: true, messageId: `dev-${Date.now()}` };
  }

  try {
    const info = await transport.sendMail({
      from: `"IDR Workflow Platform" <${fromAddress}>`,
      to: payload.to,
      subject: payload.subject ?? "IDR Workflow Notification",
      text: payload.body,
      html: payload.htmlBody ?? `<pre style="font-family:sans-serif">${payload.body}</pre>`,
    });
    return { channel: "email", success: true, messageId: info.messageId };
  } catch (err: any) {
    console.error("[EMAIL] Delivery failed:", err.message);
    return { channel: "email", success: false, error: err.message };
  }
}

// ─── SMS delivery (Twilio) ────────────────────────────────────────────────────

export async function sendSMS(payload: NotificationPayload): Promise<DeliveryResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    // No Twilio configured — log to console for development
    console.log(`[SMS] To: ${payload.to} | ${payload.body}`);
    return { channel: "sms", success: true, messageId: `dev-sms-${Date.now()}` };
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
    return { channel: "sms", success: true, messageId: data.sid };
  } catch (err: any) {
    console.error("[SMS] Delivery failed:", err.message);
    return { channel: "sms", success: false, error: err.message };
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
    const result = await sendEmail({
      to: opts.recipientEmail,
      subject: `[IDR] ${opts.title} — ${opts.disputeRef}`,
      body: `${opts.title}\n\n${opts.message}${opts.dueDate ? `\n\nDeadline: ${opts.dueDate.toLocaleDateString()}` : ""}`,
      htmlBody,
    });
    results.push(result);
  }

  if (opts.recipientPhone) {
    const result = await sendSMS({ to: opts.recipientPhone, body: smsBody });
    results.push(result);
  }

  return results;
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
