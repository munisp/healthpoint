/**
 * email.ts — Resend integration for transactional emails
 *
 * Used for:
 *  - New lead notification: alerts the HealthPoint team when a prospect
 *    submits the landing page lead-capture form
 *
 * Configuration (via environment variables):
 *  RESEND_API_KEY          — Resend API key (get one free at https://resend.com)
 *  LEAD_NOTIFICATION_EMAIL — Recipient for new-lead alerts (defaults to a
 *                            placeholder; set to your team inbox)
 *  LEAD_FROM_EMAIL         — Sender address (must be a verified Resend domain;
 *                            defaults to onboarding@resend.dev for testing)
 */

import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const NOTIFICATION_TO =
  process.env.LEAD_NOTIFICATION_EMAIL ?? "team@healthpoint.io";

const FROM_EMAIL =
  process.env.LEAD_FROM_EMAIL ?? "HealthPoint <onboarding@resend.dev>";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NewLeadEmailPayload {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  orgName?: string | null;
  orgType?: string | null;
  stakeholderRole?: string | null;
  phone?: string | null;
  message?: string | null;
  source?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function roleLabel(role?: string | null): string {
  const map: Record<string, string> = {
    provider: "Provider (Physician / Group Practice)",
    facility: "Facility (Hospital / ASC)",
    payer: "Payer (Insurer / TPA)",
    idr_entity: "IDR Entity (Certified Arbitrator)",
    other: "Other",
  };
  return role ? (map[role] ?? role) : "Not specified";
}

function htmlEscape(str?: string | null): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Email templates ──────────────────────────────────────────────────────────

function buildNewLeadHtml(lead: NewLeadEmailPayload): string {
  const name = `${htmlEscape(lead.firstName)} ${htmlEscape(lead.lastName)}`.trim();
  const utmInfo = [lead.utmSource, lead.utmMedium, lead.utmCampaign]
    .filter(Boolean)
    .join(" / ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New HealthPoint Lead</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
          <!-- Header -->
          <tr>
            <td style="background:#0f172a;padding:28px 32px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="color:#38bdf8;font-size:22px;font-weight:700;letter-spacing:-.5px;">
                    HealthPoint
                  </td>
                  <td style="padding-left:12px;color:#64748b;font-size:13px;padding-top:4px;">
                    NSA / IDR Platform
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Alert badge -->
          <tr>
            <td style="padding:24px 32px 0;">
              <span style="display:inline-block;background:#dbeafe;color:#1d4ed8;font-size:12px;font-weight:600;padding:4px 12px;border-radius:999px;letter-spacing:.5px;">
                🎯 NEW LEAD
              </span>
            </td>
          </tr>
          <!-- Headline -->
          <tr>
            <td style="padding:12px 32px 4px;">
              <h1 style="margin:0;font-size:24px;font-weight:700;color:#0f172a;">
                ${htmlEscape(name) || "Anonymous"}
              </h1>
              <p style="margin:4px 0 0;font-size:15px;color:#475569;">
                ${htmlEscape(lead.email)}
              </p>
            </td>
          </tr>
          <!-- Details table -->
          <tr>
            <td style="padding:20px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
                ${[
                  ["Organization", lead.orgName],
                  ["Org Type", lead.orgType],
                  ["Stakeholder Role", roleLabel(lead.stakeholderRole)],
                  ["Phone", lead.phone],
                  ["Source", lead.source],
                  ["UTM", utmInfo || null],
                ]
                  .filter(([, v]) => v)
                  .map(([label, value], i) => `
                <tr style="background:${i % 2 === 0 ? "#f8fafc" : "#ffffff"};">
                  <td style="padding:10px 16px;font-size:13px;color:#64748b;font-weight:600;width:40%;border-bottom:1px solid #e2e8f0;">${label}</td>
                  <td style="padding:10px 16px;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0;">${htmlEscape(value as string)}</td>
                </tr>`).join("")}
              </table>
            </td>
          </tr>
          ${lead.message ? `
          <!-- Message -->
          <tr>
            <td style="padding:0 32px 20px;">
              <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.5px;">Message</p>
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;font-size:14px;color:#334155;line-height:1.6;">
                ${htmlEscape(lead.message)}
              </div>
            </td>
          </tr>` : ""}
          <!-- CTA -->
          <tr>
            <td style="padding:0 32px 32px;">
              <a href="${process.env.VITE_APP_URL ?? "https://healthpoint.manus.space"}/admin/leads"
                 style="display:inline-block;background:#0ea5e9;color:#ffffff;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;text-decoration:none;">
                View in Leads CRM →
              </a>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;">
              Lead ID: ${htmlEscape(lead.id)} · Sent by HealthPoint automated notifications
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildNewLeadText(lead: NewLeadEmailPayload): string {
  const name = `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim();
  return [
    "NEW HEALTHPOINT LEAD",
    "====================",
    `Name:  ${name || "Anonymous"}`,
    `Email: ${lead.email}`,
    lead.orgName ? `Org:   ${lead.orgName}` : null,
    lead.orgType ? `Type:  ${lead.orgType}` : null,
    `Role:  ${roleLabel(lead.stakeholderRole)}`,
    lead.phone ? `Phone: ${lead.phone}` : null,
    lead.message ? `\nMessage:\n${lead.message}` : null,
    `\nLead ID: ${lead.id}`,
    `View: ${process.env.VITE_APP_URL ?? "https://healthpoint.manus.space"}/admin/leads`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send a new-lead notification email to the configured team inbox.
 * Silently skips if RESEND_API_KEY is not set (graceful degradation).
 */
export async function sendNewLeadNotification(
  lead: NewLeadEmailPayload
): Promise<void> {
  if (!resend) {
    console.info(
      "[email] RESEND_API_KEY not set — skipping lead notification email"
    );
    return;
  }

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [NOTIFICATION_TO],
      subject: `New HealthPoint Lead: ${lead.firstName ?? ""} ${lead.lastName ?? ""} (${roleLabel(lead.stakeholderRole)})`.trim(),
      html: buildNewLeadHtml(lead),
      text: buildNewLeadText(lead),
    });

    if (error) {
      console.error("[email] Resend error sending lead notification:", error);
    } else {
      console.info(
        `[email] Lead notification sent for ${lead.email} → ${NOTIFICATION_TO}`
      );
    }
  } catch (err) {
    // Non-fatal — log but don't throw so the lead is still saved
    console.error("[email] Failed to send lead notification:", err);
  }
}
