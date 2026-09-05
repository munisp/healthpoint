/**
 * Profile tab: identity (auth.me), organisation details (profiles.get),
 * app version, and sign-out with confirmation.
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
import { useAuth } from "../../src/auth/AuthContext";
import { useMe, useProfile } from "../../src/api/hooks";
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
  StaleBanner,
} from "../../src/components/Feedback";
import { formatDate, humanize } from "../../src/lib/format";
import { colors } from "../../src/theme";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const { status, signOut } = useAuth();
  const authed = status === "authenticated";
  const me = useMe(authed);
  const profile = useProfile(authed);

  const isLoading = (me.isLoading && profile.isLoading) || me.isLoading;
  const isError = me.isError && profile.isError;
  const isFromCache = me.isFromCache || profile.isFromCache;

  const confirmSignOut = () => {
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
  const version = Constants.expoConfig?.version ?? "1.0.0";

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
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
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(user.name ?? user.email ?? "?").charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.name}>{user.name ?? "Unnamed user"}</Text>
          {user.email ? <Text style={styles.email}>{user.email}</Text> : null}

          <View style={styles.card}>
            <Text style={styles.cardHeader}>Account</Text>
            <Field label="Role" value={humanize(user.role)} />
            <Field
              label="Sign-in method"
              value={humanize(user.loginMethod ?? "sso")}
            />
            <Field label="Last sign-in" value={formatDate(user.lastSignedIn)} />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardHeader}>Organisation</Text>
            <Field label="Organisation" value={org?.orgName ?? "\u2014"} />
            <Field label="Type" value={humanize(org?.orgType)} />
            <Field label="Your role" value={humanize(org?.stakeholderRole)} />
            <Field label="NPI" value={org?.npi ?? "\u2014"} />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardHeader}>About</Text>
            <Field label="App version" value={version} />
            <Field label="Security" value="OIDC PKCE \u00b7 biometric lock" />
          </View>

          <Pressable style={styles.signOutButton} onPress={confirmSignOut}>
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  avatar: {
    alignSelf: "center",
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  avatarText: { color: colors.white, fontSize: 26, fontWeight: "700" },
  name: {
    marginTop: 10,
    fontSize: 20,
    fontWeight: "700",
    color: colors.text,
    textAlign: "center",
  },
  email: {
    marginTop: 2,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
  },
  cardHeader: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textFaint,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  fieldRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  fieldLabel: { fontSize: 13, color: colors.textMuted },
  fieldValue: {
    fontSize: 13,
    color: colors.text,
    maxWidth: "60%",
    textAlign: "right",
  },
  signOutButton: {
    marginTop: 24,
    marginBottom: 32,
    alignItems: "center",
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#fecaca", // red-200
    backgroundColor: "#fef2f2", // red-50
  },
  signOutText: { color: colors.danger, fontSize: 15, fontWeight: "600" },
});
