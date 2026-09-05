import React from "react";
import { Stack } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "../src/auth/AuthContext";

const queryClient = new QueryClient();

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Stack>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen
            name="login"
            options={{ title: "Sign in", headerShown: false }}
          />
          <Stack.Screen name="disputes/index" options={{ title: "Disputes" }} />
          <Stack.Screen name="disputes/[id]" options={{ title: "Dispute" }} />
        </Stack>
      </AuthProvider>
    </QueryClientProvider>
  );
}
