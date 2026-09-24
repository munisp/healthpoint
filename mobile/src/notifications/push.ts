/**
 * Push-notification registration + tap handling.
 *
 * W7-1 update: the server now exposes
 * pushSubscriptions.registerExpoToken (server/routers/push-subscriptions.ts,
 * migration 0043 expo_push_tokens table). Registration therefore:
 *   1. requests OS permission,
 *   2. creates the Android channel,
 *   3. obtains the Expo push token locally,
 *   4. persists it to AsyncStorage (hp.pushToken.v1) as an offline fallback,
 *   5. registers it with the server over the authenticated tRPC client
 *      (best effort — failures leave the local copy for next launch).
 *
 * Notification taps deep-link into the app: payloads carrying
 * `data.disputeId` route to /dispute/[id] (see app/_layout.tsx).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { trpc } from "../api/trpc";

/** AsyncStorage key holding the last obtained Expo push token. */
const PUSH_TOKEN_STORAGE_KEY = "hp.pushToken.v1";
/** AsyncStorage key recording which token the server has (avoid re-POSTs). */
const PUSH_TOKEN_SYNCED_KEY = "hp.pushToken.synced.v1";

let handlerConfigured = false;

/** Foreground presentation defaults. Safe to call on every app start. */
export function configureNotificationHandler(): void {
  if (handlerConfigured) return;
  handlerConfigured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
  });
}

/**
 * Request permission and obtain the Expo push token. Returns null on
 * simulators, denied permission, or when no EAS projectId is configured.
 * Never throws — push must not break the app.
 */
export async function registerForPushNotifications(
  getAccessToken: () => Promise<string | null>
): Promise<string | null> {
  try {
    if (!Device.isDevice) return null; // push requires a physical device

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Dispute updates",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted) {
      const requested = await Notifications.requestPermissionsAsync();
      granted = requested.granted;
    }
    if (!granted) return null;

    const extra = (Constants.expoConfig?.extra ?? {}) as {
      eas?: { projectId?: string };
    };
    const projectId = extra.eas?.projectId;
    // The placeholder UUID in app.json is not a real EAS project — skip.
    const usableProjectId =
      projectId && !projectId.startsWith("00000000") ? projectId : undefined;

    const token = await Notifications.getExpoPushTokenAsync(
      usableProjectId ? { projectId: usableProjectId } : undefined
    );

    // Persist locally so the token can be reconciled once the server route
    // exists (or inspected in support flows). Best effort, never throws.
    try {
      await AsyncStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token.data);
    } catch {
      // ignore quota errors
    }

    // W7-1: register with the server via tRPC (authenticated by the token
    // provider registered in trpc.ts). Skipped when we already synced this
    // exact token; failures are non-fatal and retried on next launch.
    const accessToken = await getAccessToken();
    if (accessToken) {
      try {
        const synced = await AsyncStorage.getItem(PUSH_TOKEN_SYNCED_KEY);
        if (synced !== token.data) {
          await trpc.pushSubscriptions.registerExpoToken.mutate({
            token: token.data,
            platform: Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web",
          });
          await AsyncStorage.setItem(PUSH_TOKEN_SYNCED_KEY, token.data);
        }
      } catch {
        // Offline or server unreachable — local copy remains for next launch.
      }
    }
    return token.data;
  } catch {
    return null;
  }
}

/** Read the locally stored Expo push token (null when never registered). */
export async function getStoredPushToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Extract a dispute id from a tapped notification, if the payload has one. */
export function disputeIdFromResponse(
  response: Notifications.NotificationResponse
): string | null {
  const data = response.notification.request.content.data;
  const id = (data as Record<string, unknown> | undefined)?.disputeId;
  return typeof id === "string" && id.length > 0 ? id : null;
}
