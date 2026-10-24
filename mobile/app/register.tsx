/**
 * Phase13-FA (G10): mobile registration screen (MOBILE-STATIC-ONLY —
 * typecheck-verified; no device/e2e coverage in this wave).
 *
 * Account creation is owned by Keycloak. This screen hands off to the
 * server-side register redirect (/api/auth/register?role=...), which opens
 * the Keycloak registration form (kc_action=register) in an in-app browser.
 * After registering, the user returns here and signs in with SSO.
 */
import React, { useState } from "react";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { API_URL } from "../src/api/trpc";
import { useAuth } from "../src/auth/AuthContext";
import { hapticSelection } from "../src/lib/haptics";
import { fontSize, spacing, useColors, MIN_TOUCH_TARGET } from "../src/theme";

const ROLES = ["provider", "facility", "payer", "biller"] as const;

export default function RegisterScreen() {
  const c = useColors();
  const router = useRouter();
  const { status } = useAuth();
  const params = useLocalSearchParams<{ role?: string }>();
  const [role, setRole] = useState<string>(
    ROLES.includes(params.role as (typeof ROLES)[number]) ? String(params.role) : "provider"
  );
  const [error, setError] = useState<string | null>(null);

  if (status === "authenticated") {
    return <Redirect href="/dashboard" />;
  }

  const openRegistration = async () => {
    setError(null);
    try {
      await WebBrowser.openBrowserAsync(
        `${API_URL}/api/auth/register?role=${encodeURIComponent(role)}`
      );
    } catch (err: any) {
      setError(err?.message ?? "Could not open registration");
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: c.bg }]}>
      <Text style={[styles.title, { color: c.text }]}>Create your account</Text>
      <Text style={[styles.body, { color: c.textMuted }]}>
        Registration is handled by our identity provider (Keycloak SSO).
        Choose your stakeholder role, complete registration in the browser,
        then return and sign in.
      </Text>
      <View style={styles.roleRow}>
        {ROLES.map((r) => (
          <Pressable
            key={r}
            style={[
              styles.roleChip,
              { borderColor: c.textFaint },
              role === r && { backgroundColor: c.primary, borderColor: c.primary },
            ]}
            onPress={() => {
              hapticSelection();
              setRole(r);
            }}
            accessibilityRole="button"
          >
            <Text style={[styles.roleText, role === r && styles.roleTextActive]}>{r}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        style={[styles.button, { backgroundColor: c.primary }]}
        onPress={() => {
          hapticSelection();
          void openRegistration();
        }}
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>Register with SSO</Text>
      </Pressable>
      <Pressable
        style={styles.link}
        onPress={() => router.replace("/login")}
        accessibilityRole="button"
      >
        <Text style={[styles.linkText, { color: c.primary }]}>
          Already have an account? Sign in
        </Text>
      </Pressable>
      {error && <Text style={[styles.error, { color: c.danger }]}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.xl,
  },
  title: { fontSize: fontSize.hero, fontWeight: "700", marginBottom: spacing.lg },
  body: { fontSize: fontSize.body, lineHeight: 20, marginBottom: spacing.lg },
  roleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  roleChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.lg,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: "center",
  },
  roleText: { fontSize: fontSize.body, textTransform: "capitalize" },
  roleTextActive: { color: "#ffffff", fontWeight: "600" },
  button: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 10,
  },
  buttonText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
  link: { marginTop: spacing.xl, alignItems: "center", minHeight: MIN_TOUCH_TARGET, justifyContent: "center" },
  linkText: { fontSize: fontSize.body },
  error: { marginTop: spacing.lg, fontSize: 13, textAlign: "center" },
});
