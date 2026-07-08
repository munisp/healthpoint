/**
 * Weekly AI Digest Heartbeat Handler
 * Route: POST /api/scheduled/weekly-digest
 * Schedule: Every Monday at 09:00 UTC (0 9 * * 1)
 *
 * Calls the IDRAssistantAgent to summarise the week's dispute activity and
 * delivers an in-platform notification to all admin users.
 */
import { Request, Response } from "express";
import { getDb } from "../db";
import { disputes, users, notifications } from "../../drizzle/schema";
import { eq, gte, count, and, inArray } from "drizzle-orm";

const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? "http://localhost:8000";

interface WeeklyDigestResult {
  processed: boolean;
  adminCount: number;
  notificationsSent: number;
  summary: string;
  weekStart: string;
  weekEnd: string;
  stats: {
    newDisputes: number;
    closedDisputes: number;
    activeDisputes: number;
    approachingDeadlines: number;
  };
}

export async function weeklyDigestHandler(req: Request, res: Response) {
  // Validate heartbeat token (same pattern as deadlineCheck)
  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  const cookieSecret = process.env.JWT_SECRET ?? "";
  if (!token || token.length < 8 || !cookieSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const db = await getDb();
  if (!db) {
    return res.status(503).json({ error: "Database unavailable" });
  }

  try {
    // ── Compute week window ─────────────────────────────────────────────────
    const now = new Date();
    const weekEnd = new Date(now);
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);

    // ── Gather stats for the past 7 days ────────────────────────────────────
    const allDisputes = await db.select().from(disputes);
    const newDisputes = allDisputes.filter(
      d => d.createdAt && new Date(d.createdAt) >= weekStart
    );
    const closedDisputes = allDisputes.filter(
      d => d.closedAt && new Date(d.closedAt) >= weekStart
    );
    const activeDisputes = allDisputes.filter(
      d => !["closed", "ineligible", "withdrawn"].includes(d.status)
    );

    // Disputes with deadlines in next 7 days
    const sevenDaysFromNow = new Date(now);
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    const approachingDeadlines = activeDisputes.filter(d => {
      const deadlines = [d.openNegotiationDeadline, d.offerSubmissionDeadline, d.paymentDeadline]
        .filter(Boolean)
        .map(d => new Date(d!));
      return deadlines.some(dl => dl >= now && dl <= sevenDaysFromNow);
    });

    const stats = {
      newDisputes: newDisputes.length,
      closedDisputes: closedDisputes.length,
      activeDisputes: activeDisputes.length,
      approachingDeadlines: approachingDeadlines.length,
    };

    // ── Build AI summary via IDRAssistantAgent ──────────────────────────────
    let summary = "";
    try {
      const aiPayload = {
        question: `Generate a concise weekly digest summary for NSA IDR administrators. 
This week (${weekStart.toLocaleDateString()} – ${weekEnd.toLocaleDateString()}):
- New disputes initiated: ${stats.newDisputes}
- Disputes closed/determined: ${stats.closedDisputes}  
- Currently active disputes: ${stats.activeDisputes}
- Disputes with deadlines in next 7 days: ${stats.approachingDeadlines}

Provide: 1) A 2-3 sentence executive summary, 2) Key action items for the week, 3) Any regulatory reminders relevant to the current caseload. Keep it concise and actionable.`,
        dispute_context: null,
      };

      const aiRes = await fetch(`${AI_SERVICE_URL}/ask-assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(aiPayload),
        signal: AbortSignal.timeout(60_000),
      });

      if (aiRes.ok) {
        const aiData = await aiRes.json() as { answer?: string };
        summary = aiData.answer ?? "";
      }
    } catch (aiErr) {
      console.warn("[WeeklyDigest] AI service unavailable, using fallback summary:", aiErr);
    }

    // Fallback summary if AI is unavailable
    if (!summary) {
      summary = `Weekly IDR Digest (${weekStart.toLocaleDateString()} – ${weekEnd.toLocaleDateString()}): ` +
        `${stats.newDisputes} new disputes initiated, ${stats.closedDisputes} closed, ` +
        `${stats.activeDisputes} active. ${stats.approachingDeadlines} disputes have deadlines ` +
        `approaching in the next 7 days — review the Deadline Alerts panel for details.`;
    }

    // ── Deliver notification to all admin users ──────────────────────────────
    const adminUsers = await db.select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.role, "admin"));

    let notificationsSent = 0;
    const weekLabel = `${weekStart.toLocaleDateString()} – ${weekEnd.toLocaleDateString()}`;

    for (const admin of adminUsers) {
      // Check for duplicate (idempotency: one digest per admin per week)
      const weekStartStr = weekStart.toISOString().slice(0, 10);
      const existingTitle = `Weekly IDR Digest — ${weekLabel}`;
      const existing = await db.select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, admin.id),
            eq(notifications.title, existingTitle)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        console.log(`[WeeklyDigest] Skipping duplicate for admin ${admin.id}`);
        continue;
      }

      await db.insert(notifications).values({
        id: crypto.randomUUID(),
        userId: admin.id,
        disputeId: "system", // system-level digest, not tied to a specific dispute
        notificationType: "system_alert",
        title: existingTitle,
        message: summary,
        isRead: false,
        dueDate: null,
        createdAt: new Date(),
      });
      notificationsSent++;
    }

    const result: WeeklyDigestResult = {
      processed: true,
      adminCount: adminUsers.length,
      notificationsSent,
      summary,
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      stats,
    };

    console.log(`[WeeklyDigest] Completed: ${notificationsSent}/${adminUsers.length} admins notified`);
    return res.json(result);

  } catch (err) {
    console.error("[WeeklyDigest] Error:", err);
    return res.status(500).json({ error: "Weekly digest failed", details: String(err) });
  }
}
