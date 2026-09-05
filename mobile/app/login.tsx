import React from "react";
import { Redirect } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../src/auth/AuthContext";

export default function LoginScreen() {
  const { status, ready, error, signIn } = useAuth();

  if (status === "authenticated") {
    return <Redirect href="/disputes" />;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>HealthPoint IDR</Text>
      <Text style={styles.subtitle}>
        NSA Independent Dispute Resolution — mobile companion
      </Text>
      <Pressable
        style={[styles.button, !ready && styles.buttonDisabled]}
        disabled={!ready}
        onPress={() => {
          void signIn();
        }}
      >
        <Text style={styles.buttonText}>Sign in with SSO</Text>
      </Pressable>
      {!ready && (
        <Text style={styles.hint}>Connecting to identity provider…</Text>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#ffffff",
  },
  title: { fontSize: 28, fontWeight: "700", color: "#2563eb" },
  subtitle: {
    marginTop: 8,
    fontSize: 14,
    color: "#4b5563",
    textAlign: "center",
  },
  button: {
    marginTop: 32,
    backgroundColor: "#2563eb",
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 8,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
  hint: { marginTop: 12, fontSize: 12, color: "#9ca3af" },
  error: { marginTop: 16, fontSize: 13, color: "#dc2626", textAlign: "center" },
});
