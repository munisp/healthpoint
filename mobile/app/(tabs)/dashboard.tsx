/**
 * Dashboard tab: an at-a-glance operational view.
 *
 * - KPI cards from dashboard.stats (total, in IDR, due soon, overdue,
 *   closed this month, unread alerts).
 * - 7-day sparkline from dashboard.dailyStats — pure RN bar chart (no
 *   chart dependency).
 * - Deadline-alert strip when anything is overdue / due soon.
 * - Recent disputes (dashboard.stats.recentDisputes) linking to detail.
 *
 * Pull-to-refresh, skeleton loading, error + empty states, and the offline
 * staleness banner — same contract as the other tabs.
 */
import React from "react";
import { Link, useRouter } from "expo-router";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../src/auth/AuthContext";
import {
  useDailyStats,
  useDashboardStats,
  useDisputesByMonth,
} from "../../src/api/hooks";
import { StatusBadge } from "../../src/components/StatusBadge";
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
  StaleBanner,
} from "../../src/components/Feedback";
import { hapticSelection } from "../../src/lib/haptics";
import { formatDate, formatUsd } from "../../src/lib/format";
import {
  fontSize,
  spacing,
  useColors,
  MIN_TOUCH_TARGET,
  type Palette,
} from "../../src/theme";
import type { DailyStat } from "../../src/api/types";

/** Pure-RN bar sparkline: one bar per day, scaled to the max bucket. */
function Sparkline({ data, c }: { data: DailyStat[]; c: Palette }) {
  const max = Math.max(1, ...data.map((d) => d.total));
  return (
    <View>
      <View style={sparkStyles.row}>
        {data.map((d) => (
          <View key={d.date} style={sparkStyles.barWrap}>
            <View
              style={[
                sparkStyles.bar,
                {
                  height: Math.max(3, (d.total / max) * 56),
                  backgroundColor: c.primary,
                },
              ]}
            />
          </View>
        ))}
      </View>
      <View style={sparkStyles.row}>
        {data.map((d) => (
          <Text key={d.date} style={[sparkStyles.label, { color: c.textFaint }]}>
            {new Date(`${d.date}T12:00:00`).toLocaleDateString("en-US", {
              weekday: "narrow",
            })}
          </Text>
        ))}
      </View>
    </View>
  );
}

const sparkStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 6,
  },
  barWrap: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  bar: { width: "70%", borderRadius: 3 },
  label: { flex: 1, marginTop: 6, fontSize: 10, textAlign: "center" },
});

interface KpiProps {
  label: string;
  value: number;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  tint: string;
  c: Palette;
  onPress?: () => void;
}

function KpiCard({ label, value, icon, tint, c, onPress }: KpiProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[
        kpiStyles.card,
        { backgroundColor: c.card, borderColor: c.border },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
    >
      <Ionicons name={icon} size={18} color={tint} />
      <Text style={[kpiStyles.value, { color: c.text }]}>{value}</Text>
      <Text style={[kpiStyles.label, { color: c.textMuted }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const kpiStyles = StyleSheet.create({
  card: {
    flexBasis: "31%",
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    minHeight: 84,
    gap: 2,
  },
  value: { fontSize: 22, fontWeight: "700" },
  label: { fontSize: fontSize.caption },
});

export default function DashboardScreen() {
  const c = useColors();
  const router = useRouter();
  const { status } = useAuth();
  const authed = status === "authenticated";

  const stats = useDashboardStats(authed);
  const daily = useDailyStats(7, authed);
  const monthly = useDisputesByMonth(6, authed);

  const isLoading = stats.isLoading;
  const isError = stats.isError;
  const isRefetching = stats.isRefetching || daily.isRefetching;
  const isFromCache = stats.isFromCache || daily.isFromCache;

  const refetchAll = () => {
    stats.refetch();
    daily.refetch();
    monthly.refetch();
  };

  const data = stats.data;
  const deadlinePressure = (data?.overdue ?? 0) > 0 || (data?.dueSoon ?? 0) > 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refetchAll}
          tintColor={c.primary}
        />
      }
    >
      {isFromCache && (
        <StaleBanner fetchedAtMs={stats.dataUpdatedAtMs ?? daily.dataUpdatedAtMs} />
      )}

      {isLoading ? (
        <SkeletonRows count={5} />
      ) : isError ? (
        <ErrorState
          message={
            stats.error instanceof Error
              ? stats.error.message
              : "Failed to load the dashboard."
          }
          onRetry={refetchAll}
        />
      ) : !data ? (
        <EmptyState
          title="Nothing here yet"
          message="Disputes you create on the web portal will show up here."
        />
      ) : (
        <>
          <Text style={[screenStyles.greeting, { color: c.text }]}>
            Overview
          </Text>

          {deadlinePressure && (
            <Pressable
              style={[
                screenStyles.alertStrip,
                {
                  backgroundColor:
                    (data.overdue ?? 0) > 0 ? c.dangerSoft : c.warningSoft,
                },
              ]}
              onPress={() => {
                hapticSelection();
                router.push("/notifications");
              }}
              accessibilityRole="button"
            >
              <Ionicons
                name="alert-circle"
                size={18}
                color={(data.overdue ?? 0) > 0 ? c.danger : c.warning}
              />
              <Text
                style={[
                  screenStyles.alertText,
                  { color: (data.overdue ?? 0) > 0 ? c.danger : c.warning },
                ]}
              >
                {data.overdue > 0
                  ? `${data.overdue} dispute${data.overdue === 1 ? "" : "s"} past deadline`
                  : ""}
                {data.overdue > 0 && data.dueSoon > 0 ? " \u00b7 " : ""}
                {data.dueSoon > 0
                  ? `${data.dueSoon} due within 5 business days`
                  : ""}
              </Text>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={(data.overdue ?? 0) > 0 ? c.danger : c.warning}
              />
            </Pressable>
          )}

          <View style={screenStyles.kpiGrid}>
            <KpiCard label="Total disputes" value={data.total} icon="folder-open-outline" tint={c.primary} c={c} />
            <KpiCard
              label="In IDR"
              value={data.inIDR}
              icon="git-branch-outline"
              tint={c.primary}
              c={c}
              onPress={() => router.push("/disputes")}
            />
            <KpiCard label="Open negotiation" value={data.openNegotiation} icon="chatbubbles-outline" tint={c.primary} c={c} />
            <KpiCard label="Due soon" value={data.dueSoon} icon="time-outline" tint={c.warning} c={c} />
            <KpiCard label="Overdue" value={data.overdue} icon="alert-circle-outline" tint={c.danger} c={c} />
            <KpiCard label="Closed (30d)" value={data.closedThisMonth} icon="checkmark-circle-outline" tint={c.primary} c={c} />
          </View>

          <View
            style={[
              screenStyles.card,
              { backgroundColor: c.card, borderColor: c.border },
            ]}
          >
            <Text style={[screenStyles.cardHeader, { color: c.textFaint }]}>
              Activity — last 7 days
            </Text>
            {daily.data && daily.data.some((d) => d.total > 0) ? (
              <Sparkline data={daily.data} c={c} />
            ) : (
              <Text style={[screenStyles.emptyHint, { color: c.textFaint }]}>
                No dispute activity in the last week.
              </Text>
            )}
          </View>

          <View
            style={[
              screenStyles.card,
              { backgroundColor: c.card, borderColor: c.border },
            ]}
          >
            <Text style={[screenStyles.cardHeader, { color: c.textFaint }]}>
              Recent disputes
            </Text>
            {data.recentDisputes.length === 0 ? (
              <Text style={[screenStyles.emptyHint, { color: c.textFaint }]}>
                No disputes yet — they appear here once created.
              </Text>
            ) : (
              data.recentDisputes.map((item, i) => (
                <Link key={item.id} href={`/dispute/${item.id}`} asChild>
                  <Pressable
                    style={[
                      screenStyles.recentRow,
                      i > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: c.border,
                      },
                    ]}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text
                        style={[screenStyles.recentTitle, { color: c.text }]}
                        numberOfLines={1}
                      >
                        {item.referenceNumber}
                      </Text>
                      <Text
                        style={[screenStyles.recentSub, { color: c.textMuted }]}
                        numberOfLines={1}
                      >
                        {item.respondingPartyName ?? "Unknown payer"}
                        {" \u00b7 "}
                        {formatUsd(item.billedAmount)}
                        {" \u00b7 "}
                        {formatDate(item.serviceDate)}
                      </Text>
                    </View>
                    <StatusBadge status={item.status} />
                  </Pressable>
                </Link>
              ))
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const screenStyles = StyleSheet.create({
  greeting: {
    fontSize: fontSize.hero,
    fontWeight: "700",
    marginBottom: spacing.md,
  },
  alertStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    marginBottom: spacing.md,
  },
  alertText: { flex: 1, fontSize: fontSize.small, fontWeight: "600" },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md + 2,
    marginTop: spacing.sm,
  },
  cardHeader: {
    fontSize: fontSize.small,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
  },
  emptyHint: { fontSize: fontSize.small },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    minHeight: MIN_TOUCH_TARGET,
  },
  recentTitle: { fontSize: fontSize.body, fontWeight: "600" },
  recentSub: { fontSize: fontSize.small },
});
