import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { notificationTones, statusTones, toneFor } from "../theme";
import { humanize } from "../lib/format";

interface BadgeProps {
  value: string;
  tones: Record<string, { bg: string; text: string }>;
}

function Badge({ value, tones }: BadgeProps) {
  const tone = toneFor(tones, value);
  return (
    <View style={[styles.badge, { backgroundColor: tone.bg }]}>
      <Text style={[styles.text, { color: tone.text }]}>{humanize(value)}</Text>
    </View>
  );
}

/**
 * Muted green/amber/red-family status pill, mirroring the web palette.
 * Memoized: badges render inside FlatList rows, so skipping re-renders when
 * the status string is unchanged keeps row reconciliation cheap.
 */
export const StatusBadge = React.memo(function StatusBadge({
  status,
}: {
  status: string;
}) {
  return <Badge value={status} tones={statusTones} />;
});

/** Pill for notification types (deadline_warning, determination_issued…). */
export const NotificationTypeBadge = React.memo(function NotificationTypeBadge({
  type,
}: {
  type: string;
}) {
  return <Badge value={type} tones={notificationTones} />;
});

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  text: { fontSize: 11, fontWeight: "600" },
});
