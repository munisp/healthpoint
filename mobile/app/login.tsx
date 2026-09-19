import React from "react";
import { Redirect } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../src/auth/AuthContext";
import { hapticSelection } from "../src/lib/haptics";
import { fontSize, spacing, useColors, MIN_TOUCH_TARGET } from "../src/theme";

export default function LoginScreen() {
  const c = useColors();
  const { status, ready, error, signIn } = useAuth();

  if (status === "authenticated") {
    return <Redirect href="/dashboard" />;
  }

  return (
    <View style={[styles.container, { backgroundColor: c.bg }]}>
      <View style={[styles.logoMark, { backgroundColor: c.primary }]}>
        <Text style={styles.logoText}>HP</Text>
      </View>
      <Text style={[styles.title, { color: c.text }]}>HealthPoint IDR</Text>
      <Text style={[styles.subtitle, { color: c.textMuted }]}>
        No Surprises Act — Independent Dispute Resolution{"\n"}mobile companion
      </Text>
      <Pressable
        style={[
          styles.button,
          { backgroundColor: c.primary },
          !ready && styles.buttonDisabled,
        ]}
        disabled={!ready}
        onPress={() => {
          hapticSelection();
          void signIn();
        }}
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>Sign in with SSO</Text>
      </Pressable>
      {!ready && (
        <Text style={[styles.hint, { color: c.textFaint }]}>
          {"Connecting to identity provider\u2026"}
        </Text>
      )}
      {error && (
        <Text style={[styles.error, { color: c.danger }]}>{error}</Text>
      )}
      <Text style={[styles.footNote, { color: c.textFaint }]}>
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
    padding: spacing.xl,
  },
  logoMark: {
    width: 72,
    height: 72,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: { color: "#ffffff", fontSize: fontSize.hero, fontWeight: "700" },
  title: { marginTop: 18, fontSize: fontSize.hero, fontWeight: "700" },
  subtitle: {
    marginTop: spacing.sm,
    fontSize: fontSize.body,
    textAlign: "center",
    lineHeight: 20,
  },
  button: {
    marginTop: spacing.xxl,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: "center",
    paddingHorizontal: spacing.xxl,
    borderRadius: 10,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
  hint: { marginTop: spacing.md, fontSize: fontSize.small },
  error: { marginTop: spacing.lg, fontSize: 13, textAlign: "center" },
  footNote: {
    marginTop: 40,
    fontSize: fontSize.small,
    textAlign: "center",
    lineHeight: 17,
  },
});
