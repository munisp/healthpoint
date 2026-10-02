/**
 * Disputes tab: searchable/filterable dispute list with status badges
 * (muted green/amber/red palette mirroring the web client), pull-to-refresh,
 * skeleton loading, empty + error states, and an offline staleness banner.
 */
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "expo-router";
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useDisputes } from "../../src/api/hooks";
import { StatusBadge } from "../../src/components/StatusBadge";
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
  StaleBanner,
} from "../../src/components/Feedback";
import { hapticSelection } from "../../src/lib/haptics";
import { formatDate, formatUsd, humanize } from "../../src/lib/format";
import { fontSize, spacing, useColors, MIN_TOUCH_TARGET, type Palette } from "../../src/theme";
import type { DisputeListItem } from "../../src/api/types";

/**
 * Memoized list row. FlatList re-invokes renderItem on every parent render
 * (e.g. each debounced search keystroke changes state); with a stable
 * renderItem + a memoized row, unchanged rows skip reconciliation entirely.
 */
const DisputeRow = memo(function DisputeRow({
  item,
  c,
}: {
  item: DisputeListItem;
  c: Palette;
}) {
  return (
    <Link href={`/dispute/${item.id}`} asChild>
      <Pressable
        style={[
          styles.card,
          { backgroundColor: c.card, borderColor: c.border },
        ]}
      >
        <View style={styles.cardTopRow}>
          <Text style={[styles.cardTitle, { color: c.text }]}>
            {item.referenceNumber}
          </Text>
          <StatusBadge status={item.status} />
        </View>
        <Text style={[styles.cardSubtitle, { color: c.textMuted }]}>
          {item.respondingPartyName ?? "Unknown payer"}
          {item.serviceType ? ` · ${humanize(item.serviceType)}` : ""}
        </Text>
        <View style={styles.cardBottomRow}>
          <Text style={[styles.cardAmount, { color: c.text }]}>
            {formatUsd(item.billedAmount)}
          </Text>
          <Text style={[styles.cardDate, { color: c.textFaint }]}>
            {formatDate(item.serviceDate)}
          </Text>
        </View>
      </Pressable>
    </Link>
  );
});

const STATUS_FILTERS = [
  "all",
  "open_negotiation",
  "idr_initiated",
  "eligibility_review",
  "offer_submission",
  "under_arbitration",
  "determination_issued",
  "payment_pending",
  "closed",
] as const;

export default function DisputesScreen() {
  const c = useColors();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<string>("all");

  // Debounce search input so we don't fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Stable filter object: a fresh inline object each render would give
  // downstream memoized hooks a new reference identity for no reason.
  const filter = useMemo(
    () => ({ status, search: debouncedSearch }),
    [status, debouncedSearch]
  );
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
    isFromCache,
    dataUpdatedAtMs,
  } = useDisputes(filter);

  const items = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? items.length;

  const keyExtractor = useCallback((item: DisputeListItem) => item.id, []);
  const renderItem = useCallback(
    ({ item }: { item: DisputeListItem }) => <DisputeRow item={item} c={c} />,
    [c]
  );
  const refreshControl = useMemo(
    () => (
      <RefreshControl
        refreshing={isRefetching}
        onRefresh={refetch}
        tintColor={c.primary}
      />
    ),
    [isRefetching, refetch, c.primary]
  );
  const listHeader = useMemo(
    () =>
      total > 0 ? (
        <Text style={[styles.countText, { color: c.textFaint }]}>
          {total} dispute{total === 1 ? "" : "s"}
        </Text>
      ) : null,
    [total, c.textFaint]
  );

  return (
    <View style={[styles.container, { backgroundColor: c.bg }]}>
      <View
        style={[
          styles.searchBox,
          { backgroundColor: c.card, borderColor: c.border },
        ]}
      >
        <Ionicons name="search" size={16} color={c.textFaint} />
        <TextInput
          style={[styles.searchInput, { color: c.text }]}
          placeholder="Search reference, provider, payer"
          placeholderTextColor={c.textFaint}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <Pressable
            onPress={() => setSearch("")}
            hitSlop={8}
            accessibilityLabel="Clear search"
            accessibilityRole="button"
          >
            <Ionicons name="close-circle" size={16} color={c.textFaint} />
          </Pressable>
        )}
      </View>
      {/* W7-1: mobile dispute creation entry point */}
      <Link href="/dispute/new" asChild>
        <Pressable
          style={[styles.newButton, { backgroundColor: c.primary }]}
          accessibilityRole="button"
          accessibilityLabel="Create new dispute"
        >
          <Ionicons name="add" size={18} color="#ffffff" />
          <Text style={styles.newButtonText}>New dispute</Text>
        </Pressable>
      </Link>
      <View style={styles.chipsWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {STATUS_FILTERS.map((s) => {
            const active = status === s;
            return (
              <Pressable
                key={s}
                onPress={() => {
                  hapticSelection();
                  setStatus(s);
                }}
                style={[
                  styles.chip,
                  { borderColor: active ? c.primary : c.border },
                  { backgroundColor: active ? c.primarySoft : c.card },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: active ? c.primary : c.textMuted },
                    active && styles.chipTextActive,
                  ]}
                >
                  {s === "all" ? "All" : humanize(s)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {isFromCache && <StaleBanner fetchedAtMs={dataUpdatedAtMs} />}

      {isLoading ? (
        <SkeletonRows count={6} />
      ) : isError ? (
        <ErrorState
          message={
            error instanceof Error ? error.message : "Failed to load disputes."
          }
          onRetry={refetch}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={items.length === 0 ? styles.emptyList : undefined}
          refreshControl={refreshControl}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            <EmptyState
              title="No disputes found"
              message={
                debouncedSearch || status !== "all"
                  ? "Try clearing the search or choosing a different status."
                  : "Disputes you create on the web will appear here."
              }
            />
          }
          /* Virtualization tuning (STATIC-ONLY rationale, see
             mobile/docs/performance.md): cap the initial render burst and
             per-batch work after a 50-item fetch, and clip off-screen rows
             to free native view memory while scrolling. */
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          updateCellsBatchingPeriod={50}
          windowSize={7}
          removeClippedSubviews
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  emptyList: { flexGrow: 1 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    margin: spacing.md,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderRadius: 10,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    minHeight: MIN_TOUCH_TARGET,
    fontSize: fontSize.body,
  },
  newButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: 10,
    minHeight: MIN_TOUCH_TARGET,
  },
  newButtonText: { color: "#ffffff", fontSize: fontSize.body, fontWeight: "600" },
  chipsWrap: { paddingLeft: spacing.md, marginBottom: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    minHeight: 32,
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 1,
    marginRight: spacing.sm,
    marginVertical: spacing.sm,
  },
  chipText: { fontSize: fontSize.small },
  chipTextActive: { fontWeight: "600" },
  countText: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 6,
    fontSize: fontSize.small,
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md + 2,
    marginHorizontal: spacing.md,
    marginBottom: 10,
  },
  cardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  cardTitle: { fontSize: 15, fontWeight: "600", flexShrink: 1 },
  cardSubtitle: { marginTop: spacing.xs, fontSize: 13 },
  cardBottomRow: {
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardAmount: { fontSize: fontSize.body, fontWeight: "600" },
  cardDate: { fontSize: fontSize.small },
});
