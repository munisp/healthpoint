/**
 * Push-notification registration + tap handling.
 *
 * IMPORTANT — server gap (verified against server/routers.ts): there is NO
 * endpoint that stores device push tokens today. Registration therefore:
 *   1. requests OS permission,
 *   2. creates the Android channel,
 *   3. obtains the Expo push token locally,
 *   4. SKIPS the network POST until PUSH_TOKEN_ENDPOINT is set to a real
 *      route (do not invent one — add the server route first, then set the
 *      constant). The rest of the flow is wired and tested from that point.
 *
 * Notification taps deep-link into the app: payloads carrying
 * `data.disputeId` route to /dispute/[id] (see app/_layout.tsx).
 */
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

/**
 * TODO(server): set to `${API_URL}/api/<route>` once the server exposes a
 * push-token registration endpoint, e.g. `${API_URL}/api/push-tokens`.
 */
const PUSH_TOKEN_ENDPOINT: string | null = null;

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

    if (PUSH_TOKEN_ENDPOINT) {
      const accessToken = await getAccessToken();
      if (accessToken) {
        await fetch(PUSH_TOKEN_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            token: token.data,
            platform: Platform.OS,
          }),
        });
      }
    }
    return token.data;
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
