import React from "react";
import { Redirect } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../src/auth/AuthContext";
import { colors } from "../src/theme";

export default function LoginScreen() {
  const { status, ready, error, signIn } = useAuth();

  if (status === "authenticated") {
    return <Redirect href="/disputes" />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.logoMark}>
        <Text style={styles.logoText}>HP</Text>
      </View>
      <Text style={styles.title}>HealthPoint IDR</Text>
      <Text style={styles.subtitle}>
        No Surprises Act — Independent Dispute Resolution{"\n"}mobile companion
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
        <Text style={styles.hint}>Connecting to identity provider\u2026</Text>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      <Text style={styles.footNote}>
        Secured with Keycloak OIDC (PKCE). Biometric lock protects your session
        on re-entry.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: colors.bg,
  },
  logoMark: {
    width: 72,
    height: 72,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: { color: colors.white, fontSize: 28, fontWeight: "700" },
  title: { marginTop: 18, fontSize: 28, fontWeight: "700", color: colors.text },
  subtitle: {
    marginTop: 8,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 20,
  },
  button: {
    marginTop: 32,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 10,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: "600" },
  hint: { marginTop: 12, fontSize: 12, color: colors.textFaint },
  error: {
    marginTop: 16,
    fontSize: 13,
    color: colors.danger,
    textAlign: "center",
  },
  footNote: {
    marginTop: 40,
    fontSize: 12,
    color: colors.textFaint,
    textAlign: "center",
    lineHeight: 17,
  },
});
