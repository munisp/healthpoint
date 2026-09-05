/**
 * Biometric re-entry gate.
 *
 * When the app returns from background, an authenticated user must unlock
 * with biometrics (Face ID / Touch ID / fingerprint). The OS passcode is an
 * automatic fallback (`disableDeviceFallback: false`). Devices without
 * enrolled biometrics are never locked (graceful degradation).
 *
 * Deliberately NOT gated: the first transition to "authenticated" after a
 * fresh SSO sign-in (the user just proved possession via Keycloak MFA).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { useAuth } from "./AuthContext";
import { colors } from "../theme";

export function BiometricGate({ children }: { children: React.ReactNode }) {
  const { status, signOut } = useAuth();
  const [supported, setSupported] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appState = useRef(AppState.currentState);

  // Capability probe: hardware present AND at least one biometric enrolled.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const enrolled = hasHardware
          ? await LocalAuthentication.isEnrolledAsync()
          : false;
        if (mounted) setSupported(enrolled);
      } catch {
        if (mounted) setSupported(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Lock on background → active while authenticated.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      const wasBackground = appState.current.match(/inactive|background/);
      appState.current = next;
      if (
        next === "active" &&
        wasBackground &&
        supported &&
        status === "authenticated"
      ) {
        setLocked(true);
      }
    });
    return () => sub.remove();
  }, [supported, status]);

  const unlock = useCallback(async () => {
    setError(null);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock HealthPoint IDR",
        cancelLabel: "Cancel",
        disableDeviceFallback: false, // OS offers device passcode on failure
      });
      if (result.success) {
        setLocked(false);
      } else if (result.error !== "user_cancel") {
        setError("Unlock failed — try again.");
      }
    } catch {
      setError("Biometric unlock is unavailable on this device.");
    }
  }, []);

  // Prompt as soon as the lock engages.
  useEffect(() => {
    if (locked) void unlock();
  }, [locked, unlock]);

  if (!locked || status !== "authenticated") {
    return <>{children}</>;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>HealthPoint IDR</Text>
      <Text style={styles.subtitle}>
        Locked to protect patient and claims information
      </Text>
      <Pressable style={styles.button} onPress={() => void unlock()}>
        <Text style={styles.buttonText}>Unlock</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable onPress={() => void signOut()}>
        <Text style={styles.signOut}>Sign out instead</Text>
      </Pressable>
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
  title: { fontSize: 24, fontWeight: "700", color: colors.primary },
  subtitle: {
    marginTop: 8,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
  },
  button: {
    marginTop: 28,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 40,
    borderRadius: 10,
  },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: "600" },
  error: { marginTop: 14, fontSize: 13, color: colors.danger },
  signOut: { marginTop: 20, fontSize: 14, color: colors.textMuted },
});
