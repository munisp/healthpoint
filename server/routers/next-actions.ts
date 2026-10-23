/**
 * server/routers/next-actions.ts
 *
 * Phase 21 (S4): next-action queue — a READ MODEL over existing operational
 * signals (disputes, deadlines, quarantine, remittance lines). Query-time
 * computation, no materialization in v1.
 *
 * Card sources (design §5):
 *   1. deadline alerts  — listUpcomingDeadlines (shared with the autopilot)
 *   2/3. advance cards  — currentStep + IDR_WORKFLOW_STEPS ordering, labels
 *                         from the shared step-deadlines module
 *   4. idle offers      — offer_submission with no initiating offer, idle
 *                         > 2 business days
 *   5. quarantine       — pending claim_quarantine rows; unposted remittance
 *                         lines (no mapped dispute)
 *
 * Dismissals: per-user, expiring (default 7 days), purged by the retention
 * worker on expires_at. Card impressions record S1 suggestion events
 * (surface "next_action", rule-based → modelVersionId null).
 */
import crypto from "node:crypto";
import { z } from "zod";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { disputes } from "../../drizzle/schema";
import { orgMemberships } from "../../drizzle/schema-personas";
import { claimQuarantine } from "../../drizzle/schema-bulk-upload";
import { remittance835Files, remittanceLines } from "../../drizzle/schema-submitter";
import { nextActionDismissals } from "../../drizzle/schema-intelligence";
import { requireDb } from "../personas/guards";
import { assertOrgMember, recordSuggestionEvents, contextHash } from "./intelligence";
import {
  listUpcomingDeadlines,
  STEP_LABELS,
  ACTIVE_DISPUTE_STATUSES,
} from "../idr/step-deadlines";
import { businessDaysBetween, getDeadlinePolicy } from "../idr/deadlines";
import { IDR_WORKFLOW_STEPS } from "../workflow/idr-workflow";
import { parseAlertDays } from "../scheduled/deadlineAutopilot";

type Db = Awaited<ReturnType<typeof requireDb>>;

/** Dismissal TTL (days). */
export const DISMISSAL_TTL_DAYS = 7;
/** Idle-offer threshold in business days. */
export const IDLE_OFFER_BUSINESS_DAYS = 2;

export interface NextActionCard {
  actionKey: string;
  kind: "deadline" | "advance_step" | "idle_offer" | "quarantine_repair" | "unposted_remittance";
  title: string;
  disputeId?: string;
  href: string;
  dueAt?: string;
  severity: "critical" | "warning" | "info";
  ctaLabel: string;
  /** Sort key: min days-to-deadline; null sorts after dated cards. */
  daysToDeadline: number | null;
  updatedAt?: string;
}

const NEXT_STEP_LABELS: Record<string, string> = STEP_LABELS;

/** Legal next step from the disputes.advance FSM allowedTransitions. */
function nextStepOf(currentStep: string | null): string | null {
  const steps = Object.keys(IDR_WORKFLOW_STEPS);
  const cur = currentStep ?? steps[0];
  const def = IDR_WORKFLOW_STEPS[cur as keyof typeof IDR_WORKFLOW_STEPS];
  if (!def) return null;
  for (const nxt of def.allowedTransitions) {
    const nd = IDR_WORKFLOW_STEPS[nxt as keyof typeof IDR_WORKFLOW_STEPS];
    if (!nd) continue;
    if (nd.isTerminal) continue;
    if (nxt === "STEP_17_DISPUTE_CLOSED" || nxt === "STEP_20_DISPUTE_WITHDRAWN") continue;
    return nxt;
  }
  return null;
}

/** Compute the card set for a set of orgs. Exported for tests/journey. */
export async function computeNextActions(
  db: Db,
  orgIds: string[],
  opts: { persona?: "provider" | "submitter" | "payer" | "idre"; now?: Date } = {},
): Promise<NextActionCard[]> {
  const now = opts.now ?? new Date();
  const cards: NextActionCard[] = [];
  if (orgIds.length === 0) return cards;

  const policy = getDeadlinePolicy();
  const maxThreshold = Math.max(...parseAlertDays());

  // ── 1. Deadline alerts (shared helper; org-scoped variant) ──────────────
  const deadlines = await listUpcomingDeadlines(db, now, orgIds);
  for (const r of deadlines) {
    if (r.deadline.getTime() <= now.getTime()) continue; // pre-expiry only
    if (r.remaining > maxThreshold) continue;
    const severity = r.remaining <= 1 ? "critical" : r.remaining <= 2 ? "warning" : "info";
    cards.push({
      actionKey: `deadline:${r.disputeId}:${r.type}`,
      kind: "deadline",
      title: `${r.type.replace(/_/g, " ")} deadline in ${r.remaining} ${r.dayKind} day(s) — ${r.referenceNumber ?? r.disputeId.slice(0, 8)}`,
      disputeId: r.disputeId,
      href: `/disputes/${r.disputeId}`,
      dueAt: r.deadline.toISOString(),
      severity,
      ctaLabel: "Open dispute",
      daysToDeadline: r.remaining,
    });
  }

  // ── Org-scoped active disputes for sources 2/3/4 ─────────────────────────
  const members = await db
    .select({ userId: orgMemberships.userId })
    .from(orgMemberships)
    .where(inArray(orgMemberships.orgId, orgIds));
  const memberIds = [...new Set(members.map((m: { userId: string }) => m.userId))];
  const active = memberIds.length
    ? await db.select().from(disputes)
        .where(and(inArray(disputes.status, [...ACTIVE_DISPUTE_STATUSES]), inArray(disputes.createdBy, memberIds)))
    : [];

  const isPayer = opts.persona === "payer";
  const isIdre = opts.persona === "idre";

  if (!isPayer && !isIdre) {
    // ── 3. Legal-next-step advance cards ───────────────────────────────────
    for (const d of active) {
      const nxt = nextStepOf(d.currentStep);
      if (!nxt) continue;
      cards.push({
        actionKey: `advance:${d.id}`,
        kind: "advance_step",
        title: `Advance ${d.referenceNumber ?? d.id.slice(0, 8)} to ${NEXT_STEP_LABELS[nxt] ?? nxt}`,
        disputeId: d.id,
        href: `/disputes/${d.id}`,
        severity: "info",
        ctaLabel: "Advance",
        daysToDeadline: null,
        updatedAt: d.updatedAt ? new Date(d.updatedAt).toISOString() : undefined,
      });
    }
  }

  // ── 4. Idle offers (payer persona sees ONLY these) ───────────────────────
  if (!isIdre) {
    for (const d of active) {
      if (d.status !== "offer_submission") continue;
      if (d.initiatingPartyOffer !== null && d.initiatingPartyOffer !== undefined) continue;
      const anchor = d.offerSubmissionDeadline ?? d.createdAt;
      if (!anchor) continue;
      const idleBusinessDays = businessDaysBetween(new Date(anchor), now, policy);
      if (idleBusinessDays <= IDLE_OFFER_BUSINESS_DAYS) continue;
      cards.push({
        actionKey: `idle-offer:${d.id}`,
        kind: "idle_offer",
        title: `Offer idle ${idleBusinessDays} business day(s) — ${d.referenceNumber ?? d.id.slice(0, 8)}`,
        disputeId: d.id,
        href: `/disputes/${d.id}`,
        dueAt: d.offerSubmissionDeadline ? new Date(d.offerSubmissionDeadline).toISOString() : undefined,
        severity: idleBusinessDays > 5 ? "warning" : "info",
        ctaLabel: isPayer ? "Submit responding offer" : "Submit offer",
        daysToDeadline: d.offerSubmissionDeadline
          ? businessDaysBetween(now, new Date(d.offerSubmissionDeadline), policy)
          : null,
        updatedAt: d.updatedAt ? new Date(d.updatedAt).toISOString() : undefined,
      });
    }
  }

  // ── IDRE persona: determination-pending items ────────────────────────────
  if (isIdre) {
    for (const d of active) {
      if (d.status !== "under_arbitration" && d.status !== "eligibility_review") continue;
      cards.push({
        actionKey: `determination:${d.id}`,
        kind: "advance_step",
        title: `Determination pending — ${d.referenceNumber ?? d.id.slice(0, 8)}`,
        disputeId: d.id,
        href: `/disputes/${d.id}`,
        dueAt: d.determinationDeadline ? new Date(d.determinationDeadline).toISOString() : undefined,
        severity: "warning",
        ctaLabel: "Review case",
        daysToDeadline: d.determinationDeadline
          ? Math.ceil((new Date(d.determinationDeadline).getTime() - now.getTime()) / 86400000)
          : null,
        updatedAt: d.updatedAt ? new Date(d.updatedAt).toISOString() : undefined,
      });
    }
  }

  if (!isPayer && !isIdre) {
    // ── 5a. Quarantine repair ──────────────────────────────────────────────
    const qRows = await db
      .select({ orgId: claimQuarantine.orgId, n: sql<number>`COUNT(*)::int` })
      .from(claimQuarantine)
      .where(and(inArray(claimQuarantine.orgId, orgIds), eq(claimQuarantine.status, "quarantined")))
      .groupBy(claimQuarantine.orgId);
    for (const q of qRows) {
      if (!q.n) continue;
      cards.push({
        actionKey: `quarantine:${q.orgId}`,
        kind: "quarantine_repair",
        title: `Repair ${q.n} quarantined claim${q.n === 1 ? "" : "s"}`,
        href: `/submitter/quarantine`,
        severity: "warning",
        ctaLabel: "Repair claims",
        daysToDeadline: null,
      });
    }

    // ── 5b. Unposted remittance lines ──────────────────────────────────────
    const files = await db.select({ id: remittance835Files.id, orgId: remittance835Files.orgId })
      .from(remittance835Files).where(inArray(remittance835Files.orgId, orgIds));
    if (files.length) {
      const unposted = await db
        .select({ n: sql<number>`COUNT(*)::int` })
        .from(remittanceLines)
        .where(and(inArray(remittanceLines.fileId, files.map(f => f.id)), isNull(remittanceLines.mappedDisputeId)));
      const n = Number(unposted[0]?.n ?? 0);
      if (n > 0) {
        cards.push({
          actionKey: `remittance:unposted`,
          kind: "unposted_remittance",
          title: `Post ${n} unmatched remittance line${n === 1 ? "" : "s"}`,
          href: `/submitter/remittances`,
          severity: "info",
          ctaLabel: "Review remittances",
          daysToDeadline: null,
        });
      }
    }
  }

  // Priority: min days-to-deadline first (nulls last), tie-break updatedAt.
  cards.sort((a, b) => {
    if (a.daysToDeadline === null && b.daysToDeadline === null) {
      return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
    }
    if (a.daysToDeadline === null) return 1;
    if (b.daysToDeadline === null) return -1;
    if (a.daysToDeadline !== b.daysToDeadline) return a.daysToDeadline - b.daysToDeadline;
    return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
  });
  return cards;
}

export const nextActionsRouter = router({
  list: protectedProcedure
    .input(z.object({
      orgId: z.string().optional(),
      persona: z.enum(["provider", "submitter", "payer", "idre"]).optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      let orgIds: string[];
      if (input.orgId) {
        await assertOrgMember(db, ctx.user.id, input.orgId, ["owner", "staff", "viewer"]);
        orgIds = [input.orgId];
      } else {
        const ms = await db.select({ orgId: orgMemberships.orgId }).from(orgMemberships)
          .where(eq(orgMemberships.userId, ctx.user.id));
        orgIds = [...new Set(ms.map((m: { orgId: string }) => m.orgId))];
      }
      const cards = await computeNextActions(db, orgIds, { persona: input.persona });

      // Filter dismissed (non-expired) cards.
      const keys = cards.map(c => c.actionKey);
      const dismissed = keys.length
        ? await db.select({ actionKey: nextActionDismissals.actionKey }).from(nextActionDismissals)
            .where(and(
              eq(nextActionDismissals.userId, ctx.user.id),
              inArray(nextActionDismissals.actionKey, keys),
              gt(nextActionDismissals.expiresAt, new Date()),
            ))
        : [];
      const dismissedSet = new Set(dismissed.map((d: { actionKey: string }) => d.actionKey));
      const visible = cards.filter(c => !dismissedSet.has(c.actionKey)).slice(0, input.limit);

      // S1: card impressions (rule-based producer; modelVersionId null).
      if (visible.length && orgIds.length) {
        await recordSuggestionEvents(db, visible.map(c => ({
          orgId: orgIds[0],
          userId: ctx.user.id,
          suggestionId: c.actionKey,
          surface: "next_action" as const,
          action: "presented" as const,
          modelName: "next-actions-v1",
          modelVersionId: null,
          contextHash: contextHash(orgIds[0], "next_action", { kind: c.kind }),
          metadata: { kind: c.kind },
        })));
      }
      return { cards: visible, dismissedCount: dismissedSet.size };
    }),

  dismiss: protectedProcedure
    .input(z.object({
      actionKey: z.string().min(1).max(191),
      ttlDays: z.number().int().min(1).max(90).default(DISMISSAL_TTL_DAYS),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const expiresAt = new Date(Date.now() + input.ttlDays * 24 * 60 * 60 * 1000);
      await db.insert(nextActionDismissals).values({
        id: crypto.randomUUID(),
        orgId: null,
        userId: ctx.user.id,
        actionKey: input.actionKey,
        expiresAt,
      }).onConflictDoUpdate({
        target: [nextActionDismissals.userId, nextActionDismissals.actionKey],
        set: { expiresAt },
      });
      return { dismissed: true, actionKey: input.actionKey, expiresAt: expiresAt.toISOString() };
    }),
});

export type NextActionsRouter = typeof nextActionsRouter;
