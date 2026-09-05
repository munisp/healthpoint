/**
 * Alerts tab: in-app notifications with unread highlighting, tap-to-read
 * (deep-linking into the related dispute), and mark-all-read.
 */
import React from "react";
import { useRouter } from "expo-router";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "../../src/api/hooks";
import { NotificationTypeBadge } from "../../src/components/StatusBadge";
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
  StaleBanner,
} from "../../src/components/Feedback";
import { formatDateTime } from "../../src/lib/format";
import { colors } from "../../src/theme";
import type { NotificationItem } from "../../src/api/types";

export default function NotificationsScreen() {
  const router = useRouter();
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
    isFromCache,
    dataUpdatedAtMs,
  } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const items = data ?? [];
  const hasUnread = items.some((n) => !n.isRead);

  const onPress = (item: NotificationItem) => {
    if (!item.isRead) markRead.mutate(item.id);
    if (item.disputeId) router.push(`/dispute/${item.disputeId}`);
  };

  return (
    <View style={styles.container}>
      {isFromCache && <StaleBanner fetchedAtMs={dataUpdatedAtMs} />}

      {isLoading ? (
        <SkeletonRows count={6} />
      ) : isError ? (
        <ErrorState
          message={
            error instanceof Error
              ? error.message
              : "Failed to load notifications."
          }
          onRetry={refetch}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={items.length === 0 ? { flexGrow: 1 } : undefined}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          ListHeaderComponent={
            hasUnread ? (
              <Pressable
                style={styles.markAll}
                disabled={markAll.isPending}
                onPress={() => markAll.mutate()}
              >
                <Text style={styles.markAllText}>
                  {markAll.isPending ? "Marking\u2026" : "Mark all as read"}
                </Text>
              </Pressable>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              title="You're all caught up"
              message="Deadline warnings, step changes, and determinations will appear here."
            />
          }
          renderItem={({ item }) => (
            <Pressable
              style={[styles.row, !item.isRead && styles.rowUnread]}
              onPress={() => onPress(item)}
            >
              <View style={styles.dotWrap}>
                {!item.isRead && <View style={styles.dot} />}
              </View>
              <View style={styles.rowBody}>
                <View style={styles.rowTop}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.title ?? "Notification"}
                  </Text>
                  {item.notificationType ? (
                    <NotificationTypeBadge type={item.notificationType} />
                  ) : null}
                </View>
                {item.message ? (
                  <Text style={styles.rowMessage} numberOfLines={2}>
                    {item.message}
                  </Text>
                ) : null}
                <Text style={styles.rowDate}>
                  {formatDateTime(item.createdAt)}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  markAll: { alignItems: "flex-end", paddingHorizontal: 16, paddingVertical: 10 },
  markAllText: { fontSize: 13, fontWeight: "600", color: colors.primary },
  row: {
    flexDirection: "row",
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingVertical: 12,
    paddingRight: 16,
  },
  rowUnread: { backgroundColor: "#f0fdfa" }, // teal-50 unread tint
  dotWrap: { width: 24, alignItems: "center", paddingTop: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  rowBody: { flex: 1 },
  rowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
    flexShrink: 1,
  },
  rowMessage: { marginTop: 3, fontSize: 13, color: colors.textMuted, lineHeight: 18 },
  rowDate: { marginTop: 6, fontSize: 11, color: colors.textFaint },
});
