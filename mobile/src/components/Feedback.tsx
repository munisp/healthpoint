/**
 * Shared list/screen feedback states: skeleton loading, empty, error+retry,
 * and the offline staleness banner.
 */
import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";
import { timeAgo } from "../lib/format";

/** Animated placeholder rows shown while a list loads for the first time. */
export function SkeletonRows({ count = 5 }: { count?: number }) {
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
        <Animated.View key={i} style={[styles.skeletonRow, { opacity }]}>
          <View style={styles.skeletonLineWide} />
          <View style={styles.skeletonLineNarrow} />
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
  return (
    <View style={styles.center}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
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
  return (
    <View style={styles.center}>
      <Text style={styles.errorTitle}>Something went wrong</Text>
      <Text style={styles.errorMessage}>{message}</Text>
      <Pressable style={styles.retryButton} onPress={onRetry}>
        <Text style={styles.retryText}>Retry</Text>
      </Pressable>
    </View>
  );
}

/** Banner shown when rendering AsyncStorage data after a failed fetch. */
export function StaleBanner({ fetchedAtMs }: { fetchedAtMs: number | null }) {
  return (
    <View style={styles.staleBanner}>
      <Text style={styles.staleText}>
        Offline — showing cached data
        {fetchedAtMs ? ` from ${timeAgo(fetchedAtMs)}` : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  skeletonWrap: { padding: 16 },
  skeletonRow: {
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 10,
  },
  skeletonLineWide: {
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.border,
    width: "70%",
  },
  skeletonLineNarrow: {
    marginTop: 8,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.border,
    width: "40%",
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    flexGrow: 1,
  },
  emptyTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  emptyMessage: {
    marginTop: 6,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: "center",
  },
  errorTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  errorMessage: {
    marginTop: 6,
    fontSize: 13,
    color: colors.danger,
    textAlign: "center",
  },
  retryButton: {
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 28,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  retryText: { color: colors.white, fontSize: 14, fontWeight: "600" },
  staleBanner: {
    backgroundColor: "#fef3c7", // amber-100
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  staleText: { fontSize: 12, color: "#b45309", textAlign: "center" }, // amber-700
});
