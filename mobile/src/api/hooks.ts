/**
 * Typed query/mutation hooks over the (loosely-typed) tRPC client.
 * Procedure names + payloads verified against server/routers.ts.
 */
import { useMutation } from "@tanstack/react-query";
import { trpc } from "./trpc";
import { queryClient } from "./queryClient";
import { useCachedQuery } from "./useCachedQuery";
import type {
  DailyStat,
  EmailPrefs,
  DashboardStats,
  DisputeListPage,
  DisputeTimelineResponse,
  DisputesByMonthRow,
  MeUser,
  NotificationItem,
  UserProfile,
  WorkflowProgress,
} from "./types";

export interface DisputeFilter {
  status?: string;
  search?: string;
}

export function useDisputes(filter: DisputeFilter) {
  const input = {
    limit: 50,
    offset: 0,
    ...(filter.status && filter.status !== "all" ? { status: filter.status } : {}),
    ...(filter.search ? { search: filter.search } : {}),
  };
  return useCachedQuery<DisputeListPage>({
    cacheKey: `disputes:${input.status ?? "all"}:${input.search ?? ""}`,
    queryKey: ["disputes", "list", input],
    queryFn: () => trpc.disputes.list.query(input) as Promise<DisputeListPage>,
  });
}

/** Detail + 19-step timeline + offers (single disputes.getTimeline call). */
export function useDisputeTimeline(id: string | undefined) {
  return useCachedQuery<DisputeTimelineResponse>({
    cacheKey: `dispute:${id ?? ""}`,
    queryKey: ["disputes", "timeline", id],
    queryFn: () =>
      trpc.disputes.getTimeline.query({
        disputeId: String(id),
      }) as Promise<DisputeTimelineResponse>,
    enabled: !!id,
  });
}

export function useNotifications(unreadOnly = false) {
  return useCachedQuery<NotificationItem[]>({
    cacheKey: `notifications:${unreadOnly ? "unread" : "all"}`,
    queryKey: ["notifications", "list", unreadOnly],
    queryFn: () =>
      trpc.notifications.list.query({ unreadOnly }) as Promise<NotificationItem[]>,
  });
}

function invalidateNotifications(): void {
  void queryClient.invalidateQueries({ queryKey: ["notifications"] });
}

export function useMarkNotificationRead() {
  return useMutation({
    mutationFn: (id: string) => trpc.notifications.markRead.mutate({ id }),
    onSuccess: invalidateNotifications,
  });
}

export function useMarkAllNotificationsRead() {
  return useMutation({
    mutationFn: () => trpc.notifications.markAllRead.mutate(),
    onSuccess: invalidateNotifications,
  });
}

/** Current user (auth.me). Returns null data when unauthenticated. */
export function useMe(enabled: boolean) {
  return useCachedQuery<MeUser | null>({
    cacheKey: "me",
    queryKey: ["me"],
    queryFn: () => trpc.auth.me.query() as Promise<MeUser | null>,
    enabled,
  });
}

/** Organisation / onboarding profile (profiles.get). */
export function useProfile(enabled: boolean) {
  return useCachedQuery<UserProfile | null>({
    cacheKey: "profile",
    queryKey: ["profile"],
    queryFn: async () => {
      // profiles.get returns `undefined` server-side when no row exists —
      // normalise to null so the cache shape stays stable.
      const row = (await trpc.profiles.get.query()) as UserProfile | null | undefined;
      return row ?? null;
    },
    enabled,
  });
}

/** dashboard.stats — KPI cards on the dashboard tab. */
export function useDashboardStats(enabled = true) {
  return useCachedQuery<DashboardStats>({
    cacheKey: "dashboard:stats",
    queryKey: ["dashboard", "stats"],
    queryFn: () => trpc.dashboard.stats.query() as Promise<DashboardStats>,
    enabled,
  });
}

/** dashboard.dailyStats — 7-day sparkline on the dashboard tab. */
export function useDailyStats(days = 7, enabled = true) {
  return useCachedQuery<DailyStat[]>({
    cacheKey: `dashboard:daily:${days}`,
    queryKey: ["dashboard", "dailyStats", days],
    queryFn: () =>
      trpc.dashboard.dailyStats.query({ days }) as Promise<DailyStat[]>,
    enabled,
  });
}

/** dashboard.disputesByMonth — monthly volume trend. */
export function useDisputesByMonth(months = 12, enabled = true) {
  return useCachedQuery<DisputesByMonthRow[]>({
    cacheKey: `dashboard:byMonth:${months}`,
    queryKey: ["dashboard", "disputesByMonth", months],
    queryFn: () =>
      trpc.dashboard.disputesByMonth.query({ months }) as Promise<
        DisputesByMonthRow[]
      >,
    enabled,
  });
}

/** workflow.progress — valid next steps for the advance action. */
export function useWorkflowProgress(disputeId: string | undefined) {
  return useCachedQuery<WorkflowProgress>({
    cacheKey: `workflow:${disputeId ?? ""}`,
    queryKey: ["workflow", "progress", disputeId],
    queryFn: () =>
      trpc.workflow.progress.query({
        disputeId: String(disputeId),
      }) as Promise<WorkflowProgress>,
    enabled: !!disputeId,
  });
}

export interface AdvanceDisputeInput {
  disputeId: string;
  newStep: string;
  newStatus: string;
  description: string;
}

function invalidateDispute(disputeId: string): void {
  void queryClient.invalidateQueries({ queryKey: ["disputes"] });
  void queryClient.invalidateQueries({ queryKey: ["workflow"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  void queryClient.invalidateQueries({ queryKey: ["notifications"] });
  void disputeId;
}

/**
 * disputes.advance — move a dispute to a new workflow step. The server
 * re-validates the transition (validateWorkflowTransition), so an invalid
 * advance surfaces as a readable error even if the client list was stale.
 */
export function useAdvanceDispute() {
  return useMutation({
    mutationFn: (input: AdvanceDisputeInput) =>
      trpc.disputes.advance.mutate(input),
    onSuccess: (_data, vars) => invalidateDispute(vars.disputeId),
  });
}

export interface SubmitOfferInput {
  disputeId: string;
  offerType: "initiating_party" | "responding_party" | "qpa" | "determination";
  /** Decimal-dollar string, validated against /^\d+(\.\d{1,2})?$/. */
  amount: string;
  rationale?: string;
}

/** disputes.submitOffer — submit a party offer for a dispute. */
export function useSubmitOffer() {
  return useMutation({
    mutationFn: (input: SubmitOfferInput) =>
      trpc.disputes.submitOffer.mutate(input),
    onSuccess: (_data, vars) => invalidateDispute(vars.disputeId),
  });
}

/** auth.logout — best-effort server-side session teardown. */
export async function logoutServerSide(): Promise<void> {
  await trpc.auth.logout.mutate();
}

/** emailPrefs.get — digest/notification email preferences (null = defaults). */
export function useEmailPrefs(enabled = true) {
  return useCachedQuery<EmailPrefs | null>({
    cacheKey: "emailPrefs",
    queryKey: ["emailPrefs"],
    queryFn: async () => {
      const row = (await trpc.emailPrefs.get.query()) as EmailPrefs | null | undefined;
      return row ?? null;
    },
    enabled,
  });
}
