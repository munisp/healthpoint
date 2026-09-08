/**
 * Shared list/screen feedback states: skeleton loading, empty, error+retry,
 * and the offline staleness banner. All are dark-mode aware via useColors().
 */
import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { fontSize, spacing, useColors, MIN_TOUCH_TARGET } from "../theme";
import { timeAgo } from "../lib/format";

/** Animated placeholder rows shown while a list loads for the first time. */
export function SkeletonRows({ count = 5 }: { count?: number }) {
  const c = useColors();
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 700,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <View style={styles.skeletonWrap}>
      {Array.from({ length: count }).map((_, i) => (
        <Animated.View
          key={i}
          style={[
            styles.skeletonRow,
            { opacity, backgroundColor: c.card, borderColor: c.border },
          ]}
        >
          <View style={[styles.skeletonLineWide, { backgroundColor: c.border }]} />
          <View style={[styles.skeletonLineNarrow, { backgroundColor: c.border }]} />
        </Animated.View>
      ))}
    </View>
  );
}

export function EmptyState({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  const c = useColors();
  return (
    <View style={styles.center}>
      <Text style={[styles.emptyTitle, { color: c.text }]}>{title}</Text>
      <Text style={[styles.emptyMessage, { color: c.textMuted }]}>{message}</Text>
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const c = useColors();
  return (
    <View style={styles.center}>
      <Text style={[styles.errorTitle, { color: c.text }]}>Something went wrong</Text>
      <Text style={[styles.errorMessage, { color: c.danger }]}>{message}</Text>
      <Pressable
        style={[styles.retryButton, { backgroundColor: c.primary }]}
        onPress={onRetry}
        accessibilityRole="button"
      >
        <Text style={styles.retryText}>Retry</Text>
      </Pressable>
    </View>
  );
}

/** Banner shown when rendering cached data after a failed fetch. */
export function StaleBanner({ fetchedAtMs }: { fetchedAtMs: number | null }) {
  const c = useColors();
  return (
    <View style={[styles.staleBanner, { backgroundColor: c.warningSoft }]}>
      <Text style={[styles.staleText, { color: c.warning }]}>
        Offline — showing cached data
        {fetchedAtMs ? ` from ${timeAgo(fetchedAtMs)}` : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  skeletonWrap: { padding: spacing.lg },
  skeletonRow: {
    borderRadius: 10,
    borderWidth: 1,
    padding: spacing.md + 2,
    marginBottom: 10,
  },
  skeletonLineWide: { height: 12, borderRadius: 6, width: "70%" },
  skeletonLineNarrow: { marginTop: 8, height: 10, borderRadius: 5, width: "40%" },
  center: {
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xxl,
    flexGrow: 1,
  },
  emptyTitle: { fontSize: 16, fontWeight: "600" },
  emptyMessage: { marginTop: 6, fontSize: 13, textAlign: "center" },
  errorTitle: { fontSize: 16, fontWeight: "600" },
  errorMessage: { marginTop: 6, fontSize: 13, textAlign: "center" },
  retryButton: {
    marginTop: spacing.lg,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: "center",
    paddingHorizontal: 28,
    borderRadius: 8,
  },
  retryText: { color: "#ffffff", fontSize: fontSize.body, fontWeight: "600" },
  staleBanner: {
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
  },
  staleText: { fontSize: fontSize.small, textAlign: "center" },
});
