/**
 * More tab: account (auth.me), organisation details (profiles.get),
 * notification/email-preference summary (emailPrefs.get), security note,
 * app version, and sign-out with confirmation.
 *
 * Sign-out calls trpc.auth.logout server-side first, then clears
 * SecureStore tokens, the offline cache, and the in-memory query cache
 * (see src/auth/AuthContext.tsx signOut).
 */
import React from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../src/auth/AuthContext";
import { useMe, useProfile, useEmailPrefs } from "../../src/api/hooks";
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
  StaleBanner,
} from "../../src/components/Feedback";
import { hapticSelection } from "../../src/lib/haptics";
import { formatDate, humanize } from "../../src/lib/format";
import {
  fontSize,
  spacing,
  useColors,
  MIN_TOUCH_TARGET,
  type Palette,
} from "../../src/theme";

function Field({
  label,
  value,
  c,
}: {
  label: string;
  value: string;
  c: Palette;
}) {
  return (
    <View style={styles.fieldRow}>
      <Text style={[styles.fieldLabel, { color: c.textMuted }]}>{label}</Text>
      <Text style={[styles.fieldValue, { color: c.text }]}>{value}</Text>
    </View>
  );
}

export default function MoreScreen() {
  const c = useColors();
  const { status, signOut } = useAuth();
  const authed = status === "authenticated";
  const me = useMe(authed);
  const profile = useProfile(authed);
  const emailPrefs = useEmailPrefs(authed);

  const isLoading = me.isLoading || profile.isLoading;
  const isError = me.isError && profile.isError;
  const isFromCache = me.isFromCache || profile.isFromCache;

  const confirmSignOut = () => {
    hapticSelection();
    Alert.alert("Sign out", "Cached data on this device will be cleared.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => void signOut(),
      },
    ]);
  };

  const user = me.data;
  const org = profile.data;
  const prefs = emailPrefs.data;
  const version = Constants.expoConfig?.version ?? "1.0.0";

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}
    >
      {isFromCache && (
        <StaleBanner fetchedAtMs={me.dataUpdatedAtMs ?? profile.dataUpdatedAtMs} />
      )}

      {isLoading ? (
        <SkeletonRows count={3} />
      ) : isError ? (
        <ErrorState
          message="Could not load your profile."
          onRetry={() => {
            me.refetch();
            profile.refetch();
          }}
        />
      ) : !user ? (
        <EmptyState
          title="Profile unavailable"
          message="Your identity could not be loaded from the server."
        />
      ) : (
        <>
          <View style={[styles.avatar, { backgroundColor: c.primary }]}>
            <Text style={styles.avatarText}>
              {(user.name ?? user.email ?? "?").charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={[styles.name, { color: c.text }]}>
            {user.name ?? "Unnamed user"}
          </Text>
          {user.email ? (
            <Text style={[styles.email, { color: c.textMuted }]}>{user.email}</Text>
          ) : null}

          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.cardHeader, { color: c.textFaint }]}>Account</Text>
            <Field label="Role" value={humanize(user.role)} c={c} />
            <Field
              label="Sign-in method"
              value={humanize(user.loginMethod ?? "sso")}
              c={c}
            />
            <Field label="Last sign-in" value={formatDate(user.lastSignedIn)} c={c} />
          </View>

          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.cardHeader, { color: c.textFaint }]}>
              Organisation
            </Text>
            <Field label="Organisation" value={org?.orgName ?? "\u2014"} c={c} />
            <Field label="Type" value={humanize(org?.orgType)} c={c} />
            <Field label="Your role" value={humanize(org?.stakeholderRole)} c={c} />
            <Field label="NPI" value={org?.npi ?? "\u2014"} c={c} />
          </View>

          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.cardHeader, { color: c.textFaint }]}>
              Notifications
            </Text>
            <Field
              label="Email digest"
              value={
                prefs?.digestFrequency ? humanize(prefs.digestFrequency) : "\u2014"
              }
              c={c}
            />
            <Field
              label="Deadline emails"
              value={
                prefs ? (prefs.notifyOnDeadlineApproach ? "On" : "Off") : "\u2014"
              }
              c={c}
            />
            <Text style={[styles.note, { color: c.textFaint }]}>
              Email preferences are managed on the web portal. Push
              notifications are enabled automatically on this device.
            </Text>
          </View>

          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.cardHeader, { color: c.textFaint }]}>About</Text>
            <Field label="App version" value={version} c={c} />
            <Field label="Security" value="OIDC PKCE \u00b7 biometric lock" c={c} />
          </View>

          <Pressable
            style={[
              styles.signOutButton,
              { borderColor: c.danger, backgroundColor: c.dangerSoft },
            ]}
            onPress={confirmSignOut}
            accessibilityRole="button"
          >
            <Ionicons name="log-out-outline" size={18} color={c.danger} />
            <Text style={[styles.signOutText, { color: c.danger }]}>Sign out</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignSelf: "center",
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.md,
  },
  avatarText: { color: "#ffffff", fontSize: 26, fontWeight: "700" },
  name: {
    marginTop: spacing.sm + 2,
    fontSize: fontSize.title,
    fontWeight: "700",
    textAlign: "center",
  },
  email: { marginTop: 2, fontSize: fontSize.body, textAlign: "center" },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md + 2,
    marginTop: spacing.lg,
  },
  cardHeader: {
    fontSize: fontSize.small,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  fieldRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
  },
  fieldLabel: { fontSize: 13 },
  fieldValue: { fontSize: 13, maxWidth: "60%", textAlign: "right" },
  note: { marginTop: spacing.sm, fontSize: fontSize.small, lineHeight: 17 },
  signOutButton: {
    marginTop: spacing.xl,
    marginBottom: spacing.xxl,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: 10,
    borderWidth: 1,
  },
  signOutText: { fontSize: 15, fontWeight: "600" },
});
