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
import { hapticConfirm, hapticSelection } from "../../src/lib/haptics";
import { formatDateTime } from "../../src/lib/format";
import { fontSize, spacing, useColors, MIN_TOUCH_TARGET } from "../../src/theme";
import type { NotificationItem } from "../../src/api/types";

export default function NotificationsScreen() {
  const c = useColors();
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
    hapticSelection();
    if (!item.isRead) markRead.mutate(item.id);
    if (item.disputeId) router.push(`/dispute/${item.disputeId}`);
  };

  return (
    <View style={[styles.container, { backgroundColor: c.bg }]}>
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
              tintColor={c.primary}
            />
          }
          ListHeaderComponent={
            hasUnread ? (
              <Pressable
                style={styles.markAll}
                accessibilityRole="button"
                disabled={markAll.isPending}
                onPress={() => {
                  hapticConfirm();
                  markAll.mutate();
                }}
              >
                <Text style={[styles.markAllText, { color: c.primary }]}>
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
              style={[
                styles.row,
                { backgroundColor: c.card, borderBottomColor: c.border },
                !item.isRead && { backgroundColor: c.primarySoft },
              ]}
              onPress={() => onPress(item)}
            >
              <View style={styles.dotWrap}>
                {!item.isRead && (
                  <View style={[styles.dot, { backgroundColor: c.primary }]} />
                )}
              </View>
              <View style={styles.rowBody}>
                <View style={styles.rowTop}>
                  <Text style={[styles.rowTitle, { color: c.text }]} numberOfLines={1}>
                    {item.title ?? "Notification"}
                  </Text>
                  {item.notificationType ? (
                    <NotificationTypeBadge type={item.notificationType} />
                  ) : null}
                </View>
                {item.message ? (
                  <Text style={[styles.rowMessage, { color: c.textMuted }]} numberOfLines={2}>
                    {item.message}
                  </Text>
                ) : null}
                <Text style={[styles.rowDate, { color: c.textFaint }]}>
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
  container: { flex: 1 },
  markAll: {
    alignItems: "flex-end",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    minHeight: MIN_TOUCH_TARGET,
  },
  markAllText: { fontSize: 13, fontWeight: "600" },
  row: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.md,
    paddingRight: spacing.lg,
  },
  dotWrap: { width: 24, alignItems: "center", paddingTop: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowBody: { flex: 1 },
  rowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  rowTitle: { fontSize: fontSize.body, fontWeight: "600", flexShrink: 1 },
  rowMessage: { marginTop: 3, fontSize: 13, lineHeight: 18 },
  rowDate: { marginTop: 6, fontSize: fontSize.caption },
});
