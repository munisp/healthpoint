/**
 * server/scheduled/emailDigest.ts
 *
 * Wave W5-3: per-user email digests that HONOR email_digest_preferences.
 *
 * - Users with digestFrequency 'daily' are mailed by the daily-digest
 *   scheduled job; 'weekly' by the weekly job (on their digestDayOfWeek);
 *   'never' is always skipped.
 * - The digest covers THEIR disputes: status summary + deadlines in the next
 *   7 days (respecting notifyOnDeadlineApproach / notifyOnStatusChange).
 * - Delivery goes through dispatchNotification → sendEmail, which enqueues
 *   real provider failures into notification_attempts (wave-W3 retry path).
 * - Idempotent per user+period: markers lastDailyDigestSentAt /
 *   lastWeeklyDigestSentAt (migration 0041_wave_w5.sql, raw SQL) are checked
 *   before sending and stamped after a successful/queued send. The marker
 *   columns and the per-user selection are injectable for tests.
 */
import { sql, eq } from "drizzle-orm";
import { getDb } from "../db";
import { users, disputes, emailDigestPreferences } from "../../drizzle/schema";
import { dispatchNotification } from "../notifications";

export type DigestFrequency = "daily" | "weekly";

export interface DigestResult {
  processed: boolean;
  frequency: DigestFrequency;
  eligibleUsers: number;
  sent: number;
  skippedNever: number;
  skippedDuplicate: number;
  failures: number;
}

/** Period key used for idempotency: UTC day, or ISO year-week. */
export function digestPeriodKey(frequency: DigestFrequency, now: Date): string {
  if (frequency === "daily") return now.toISOString().slice(0, 10);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // Thursday of this week
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function markerPeriodKey(marker: Date | null, frequency: DigestFrequency): string | null {
  if (!marker) return null;
  return digestPeriodKey(frequency, new Date(marker));
}

export function composeUserDigest(args: {
  userName: string | null;
  frequency: DigestFrequency;
  activeDisputes: { referenceNumber: string; status: string; nextDeadline: Date | null }[];
  notifyOnDeadlineApproach: boolean;
  notifyOnStatusChange: boolean;
}): { title: string; message: string } {
  const freqLabel = args.frequency === "daily" ? "Daily" : "Weekly";
  const lines: string[] = [`${freqLabel} IDR digest for ${args.userName ?? "you"}.`, ""];
  lines.push(`Active disputes: ${args.activeDisputes.length}`);
  if (args.notifyOnStatusChange && args.activeDisputes.length) {
    lines.push("", "Status overview:");
    for (const d of args.activeDisputes.slice(0, 20)) {
      lines.push(`  • ${d.referenceNumber} — ${d.status.replace(/_/g, " ")}`);
    }
  }
  if (args.notifyOnDeadlineApproach) {
    const withDeadlines = args.activeDisputes.filter(d => d.nextDeadline);
    if (withDeadlines.length) {
      lines.push("", "Upcoming deadlines (next 7 days):");
      for (const d of withDeadlines.slice(0, 20)) {
        lines.push(`  • ${d.referenceNumber} — due ${d.nextDeadline!.toISOString().slice(0, 10)}`);
      }
    }
  }
  lines.push("", "Manage your email preferences at /email-prefs.");
  return { title: `${freqLabel} IDR dispute digest`, message: lines.join("\n") };
}

type SendFn = (opts: {
  to: string;
  title: string;
  message: string;
}) => Promise<{ ok: boolean }>;

/** Default sender: the W3 retry-queued notification email path. */
const defaultSend: SendFn = async ({ to, title, message }) => {
  const results = await dispatchNotification({
    type: "system_alert",
    recipientEmail: to,
    disputeRef: "email-digest",
    title,
    message,
    dueDate: null,
  });
  const r = results[0];
  // success or queued-for-retry both count as accepted; 'unconfigured' (dev)
  // is reported honestly as not-ok so the marker is NOT stamped.
  return { ok: !!r && (r.success || r.deliveryStatus === "queued") };
};

export async function runEmailDigest(
  frequency: DigestFrequency,
  deps: { now?: Date; send?: SendFn } = {},
): Promise<DigestResult> {
  const now = deps.now ?? new Date();
  const send = deps.send ?? defaultSend;
  const result: DigestResult = {
    processed: true, frequency, eligibleUsers: 0, sent: 0, skippedNever: 0, skippedDuplicate: 0, failures: 0,
  };

  const db = await getDb();
  if (!db) { result.processed = false; return result; }

  const prefs = await db.select().from(emailDigestPreferences)
    .where(eq(emailDigestPreferences.digestFrequency, frequency));
  const neverCount = await db.select({ id: emailDigestPreferences.id }).from(emailDigestPreferences)
    .where(eq(emailDigestPreferences.digestFrequency, "never"));
  result.skippedNever = neverCount.length;

  const periodKey = digestPeriodKey(frequency, now);
  const markerCol = frequency === "daily" ? "lastDailyDigestSentAt" : "lastWeeklyDigestSentAt";

  // Idempotency markers live outside drizzle/schema.ts (wave-owned columns,
  // migration 0041) so they must be read via raw SQL.
  const markerRows = await db.execute(sql`
    SELECT id, "lastDailyDigestSentAt", "lastWeeklyDigestSentAt" FROM email_digest_preferences
  `);
  const markers = new Map(
    (((markerRows as any).rows ?? markerRows) as any[]).map(r => [r.id, r]),
  );

  for (const pref of prefs) {
    // Weekly: honor the user's chosen digest day of week.
    if (frequency === "weekly" && pref.digestDayOfWeek !== now.getUTCDay()) continue;

    const markerRow = markers.get(pref.id);
    const marker = frequency === "daily" ? markerRow?.lastDailyDigestSentAt : markerRow?.lastWeeklyDigestSentAt;
    if (markerPeriodKey(marker ?? null, frequency) === periodKey) {
      result.skippedDuplicate++;
      continue;
    }

    const [user] = await db.select({ id: users.id, name: users.name, email: users.email })
      .from(users).where(eq(users.id, pref.userId)).limit(1);
    if (!user?.email) continue;
    result.eligibleUsers++;

    const sevenDays = new Date(now.getTime() + 7 * 86400000);
    const userDisputes = await db.select({
      referenceNumber: disputes.referenceNumber,
      status: disputes.status,
      openNegotiationDeadline: disputes.openNegotiationDeadline,
      offerSubmissionDeadline: disputes.offerSubmissionDeadline,
      paymentDeadline: disputes.paymentDeadline,
    }).from(disputes).where(eq(disputes.initiatingPartyId, user.id));

    const active = userDisputes
      .filter(d => !["closed", "ineligible", "withdrawn"].includes(d.status))
      .map(d => {
        const deadlines = [d.openNegotiationDeadline, d.offerSubmissionDeadline, d.paymentDeadline]
          .filter(Boolean).map(x => new Date(x!))
          .filter(x => x >= now && x <= sevenDays)
          .sort((a, b) => a.getTime() - b.getTime());
        return { referenceNumber: d.referenceNumber, status: d.status, nextDeadline: deadlines[0] ?? null };
      });

    const { title, message } = composeUserDigest({
      userName: user.name,
      frequency,
      activeDisputes: active,
      notifyOnDeadlineApproach: pref.notifyOnDeadlineApproach,
      notifyOnStatusChange: pref.notifyOnStatusChange,
    });

    try {
      const r = await send({ to: user.email, title, message });
      if (r.ok) {
        await db.execute(sql`UPDATE email_digest_preferences SET ${sql.raw(`"${markerCol}"`)} = NOW(), "updatedAt" = NOW() WHERE id = ${pref.id}`);
        result.sent++;
      } else {
        result.failures++;
      }
    } catch (err) {
      console.warn(`[EmailDigest] send failed for user ${user.id}:`, err instanceof Error ? err.message : err);
      result.failures++;
    }
  }

  return result;
}
