/**
 * Dispute detail: summary card (amounts, parties, deadlines), the 19-step
 * NSA IDR timeline, offers, and attached documents.
 *
 * Data comes from a single disputes.getTimeline call, which returns the
 * timeline, the dispute row (with events/documents attached), and offers.
 */
import React from "react";
import { useLocalSearchParams } from "expo-router";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useDisputeTimeline } from "../../src/api/hooks";
import { StatusBadge } from "../../src/components/StatusBadge";
import {
  ErrorState,
  SkeletonRows,
  StaleBanner,
} from "../../src/components/Feedback";
import {
  formatDate,
  formatUsd,
  humanize,
} from "../../src/lib/format";
import { colors } from "../../src/theme";
import type { TimelineEntry } from "../../src/api/types";

function AmountRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.amountRow}>
      <Text style={styles.amountLabel}>{label}</Text>
      <Text style={styles.amountValue}>{value}</Text>
    </View>
  );
}

function TimelineItem({ entry, isLast }: { entry: TimelineEntry; isLast: boolean }) {
  const dotStyle = entry.isCompleted
    ? styles.dotCompleted
    : entry.isCurrent
      ? styles.dotCurrent
      : styles.dotPending;
  return (
    <View style={styles.timelineRow}>
      <View style={styles.timelineRail}>
        <View style={[styles.dot, dotStyle]} />
        {!isLast && (
          <View
            style={[
              styles.connector,
              entry.isCompleted && styles.connectorCompleted,
            ]}
          />
        )}
      </View>
      <View style={styles.timelineBody}>
        <Text
          style={[
            styles.timelineLabel,
            entry.isCurrent && styles.timelineLabelCurrent,
            entry.isPending && styles.timelineLabelPending,
          ]}
        >
          {entry.stepNumber}. {entry.label}
        </Text>
        {entry.event?.description ? (
          <Text style={styles.timelineEvent}>{entry.event.description}</Text>
        ) : null}
        {entry.event?.createdAt ? (
          <Text style={styles.timelineDate}>{formatDate(entry.event.createdAt)}</Text>
        ) : null}
      </View>
    </View>
  );
}

export default function DisputeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
    isFromCache,
    dataUpdatedAtMs,
  } = useDisputeTimeline(id);

  if (isLoading) {
    return (
      <View style={styles.container}>
        <SkeletonRows count={5} />
      </View>
    );
  }

  if (isError || !data) {
    return (
      <View style={styles.container}>
        <ErrorState
          message={
            error instanceof Error ? error.message : "Dispute not found."
          }
          onRetry={refetch}
        />
      </View>
    );
  }

  const { dispute, timeline, offers } = data;
  const documents = dispute.documents ?? [];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refetch}
          tintColor={colors.primary}
        />
      }
    >
      {isFromCache && <StaleBanner fetchedAtMs={dataUpdatedAtMs} />}

      <View style={styles.headerRow}>
        <Text style={styles.title}>{dispute.referenceNumber}</Text>
        <StatusBadge status={dispute.status} />
      </View>
      <Text style={styles.subtitle}>
        {dispute.initiatingPartyName ?? "Unknown provider"} vs{" "}
        {dispute.respondingPartyName ?? "Unknown payer"}
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardHeader}>Amounts</Text>
        <AmountRow label="Billed" value={formatUsd(dispute.billedAmount)} />
        <AmountRow label="QPA" value={formatUsd(dispute.qpaAmount)} />
        <AmountRow
          label="Provider offer"
          value={formatUsd(dispute.initiatingPartyOffer)}
        />
        <AmountRow
          label="Payer offer"
          value={formatUsd(dispute.respondingPartyOffer)}
        />
        <AmountRow
          label="Determination"
          value={formatUsd(dispute.determinationAmount)}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardHeader}>Details</Text>
        <AmountRow
          label="Service"
          value={humanize(dispute.serviceType ?? undefined)}
        />
        <AmountRow label="Service date" value={formatDate(dispute.serviceDate)} />
        <AmountRow
          label="CPT codes"
          value={dispute.cptCodes?.length ? dispute.cptCodes.join(", ") : "\u2014"}
        />
        <AmountRow label="Patient state" value={dispute.patientState ?? "\u2014"} />
        <AmountRow label="Facility state" value={dispute.facilityState ?? "\u2014"} />
        <AmountRow label="IDR entity" value={dispute.idrEntityName ?? "\u2014"} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardHeader}>Deadlines</Text>
        <AmountRow
          label="Open negotiation"
          value={formatDate(dispute.openNegotiationDeadline)}
        />
        <AmountRow
          label="Offer submission"
          value={formatDate(dispute.offerSubmissionDeadline)}
        />
        <AmountRow
          label="Determination"
          value={formatDate(dispute.determinationDeadline)}
        />
        <AmountRow label="Payment" value={formatDate(dispute.paymentDeadline)} />
      </View>

      {offers.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardHeader}>Offers</Text>
          {offers.map((offer) => (
            <View key={offer.id} style={styles.amountRow}>
              <Text style={styles.amountLabel}>
                {humanize(offer.offerType)}
                {offer.isAccepted ? " (accepted)" : ""}
              </Text>
              <Text style={styles.amountValue}>
                {formatUsd(offer.amount)}
                {offer.submittedAt ? `  \u00b7 ${formatDate(offer.submittedAt)}` : ""}
              </Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardHeader}>IDR Timeline</Text>
        {timeline.map((entry, index) => (
          <TimelineItem
            key={entry.step}
            entry={entry}
            isLast={index === timeline.length - 1}
          />
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardHeader}>
          Documents{documents.length > 0 ? ` (${documents.length})` : ""}
        </Text>
        {documents.length === 0 ? (
          <Text style={styles.emptyText}>No documents attached yet.</Text>
        ) : (
          documents.map((doc) => (
            <View key={doc.id} style={styles.docRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.docName} numberOfLines={1}>
                  {doc.fileName}
                </Text>
                <Text style={styles.docMeta}>
                  {humanize(doc.documentType ?? undefined)} \u00b7{" "}
                  {formatDate(doc.uploadedAt)}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>

      {dispute.notes ? (
        <View style={styles.card}>
          <Text style={styles.cardHeader}>Notes</Text>
          <Text style={styles.notes}>{dispute.notes}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  title: { fontSize: 20, fontWeight: "700", color: colors.text, flexShrink: 1 },
  subtitle: { marginTop: 4, fontSize: 13, color: colors.textMuted },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    marginTop: 14,
  },
  cardHeader: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textFaint,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  amountRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    gap: 12,
  },
  amountLabel: { fontSize: 13, color: colors.textMuted, flexShrink: 1 },
  amountValue: { fontSize: 13, fontWeight: "600", color: colors.text, textAlign: "right" },
  timelineRow: { flexDirection: "row" },
  timelineRail: { width: 20, alignItems: "center" },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  dotCompleted: { backgroundColor: colors.primary },
  dotCurrent: {
    backgroundColor: "#d97706", // amber-600
    borderWidth: 2,
    borderColor: "#fef3c7", // amber-100 ring
  },
  dotPending: { backgroundColor: colors.border },
  connector: { width: 2, flex: 1, backgroundColor: colors.border, marginTop: 2 },
  connectorCompleted: { backgroundColor: colors.primarySoft },
  timelineBody: { flex: 1, paddingLeft: 10, paddingBottom: 16 },
  timelineLabel: { fontSize: 13, fontWeight: "600", color: colors.text },
  timelineLabelCurrent: { color: "#b45309" }, // amber-700
  timelineLabelPending: { color: colors.textFaint, fontWeight: "500" },
  timelineEvent: { marginTop: 2, fontSize: 12, color: colors.textMuted, lineHeight: 17 },
  timelineDate: { marginTop: 2, fontSize: 11, color: colors.textFaint },
  emptyText: { fontSize: 13, color: colors.textFaint },
  docRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  docName: { fontSize: 13, fontWeight: "600", color: colors.text },
  docMeta: { marginTop: 2, fontSize: 12, color: colors.textMuted },
  notes: { fontSize: 13, color: colors.text, lineHeight: 19 },
});
