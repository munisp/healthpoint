import React from "react";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { trpc } from "../../src/api/trpc";

// Shape returned by the server's disputes.getById procedure
// (verified against server/routers.ts → getDisputeById()).
type DisputeDetail = {
  id: string;
  referenceNumber: string;
  status: string;
  currentStep?: string | null;
  serviceType?: string | null;
  serviceDate?: string | Date | null;
  billedAmount?: string | number | null;
  qpaAmount?: string | number | null;
  initiatingPartyName?: string | null;
  respondingPartyName?: string | null;
  patientState?: string | null;
  facilityState?: string | null;
  notes?: string | null;
};

function formatAmount(value: string | number | null | undefined): string {
  if (value == null) return "—";
  return `$${Number(value).toLocaleString()}`;
}

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

export default function DisputeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["disputes.getById", id],
    queryFn: () =>
      trpc.disputes.getById.query({ id: String(id) }) as Promise<DisputeDetail>,
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (isError || !data) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>
          Failed to load dispute: {error instanceof Error ? error.message : "not found"}
        </Text>
      </View>
    );
  }

  const fields: Array<[string, string]> = [
    ["Status", data.status],
    ["Current step", (data.currentStep ?? "—").replace(/^STEP_\d+_/, "").replace(/_/g, " ")],
    ["Service type", (data.serviceType ?? "—").replace(/_/g, " ")],
    ["Service date", formatDate(data.serviceDate)],
    ["Initiating party", data.initiatingPartyName ?? "—"],
    ["Responding party", data.respondingPartyName ?? "—"],
    ["Billed amount", formatAmount(data.billedAmount)],
    ["QPA", formatAmount(data.qpaAmount)],
    ["Patient state", data.patientState ?? "—"],
    ["Facility state", data.facilityState ?? "—"],
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.title}>{data.referenceNumber}</Text>
      {fields.map(([label, value]) => (
        <View key={label} style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <Text style={styles.fieldValue}>{value}</Text>
        </View>
      ))}
      {data.notes ? (
        <View style={{ marginTop: 16 }}>
          <Text style={styles.fieldLabel}>Notes</Text>
          <Text style={styles.notes}>{data.notes}</Text>
        </View>
      ) : null}
    </ScrollView>
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
  title: { fontSize: 22, fontWeight: "700", color: "#111827", marginBottom: 16 },
  fieldRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  fieldLabel: { fontSize: 13, color: "#6b7280" },
  fieldValue: { fontSize: 14, color: "#111827", maxWidth: "60%", textAlign: "right" },
  notes: { marginTop: 6, fontSize: 14, color: "#374151" },
  error: { fontSize: 14, color: "#dc2626", textAlign: "center" },
});
