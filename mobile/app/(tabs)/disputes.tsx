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
import { formatDate, formatUsd, humanize } from "../../src/lib/format";
import { colors } from "../../src/theme";
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
    <View style={styles.container}>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={16} color={colors.textFaint} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search reference, provider, payer"
          placeholderTextColor={colors.textFaint}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>
      <View style={styles.chipsWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {STATUS_FILTERS.map((s) => {
            const active = status === s;
            return (
              <Pressable
                key={s}
                onPress={() => setStatus(s)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
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
              tintColor={colors.primary}
            />
          }
          ListHeaderComponent={
            total > 0 ? (
              <Text style={styles.countText}>
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
              <Pressable style={styles.card}>
                <View style={styles.cardTopRow}>
                  <Text style={styles.cardTitle}>{item.referenceNumber}</Text>
                  <StatusBadge status={item.status} />
                </View>
                <Text style={styles.cardSubtitle}>
                  {item.respondingPartyName ?? "Unknown payer"}
                  {item.serviceType ? ` \u00b7 ${humanize(item.serviceType)}` : ""}
                </Text>
                <View style={styles.cardBottomRow}>
                  <Text style={styles.cardAmount}>
                    {formatUsd(item.billedAmount)}
                  </Text>
                  <Text style={styles.cardDate}>{formatDate(item.serviceDate)}</Text>
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
  container: { flex: 1, backgroundColor: colors.bg },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    margin: 12,
    marginBottom: 4,
    paddingHorizontal: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: colors.text },
  chipsWrap: { paddingLeft: 12, marginBottom: 4 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    marginRight: 8,
    marginVertical: 8,
  },
  chipActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { fontSize: 12, color: colors.textMuted },
  chipTextActive: { color: colors.primary, fontWeight: "600" },
  countText: {
    paddingHorizontal: 16,
    paddingBottom: 6,
    fontSize: 12,
    color: colors.textFaint,
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 12,
    marginBottom: 10,
  },
  cardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  cardTitle: { fontSize: 15, fontWeight: "600", color: colors.text, flexShrink: 1 },
  cardSubtitle: { marginTop: 4, fontSize: 13, color: colors.textMuted },
  cardBottomRow: {
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardAmount: { fontSize: 14, fontWeight: "600", color: colors.text },
  cardDate: { fontSize: 12, color: colors.textFaint },
});
