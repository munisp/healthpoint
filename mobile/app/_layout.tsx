import React, { useEffect } from "react";
import { Stack, useRouter } from "expo-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { AuthProvider } from "../src/auth/AuthContext";
import { BiometricGate } from "../src/auth/BiometricGate";
import { queryClient } from "../src/api/queryClient";
import {
  configureNotificationHandler,
  disputeIdFromResponse,
} from "../src/notifications/push";
import { colors } from "../src/theme";

/**
 * Taps on push notifications carrying `data.disputeId` deep-link straight
 * into the dispute detail screen. Handles both cold start
 * (getLastNotificationResponseAsync) and warm taps (listener).
 */
function useNotificationDeepLinks(): void {
  const router = useRouter();
  useEffect(() => {
    configureNotificationHandler();
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      const id = response ? disputeIdFromResponse(response) : null;
      if (id) router.push(`/dispute/${id}`);
    });
    const sub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const id = disputeIdFromResponse(response);
        if (id) router.push(`/dispute/${id}`);
      }
    );
    return () => sub.remove();
  }, [router]);
}

function RootStack() {
  useNotificationDeepLinks();
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.bg },
        headerStyle: { backgroundColor: colors.card },
        headerTitleStyle: { color: colors.text },
        headerTintColor: colors.primary,
        headerBackTitle: "Back",
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="dispute/[id]" options={{ title: "Dispute" }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BiometricGate>
          <StatusBar style="dark" />
          <RootStack />
        </BiometricGate>
      </AuthProvider>
    </QueryClientProvider>
  );
}
