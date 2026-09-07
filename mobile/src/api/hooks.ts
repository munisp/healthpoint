/**
 * Typed query/mutation hooks over the (loosely-typed) tRPC client.
 * Procedure names + payloads verified against server/routers.ts.
 */
import { useMutation } from "@tanstack/react-query";
import { trpc } from "./trpc";
import { queryClient } from "./queryClient";
import { useCachedQuery } from "./useCachedQuery";
import type {
  DisputeListPage,
  DisputeTimelineResponse,
  MeUser,
  NotificationItem,
  UserProfile,
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
