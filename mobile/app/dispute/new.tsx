/**
 * W7-1 mobile parity: dispute creation flow.
 *
 * Mirrors the web NewDispute form's required fields against
 * createDisputeSchema (server/routers.ts): party info, service details,
 * CPT codes, and billed amount. On success routes to the new dispute's
 * detail screen. All validation errors from the server (cooling-off screen,
 * participating-provider ineligibility, amount regex) surface inline.
 */
import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useCreateDispute, type CreateDisputeInput } from "../../src/api/hooks";
import { fontSize, spacing, useColors, MIN_TOUCH_TARGET } from "../../src/theme";

const SERVICE_TYPES: CreateDisputeInput["serviceType"][] = [
  "emergency_medicine",
  "anesthesiology",
  "pathology",
  "radiology",
  "neonatology",
  "assistant_surgeon",
  "hospitalist",
  "intensivist",
  "air_ambulance",
  "ground_ambulance",
  "other",
];

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;
const STATE_RE = /^[A-Za-z]{2}$/;

export default function NewDisputeScreen() {
  const c = useColors();
  const router = useRouter();
  const create = useCreateDispute();

  const [initiatingName, setInitiatingName] = useState("");
  const [respondingName, setRespondingName] = useState("");
  const [serviceType, setServiceType] =
    useState<CreateDisputeInput["serviceType"]>("emergency_medicine");
  const [serviceDate, setServiceDate] = useState(""); // YYYY-MM-DD
  const [patientState, setPatientState] = useState("");
  const [facilityState, setFacilityState] = useState("");
  const [cptCodes, setCptCodes] = useState("");
  const [billedAmount, setBilledAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  function validate(): string | null {
    if (!initiatingName.trim()) return "Provider/facility name is required.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate.trim()))
      return "Service date must be YYYY-MM-DD.";
    if (!STATE_RE.test(patientState.trim()))
      return "Patient state must be a 2-letter code.";
    if (!STATE_RE.test(facilityState.trim()))
      return "Facility state must be a 2-letter code.";
    if (!cptCodes.split(",").map(s => s.trim()).filter(Boolean).length)
      return "At least one CPT code is required.";
    if (!AMOUNT_RE.test(billedAmount.trim()))
      return "Billed amount must be a positive dollar amount (e.g. 1234.56).";
    return null;
  }

  function submit(): void {
    const err = validate();
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    const input: CreateDisputeInput = {
      initiatingPartyType: "provider",
      initiatingPartyName: initiatingName.trim(),
      ...(respondingName.trim()
        ? { respondingPartyType: "payer" as const, respondingPartyName: respondingName.trim() }
        : {}),
      serviceType,
      serviceDate: new Date(`${serviceDate.trim()}T00:00:00.000Z`).toISOString(),
      patientState: patientState.trim().toUpperCase(),
      facilityState: facilityState.trim().toUpperCase(),
      cptCodes: cptCodes.split(",").map(s => s.trim()).filter(Boolean),
      billedAmount: billedAmount.trim(),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    create.mutate(input, {
      onSuccess: (result) => {
        const id = (result as { id?: string })?.id;
        if (id) router.replace(`/dispute/${id}`);
        else router.back();
      },
      onError: (e) =>
        setFormError(e instanceof Error ? e.message : "Failed to create dispute."),
    });
  }

  const fieldStyle = [
    styles.input,
    { backgroundColor: c.card, borderColor: c.border, color: c.text },
  ];

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: c.bg }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.label, { color: c.textMuted }]}>Provider / facility name *</Text>
        <TextInput
          style={fieldStyle}
          value={initiatingName}
          onChangeText={setInitiatingName}
          placeholder="e.g. Georgetown Emergency Physicians"
          placeholderTextColor={c.textFaint}
          accessibilityLabel="Provider or facility name"
        />

        <Text style={[styles.label, { color: c.textMuted }]}>Health plan (payer) name</Text>
        <TextInput
          style={fieldStyle}
          value={respondingName}
          onChangeText={setRespondingName}
          placeholder="Optional"
          placeholderTextColor={c.textFaint}
          accessibilityLabel="Health plan name"
        />

        <Text style={[styles.label, { color: c.textMuted }]}>Service type *</Text>
        <View style={styles.chipsWrap}>
          {SERVICE_TYPES.map((t) => {
            const active = serviceType === t;
            return (
              <Pressable
                key={t}
                onPress={() => setServiceType(t)}
                style={[
                  styles.chip,
                  { borderColor: active ? c.primary : c.border },
                  { backgroundColor: active ? c.primarySoft : c.card },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={{ color: active ? c.primary : c.textMuted, fontSize: fontSize.small }}>
                  {t.replace(/_/g, " ")}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.label, { color: c.textMuted }]}>Service date (YYYY-MM-DD) *</Text>
        <TextInput
          style={fieldStyle}
          value={serviceDate}
          onChangeText={setServiceDate}
          placeholder="2026-08-15"
          placeholderTextColor={c.textFaint}
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
          accessibilityLabel="Service date, year month day"
        />

        <View style={styles.row}>
          <View style={styles.rowItem}>
            <Text style={[styles.label, { color: c.textMuted }]}>Patient state *</Text>
            <TextInput
              style={fieldStyle}
              value={patientState}
              onChangeText={setPatientState}
              placeholder="TX"
              placeholderTextColor={c.textFaint}
              autoCapitalize="characters"
              maxLength={2}
              accessibilityLabel="Patient state, two letters"
            />
          </View>
          <View style={styles.rowItem}>
            <Text style={[styles.label, { color: c.textMuted }]}>Facility state *</Text>
            <TextInput
              style={fieldStyle}
              value={facilityState}
              onChangeText={setFacilityState}
              placeholder="TX"
              placeholderTextColor={c.textFaint}
              autoCapitalize="characters"
              maxLength={2}
              accessibilityLabel="Facility state, two letters"
            />
          </View>
        </View>

        <Text style={[styles.label, { color: c.textMuted }]}>CPT codes (comma separated) *</Text>
        <TextInput
          style={fieldStyle}
          value={cptCodes}
          onChangeText={setCptCodes}
          placeholder="99285, 99291"
          placeholderTextColor={c.textFaint}
          autoCapitalize="none"
          accessibilityLabel="CPT codes, comma separated"
        />

        <Text style={[styles.label, { color: c.textMuted }]}>Billed amount (USD) *</Text>
        <TextInput
          style={fieldStyle}
          value={billedAmount}
          onChangeText={setBilledAmount}
          placeholder="1234.56"
          placeholderTextColor={c.textFaint}
          keyboardType="decimal-pad"
          accessibilityLabel="Billed amount in dollars"
        />

        <Text style={[styles.label, { color: c.textMuted }]}>Notes</Text>
        <TextInput
          style={[...fieldStyle, styles.textarea]}
          value={notes}
          onChangeText={setNotes}
          placeholder="Optional context for the dispute"
          placeholderTextColor={c.textFaint}
          multiline
          accessibilityLabel="Notes"
        />

        {formError && (
          <Text style={[styles.error, { color: c.danger }]} accessibilityRole="alert">
            {formError}
          </Text>
        )}

        <Pressable
          onPress={submit}
          disabled={create.isPending}
          style={[
            styles.submit,
            { backgroundColor: c.primary, opacity: create.isPending ? 0.6 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Create dispute"
        >
          <Text style={styles.submitText}>
            {create.isPending ? "Creating…" : "Create dispute"}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  label: { fontSize: fontSize.small, marginBottom: spacing.xs, marginTop: spacing.md },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.body,
  },
  textarea: { minHeight: 80, textAlignVertical: "top" },
  row: { flexDirection: "row", gap: spacing.md },
  rowItem: { flex: 1 },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minHeight: MIN_TOUCH_TARGET / 2,
    justifyContent: "center",
  },
  error: { marginTop: spacing.md, fontSize: fontSize.small },
  submit: {
    marginTop: spacing.lg,
    borderRadius: 12,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: { color: "#ffffff", fontSize: fontSize.body, fontWeight: "600" },
});
