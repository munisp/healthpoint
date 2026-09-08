/**
 * Dispute detail: summary card (amounts, parties, deadlines), the 19-step
 * NSA IDR timeline, offers, attached documents — plus the two write
 * actions the server exposes to mobile:
 *
 * - Advance step: disputes.advance. Valid next steps come from
 *   workflow.progress (server-computed); when offline we fall back to the
 *   linear main path and let the server's validateWorkflowTransition reject
 *   anything invalid with a readable error. Every advance is confirmed via
 *   Alert before the mutation fires.
 * - Submit offer: disputes.submitOffer with a validated dollar amount and
 *   optional rationale.
 */
import React, { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  useAdvanceDispute,
  useDisputeTimeline,
  useSubmitOffer,
  useWorkflowProgress,
} from "../../src/api/hooks";
import { StatusBadge } from "../../src/components/StatusBadge";
import {
  ErrorState,
  SkeletonRows,
  StaleBanner,
} from "../../src/components/Feedback";
import { hapticConfirm, hapticError, hapticSuccess } from "../../src/lib/haptics";
import { nextMainPathStep, stepLabel, statusForStep } from "../../src/lib/steps";
import { formatDate, formatUsd, humanize } from "../../src/lib/format";
import { fontSize, spacing, useColors, MIN_TOUCH_TARGET } from "../../src/theme";
import type { Palette } from "../../src/theme";
import type { TimelineEntry } from "../../src/api/types";

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;

function AmountRow({
  label,
  value,
  c,
}: {
  label: string;
  value: string;
  c: Palette;
}) {
  return (
    <View style={styles.amountRow}>
      <Text style={[styles.amountLabel, { color: c.textMuted }]}>{label}</Text>
      <Text style={[styles.amountValue, { color: c.text }]}>{value}</Text>
    </View>
  );
}

function TimelineItem({
  entry,
  isLast,
  c,
}: {
  entry: TimelineEntry;
  isLast: boolean;
  c: Palette;
}) {
  const dotStyle = entry.isCompleted
    ? { backgroundColor: c.primary }
    : entry.isCurrent
      ? { backgroundColor: "#d97706", borderWidth: 2, borderColor: "#fef3c7" }
      : { backgroundColor: c.border };
  return (
    <View style={styles.timelineRow}>
      <View style={styles.timelineRail}>
        <View style={[styles.dot, dotStyle]} />
        {!isLast && (
          <View
            style={[
              styles.connector,
              { backgroundColor: entry.isCompleted ? c.primarySoft : c.border },
            ]}
          />
        )}
      </View>
      <View style={styles.timelineBody}>
        <Text
          style={[
            styles.timelineLabel,
            { color: c.text },
            entry.isCurrent && { color: "#b45309" },
            entry.isPending && { color: c.textFaint, fontWeight: "500" },
          ]}
        >
          {entry.stepNumber}. {entry.label}
        </Text>
        {entry.event?.description ? (
          <Text style={[styles.timelineEvent, { color: c.textMuted }]}>
            {entry.event.description}
          </Text>
        ) : null}
        {entry.event?.createdAt ? (
          <Text style={[styles.timelineDate, { color: c.textFaint }]}>
            {formatDate(entry.event.createdAt)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Advance-step + offer-submission action card. */
function ActionsCard({
  disputeId,
  currentStep,
  status,
  c,
  onChanged,
}: {
  disputeId: string;
  currentStep: string | null | undefined;
  status: string;
  c: Palette;
  onChanged: () => void;
}) {
  const progress = useWorkflowProgress(disputeId);
  const advance = useAdvanceDispute();
  const submitOffer = useSubmitOffer();

  const [showOfferForm, setShowOfferForm] = useState(false);
  const [amount, setAmount] = useState("");
  const [rationale, setRationale] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // Server-computed valid transitions; offline fallback = next main-path step.
  const transitions =
    progress.data?.validTransitions?.map((t) => ({ id: t.id, name: t.name })) ??
    [];
  const fallback = nextMainPathStep(currentStep);
  const options =
    transitions.length > 0
      ? transitions
      : fallback
        ? [{ id: fallback, name: stepLabel(fallback) }]
        : [];

  const terminal =
    status === "closed" || status === "ineligible" || options.length === 0;

  const confirmAdvance = (stepId: string, name: string) => {
    hapticConfirm();
    Alert.alert(
      "Advance dispute",
      `Move this dispute to "${name}"? This is recorded on the audit trail.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Advance",
          onPress: () => {
            advance.mutate(
              {
                disputeId,
                newStep: stepId,
                newStatus: statusForStep(stepId),
                description: `Advanced to ${name} from the mobile app`,
              },
              {
                onSuccess: () => {
                  hapticSuccess();
                  onChanged();
                },
                onError: (e) => {
                  hapticError();
                  Alert.alert(
                    "Could not advance",
                    e instanceof Error ? e.message : "Unknown error"
                  );
                },
              }
            );
          },
        },
      ]
    );
  };

  const onSubmitOffer = () => {
    setFormError(null);
    if (!AMOUNT_RE.test(amount.trim())) {
      hapticError();
      setFormError("Enter a dollar amount like 1250 or 1250.00");
      return;
    }
    hapticConfirm();
    submitOffer.mutate(
      {
        disputeId,
        offerType: "initiating_party",
        amount: amount.trim(),
        rationale: rationale.trim() || undefined,
      },
      {
        onSuccess: () => {
          hapticSuccess();
          setShowOfferForm(false);
          setAmount("");
          setRationale("");
          onChanged();
        },
        onError: (e) => {
          hapticError();
          setFormError(e instanceof Error ? e.message : "Offer failed to send.");
        },
      }
    );
  };

  if (terminal) return null;

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <Text style={[styles.cardHeader, { color: c.textFaint }]}>Actions</Text>

      {options.map((t) => (
        <Pressable
          key={t.id}
          style={[styles.primaryButton, { backgroundColor: c.primary }]}
          disabled={advance.isPending}
          onPress={() => confirmAdvance(t.id, t.name)}
          accessibilityRole="button"
        >
          <Ionicons name="arrow-forward-circle-outline" size={18} color="#fff" />
          <Text style={styles.primaryButtonText}>
            {advance.isPending ? "Advancing\u2026" : `Advance to ${t.name}`}
          </Text>
        </Pressable>
      ))}

      {!showOfferForm ? (
        <Pressable
          style={[
            styles.secondaryButton,
            { borderColor: c.primary },
            options.length > 0 && { marginTop: spacing.sm },
          ]}
          onPress={() => {
            hapticConfirm();
            setShowOfferForm(true);
          }}
          accessibilityRole="button"
        >
          <Ionicons name="cash-outline" size={18} color={c.primary} />
          <Text style={[styles.secondaryButtonText, { color: c.primary }]}>
            Submit an offer
          </Text>
        </Pressable>
      ) : (
        <View style={[styles.offerForm, { borderColor: c.border }]}>
          <Text style={[styles.offerLabel, { color: c.textMuted }]}>
            Offer amount (USD)
          </Text>
          <TextInput
            style={[
              styles.offerInput,
              { color: c.text, borderColor: c.border, backgroundColor: c.bg },
            ]}
            value={amount}
            onChangeText={setAmount}
            placeholder="1250.00"
            placeholderTextColor={c.textFaint}
            keyboardType="decimal-pad"
            autoFocus
          />
          <Text style={[styles.offerLabel, { color: c.textMuted }]}>
            Rationale (optional)
          </Text>
          <TextInput
            style={[
              styles.offerInput,
              styles.offerTextarea,
              { color: c.text, borderColor: c.border, backgroundColor: c.bg },
            ]}
            value={rationale}
            onChangeText={setRationale}
            placeholder="Why this amount is appropriate"
            placeholderTextColor={c.textFaint}
            multiline
          />
          {formError ? (
            <Text style={[styles.offerError, { color: c.danger }]}>{formError}</Text>
          ) : null}
          <View style={styles.offerButtons}>
            <Pressable
              onPress={() => {
                setShowOfferForm(false);
                setFormError(null);
              }}
              style={styles.offerCancel}
              accessibilityRole="button"
            >
              <Text style={{ color: c.textMuted, fontWeight: "600" }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={onSubmitOffer}
              disabled={submitOffer.isPending}
              style={[styles.primaryButton, { backgroundColor: c.primary, flex: 1 }]}
              accessibilityRole="button"
            >
              <Text style={styles.primaryButtonText}>
                {submitOffer.isPending ? "Submitting\u2026" : "Submit offer"}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

export default function DisputeDetailScreen() {
  const c = useColors();
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
      <View style={[styles.container, { backgroundColor: c.bg }]}>
        <SkeletonRows count={5} />
      </View>
    );
  }

  if (isError || !data) {
    return (
      <View style={[styles.container, { backgroundColor: c.bg }]}>
        <ErrorState
          message={error instanceof Error ? error.message : "Dispute not found."}
          onRetry={refetch}
        />
      </View>
    );
  }

  const { dispute, timeline, offers } = data;
  const documents = dispute.documents ?? [];

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: c.bg }]}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refetch}
          tintColor={c.primary}
        />
      }
    >
      {isFromCache && <StaleBanner fetchedAtMs={dataUpdatedAtMs} />}

      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: c.text }]}>
          {dispute.referenceNumber}
        </Text>
        <StatusBadge status={dispute.status} />
      </View>
      <Text style={[styles.subtitle, { color: c.textMuted }]}>
        {dispute.initiatingPartyName ?? "Unknown provider"} vs{" "}
        {dispute.respondingPartyName ?? "Unknown payer"}
      </Text>

      <ActionsCard
        disputeId={dispute.id}
        currentStep={dispute.currentStep}
        status={dispute.status}
        c={c}
        onChanged={refetch}
      />

      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[styles.cardHeader, { color: c.textFaint }]}>Amounts</Text>
        <AmountRow label="Billed" value={formatUsd(dispute.billedAmount)} c={c} />
        <AmountRow label="QPA" value={formatUsd(dispute.qpaAmount)} c={c} />
        <AmountRow
          label="Provider offer"
          value={formatUsd(dispute.initiatingPartyOffer)}
          c={c}
        />
        <AmountRow
          label="Payer offer"
          value={formatUsd(dispute.respondingPartyOffer)}
          c={c}
        />
        <AmountRow
          label="Determination"
          value={formatUsd(dispute.determinationAmount)}
          c={c}
        />
      </View>

      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[styles.cardHeader, { color: c.textFaint }]}>Details</Text>
        <AmountRow
          label="Service"
          value={humanize(dispute.serviceType ?? undefined)}
          c={c}
        />
        <AmountRow label="Service date" value={formatDate(dispute.serviceDate)} c={c} />
        <AmountRow
          label="CPT codes"
          value={dispute.cptCodes?.length ? dispute.cptCodes.join(", ") : "—"}
          c={c}
        />
        <AmountRow label="Patient state" value={dispute.patientState ?? "—"} c={c} />
        <AmountRow label="Facility state" value={dispute.facilityState ?? "—"} c={c} />
        <AmountRow label="IDR entity" value={dispute.idrEntityName ?? "—"} c={c} />
      </View>

      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[styles.cardHeader, { color: c.textFaint }]}>Deadlines</Text>
        <AmountRow
          label="Open negotiation"
          value={formatDate(dispute.openNegotiationDeadline)}
          c={c}
        />
        <AmountRow
          label="Offer submission"
          value={formatDate(dispute.offerSubmissionDeadline)}
          c={c}
        />
        <AmountRow
          label="Determination"
          value={formatDate(dispute.determinationDeadline)}
          c={c}
        />
        <AmountRow label="Payment" value={formatDate(dispute.paymentDeadline)} c={c} />
      </View>

      {offers.length > 0 && (
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.cardHeader, { color: c.textFaint }]}>Offers</Text>
          {offers.map((offer) => (
            <View key={offer.id} style={styles.amountRow}>
              <Text style={[styles.amountLabel, { color: c.textMuted }]}>
                {humanize(offer.offerType)}
                {offer.isAccepted ? " (accepted)" : ""}
              </Text>
              <Text style={[styles.amountValue, { color: c.text }]}>
                {formatUsd(offer.amount)}
                {offer.submittedAt ? `  \u00b7 ${formatDate(offer.submittedAt)}` : ""}
              </Text>
            </View>
          ))}
        </View>
      )}

      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[styles.cardHeader, { color: c.textFaint }]}>IDR Timeline</Text>
        {timeline.map((entry, index) => (
          <TimelineItem
            key={entry.step}
            entry={entry}
            isLast={index === timeline.length - 1}
            c={c}
          />
        ))}
      </View>

      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[styles.cardHeader, { color: c.textFaint }]}>
          Documents{documents.length > 0 ? ` (${documents.length})` : ""}
        </Text>
        {documents.length === 0 ? (
          <Text style={[styles.emptyText, { color: c.textFaint }]}>
            No documents attached yet.
          </Text>
        ) : (
          documents.map((doc) => (
            <View
              key={doc.id}
              style={[styles.docRow, { borderTopColor: c.border }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.docName, { color: c.text }]} numberOfLines={1}>
                  {doc.fileName}
                </Text>
                <Text style={[styles.docMeta, { color: c.textMuted }]}>
                  {`${humanize(doc.documentType ?? undefined)} \u00b7 ${formatDate(doc.uploadedAt)}`}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>

      {dispute.notes ? (
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.cardHeader, { color: c.textFaint }]}>Notes</Text>
          <Text style={[styles.notes, { color: c.text }]}>{dispute.notes}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  title: { fontSize: fontSize.title, fontWeight: "700", flexShrink: 1 },
  subtitle: { marginTop: spacing.xs, fontSize: 13 },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md + 2,
    marginTop: spacing.md,
  },
  cardHeader: {
    fontSize: fontSize.small,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
  },
  amountRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    gap: spacing.md,
  },
  amountLabel: { fontSize: 13, flexShrink: 1 },
  amountValue: { fontSize: 13, fontWeight: "600", textAlign: "right" },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: 10,
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: { color: "#ffffff", fontSize: fontSize.body, fontWeight: "600" },
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
  },
  secondaryButtonText: { fontSize: fontSize.body, fontWeight: "600" },
  offerForm: {
    marginTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.md,
  },
  offerLabel: { fontSize: fontSize.small, fontWeight: "600", marginBottom: spacing.xs },
  offerInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: fontSize.body,
    marginBottom: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
  },
  offerTextarea: { minHeight: 72, textAlignVertical: "top" },
  offerError: { fontSize: fontSize.small, marginBottom: spacing.sm },
  offerButtons: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  offerCancel: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  timelineRow: { flexDirection: "row" },
  timelineRail: { width: 20, alignItems: "center" },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  connector: { width: 2, flex: 1, marginTop: 2 },
  timelineBody: { flex: 1, paddingLeft: 10, paddingBottom: spacing.lg },
  timelineLabel: { fontSize: 13, fontWeight: "600" },
  timelineEvent: { marginTop: 2, fontSize: 12, lineHeight: 17 },
  timelineDate: { marginTop: 2, fontSize: 11 },
  emptyText: { fontSize: 13 },
  docRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  docName: { fontSize: 13, fontWeight: "600" },
  docMeta: { marginTop: 2, fontSize: 12 },
  notes: { fontSize: 13, lineHeight: 19 },
});
