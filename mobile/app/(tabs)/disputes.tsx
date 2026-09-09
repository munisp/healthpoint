/**
 * Disputes tab: searchable/filterable dispute list with status badges
 * (muted green/amber/red palette mirroring the web client), pull-to-refresh,
 * skeleton loading, empty + error states, and an offline staleness banner.
 */
import React, { useEffect, useState } from "react";
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
import { fontSize, spacing, useColors, MIN_TOUCH_TARGET } from "../../src/theme";
import type { DisputeListItem } from "../../src/api/types";

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

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
    isFromCache,
    dataUpdatedAtMs,
  } = useDisputes({ status, search: debouncedSearch });

  const items = data?.items ?? [];
  const total = data?.total ?? items.length;

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
          keyExtractor={(item: DisputeListItem) => item.id}
          contentContainerStyle={items.length === 0 ? { flexGrow: 1 } : undefined}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={c.primary}
            />
          }
          ListHeaderComponent={
            total > 0 ? (
              <Text style={[styles.countText, { color: c.textFaint }]}>
                {total} dispute{total === 1 ? "" : "s"}
              </Text>
            ) : null
          }
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
          renderItem={({ item }) => (
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
                  {item.serviceType ? ` \u00b7 ${humanize(item.serviceType)}` : ""}
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
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
