/**
 * Phase13-FA (G10): mobile MFA enroll + verify screen (MOBILE-STATIC-ONLY —
 * typecheck-verified; no device/e2e coverage in this wave).
 *
 * Mirrors the web /mfa page (client TwoFactorAuth.tsx) using the existing
 * server endpoints:
 *   verify mode: auth.verifyLoginTotp    — second stage of two-stage login
 *   enroll mode: totp.generateSecret → totp.setup → totp.verify
 *
 * Route: /mfa?mode=enroll|verify
 */
import React, { useState } from "react";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { trpc } from "../src/api/trpc";
import { useAuth } from "../src/auth/AuthContext";
import { hapticSelection } from "../src/lib/haptics";
import { fontSize, spacing, useColors, MIN_TOUCH_TARGET } from "../src/theme";

export default function MfaScreen() {
  const c = useColors();
  const router = useRouter();
  const { status } = useAuth();
  const params = useLocalSearchParams<{ mode?: string }>();
  const mode = params.mode === "enroll" ? "enroll" : "verify";

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // enroll flow state
  const [secret, setSecret] = useState<string | null>(null);
  const [otpAuthUrl, setOtpAuthUrl] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [done, setDone] = useState(false);

  if (status === "unauthenticated") {
    return <Redirect href="/login" />;
  }

  const startEnrollment = async () => {
    setBusy(true);
    setError(null);
    try {
      const gen = await trpc.totp.generateSecret.mutate({ appName: "HealthPoint IDR" });
      const setup = await trpc.totp.setup.mutate({ secret: gen.secret });
      setSecret(gen.secret as string);
      setOtpAuthUrl((gen.otpAuthUrl as string) ?? null);
      setBackupCodes((setup.backupCodes as string[]) ?? []);
    } catch (err: any) {
      setError(err?.message ?? "Failed to start MFA enrollment");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (code.trim().length < 6) {
      setError("Enter the 6-digit code from your authenticator app");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "enroll") {
        await trpc.totp.verify.mutate({ code: code.trim() });
      } else {
        await trpc.auth.verifyLoginTotp.mutate({ code: code.trim() });
      }
      setDone(true);
      router.replace("/dashboard");
    } catch (err: any) {
      setError(err?.message ?? "Invalid code — please try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: c.bg }]}>
      <Text style={[styles.title, { color: c.text }]}>
        {mode === "enroll" ? "Set up two-factor authentication" : "Two-factor verification"}
      </Text>

      {mode === "enroll" && !secret && (
        <>
          <Text style={[styles.body, { color: c.textMuted }]}>
            Your organization requires multi-factor authentication. Add
            HealthPoint IDR to your authenticator app to continue.
          </Text>
          <Pressable
            style={[styles.button, { backgroundColor: c.primary }, busy && styles.buttonDisabled]}
            disabled={busy}
            onPress={() => {
              hapticSelection();
              void startEnrollment();
            }}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>{busy ? "Preparing…" : "Begin setup"}</Text>
          </Pressable>
        </>
      )}

      {(mode === "verify" || secret) && !done && (
        <>
          {secret ? (
            <View style={[styles.secretBox, { borderColor: c.textFaint }]}>
              <Text style={[styles.body, { color: c.textMuted }]}>
                Add this key to your authenticator app:
              </Text>
              <Text style={[styles.secret, { color: c.text }]} selectable>
                {secret}
              </Text>
              {otpAuthUrl ? (
                <Text style={[styles.hint, { color: c.textFaint }]} selectable>
                  {otpAuthUrl}
                </Text>
              ) : null}
            </View>
          ) : (
            <Text style={[styles.body, { color: c.textMuted }]}>
              Enter the 6-digit code from your authenticator app (or a backup
              code) to finish signing in.
            </Text>
          )}
          <TextInput
            style={[styles.input, { borderColor: c.textFaint, color: c.text }]}
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            placeholderTextColor={c.textFaint}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            maxLength={16}
            accessibilityLabel="One-time code"
          />
          <Pressable
            style={[styles.button, { backgroundColor: c.primary }, busy && styles.buttonDisabled]}
            disabled={busy}
            onPress={() => {
              hapticSelection();
              void submit();
            }}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.buttonText}>{mode === "enroll" ? "Activate" : "Verify"}</Text>
            )}
          </Pressable>
        </>
      )}

      {backupCodes && !done && (
        <View style={[styles.secretBox, { borderColor: c.textFaint }]}>
          <Text style={[styles.body, { color: c.textMuted }]}>
            Save these single-use backup codes somewhere safe:
          </Text>
          {backupCodes.map((b) => (
            <Text key={b} style={[styles.hint, { color: c.text }]} selectable>
              {b}
            </Text>
          ))}
        </View>
      )}

      {done && (
        <Text style={[styles.body, { color: c.text }]}>Two-factor authentication complete.</Text>
      )}
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
  body: { fontSize: fontSize.body, lineHeight: 20, marginBottom: spacing.md },
  hint: { fontSize: fontSize.small, marginTop: spacing.xs },
  secretBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  secret: {
    fontSize: fontSize.body,
    fontWeight: "700",
    letterSpacing: 1,
    marginVertical: spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.body,
    marginBottom: spacing.md,
  },
  button: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 10,
    paddingHorizontal: spacing.xxl,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
  error: { marginTop: spacing.lg, fontSize: 13, textAlign: "center" },
});
