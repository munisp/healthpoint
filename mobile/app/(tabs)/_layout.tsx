/**
 * Authenticated tab shell: Disputes, Alerts, Profile.
 *
 * Acts as the auth gate — unauthenticated users are redirected to /login
 * (covers both fresh launches and 401-driven session teardown).
 */
import React, { useEffect } from "react";
import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../src/auth/AuthContext";
import { useNotifications } from "../../src/api/hooks";
import { registerForPushNotifications } from "../../src/notifications/push";
import { colors } from "../../src/theme";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

function tabIcon(name: IconName) {
  return function TabIcon({ color, size }: { color: string; size: number }) {
    return <Ionicons name={name} color={color} size={size} />;
  };
}

export default function TabsLayout() {
  const { status, getAccessToken } = useAuth();
  // Unread count powers the tab badge; react-query dedupes this with the
  // notifications screen's own query.
  const unread = useNotifications(true);

  // Register for push once authenticated (no-op on simulators / until the
  // server token endpoint exists — see src/notifications/push.ts).
  useEffect(() => {
    if (status === "authenticated") {
      void registerForPushNotifications(getAccessToken);
    }
  }, [status, getAccessToken]);

  if (status === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (status === "unauthenticated") {
    return <Redirect href="/login" />;
  }

  const unreadCount = unread.data?.length ?? 0;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        headerStyle: { backgroundColor: colors.card },
        headerTitleStyle: { color: colors.text },
        headerTintColor: colors.primary,
      }}
    >
      <Tabs.Screen
        name="disputes"
        options={{
          title: "Disputes",
          tabBarIcon: tabIcon("document-text-outline"),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: "Alerts",
          tabBarIcon: tabIcon("notifications-outline"),
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: tabIcon("person-circle-outline"),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
});
