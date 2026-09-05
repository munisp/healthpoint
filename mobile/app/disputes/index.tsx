import React from "react";
import { Link } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { trpc } from "../../src/api/trpc";
import { useAuth } from "../../src/auth/AuthContext";

// Shape of items returned by the server's disputes.list procedure
// (verified against server/routers.ts → listDisputes()).
type DisputeListItem = {
  id: string;
  referenceNumber: string;
  status: string;
  serviceType?: string | null;
  billedAmount?: string | number | null;
  respondingPartyName?: string | null;
};

export default function DisputesScreen() {
  const { signOut } = useAuth();
  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["disputes.list", { limit: 20, offset: 0 }],
    queryFn: () =>
      trpc.disputes.list.query({ limit: 20, offset: 0 }) as Promise<{
        items: DisputeListItem[];
      }>,
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>
          Failed to load disputes: {error instanceof Error ? error.message : "unknown error"}
        </Text>
        <Pressable style={styles.secondaryButton} onPress={() => refetch()}>
          <Text style={styles.secondaryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const items = data?.items ?? [];

  return (
    <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
        ListEmptyComponent={
          <Text style={styles.empty}>No disputes found.</Text>
        }
        renderItem={({ item }) => (
          <Link href={`/disputes/${item.id}`} asChild>
            <Pressable style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.referenceNumber}</Text>
                <Text style={styles.rowSubtitle}>
                  {item.respondingPartyName ?? "Unknown payer"}
                  {item.billedAmount != null
                    ? ` · $${Number(item.billedAmount).toLocaleString()}`
                    : ""}
                </Text>
              </View>
              <Text style={styles.status}>{item.status}</Text>
            </Pressable>
          </Link>
        )}
      />
      <Pressable style={styles.secondaryButton} onPress={() => void signOut()}>
        <Text style={styles.secondaryButtonText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  rowTitle: { fontSize: 16, fontWeight: "600", color: "#111827" },
  rowSubtitle: { marginTop: 2, fontSize: 13, color: "#6b7280" },
  status: { fontSize: 12, color: "#2563eb", marginLeft: 12 },
  empty: { textAlign: "center", marginTop: 48, color: "#6b7280" },
  error: { fontSize: 14, color: "#dc2626", textAlign: "center" },
  secondaryButton: {
    margin: 16,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d1d5db",
  },
  secondaryButtonText: { color: "#374151", fontSize: 15 },
});
