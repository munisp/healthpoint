import React, { useEffect } from "react";
import { Stack, useRouter } from "expo-router";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import * as Notifications from "expo-notifications";
import { AuthProvider } from "../src/auth/AuthContext";
import { BiometricGate } from "../src/auth/BiometricGate";
import { queryClient } from "../src/api/queryClient";
import {
  asyncStoragePersister,
  PERSIST_BUSTER,
  PERSIST_MAX_AGE,
} from "../src/api/persister";
import {
  configureNotificationHandler,
  disputeIdFromResponse,
} from "../src/notifications/push";
import { useColors } from "../src/theme";

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
  const c = useColors();
  useNotificationDeepLinks();
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: c.bg },
        headerStyle: { backgroundColor: c.card },
        headerTitleStyle: { color: c.text },
        headerTintColor: c.primary,
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
  const scheme = useColorScheme();
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: asyncStoragePersister,
        maxAge: PERSIST_MAX_AGE,
        buster: PERSIST_BUSTER,
        dehydrateOptions: {
          // Read-only cache: only successful queries are persisted, never
          // mutations — offline writes are not supported by the server API.
          shouldDehydrateQuery: (query) => query.state.status === "success",
        },
      }}
    >
      <AuthProvider>
        <BiometricGate>
          <StatusBar style={scheme === "dark" ? "light" : "dark"} />
          <RootStack />
        </BiometricGate>
      </AuthProvider>
    </PersistQueryClientProvider>
  );
}
