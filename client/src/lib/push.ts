/**
 * Web Push subscription helper.
 *
 * Flow: fetch the server's VAPID public key (pushSubscriptions.getVapidPublicKey),
 * subscribe via the active service worker's pushManager, and persist the
 * subscription JSON per user via trpc.pushSubscriptions.subscribe. All
 * functions degrade gracefully (return null / false) when the Push API is
 * unsupported or the server has no VAPID key configured.
 */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

/** Current push subscription for this browser, if any. */
export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  const reg = await getRegistration();
  if (!reg) return null;
  try {
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Subscribe this browser to push notifications and persist the subscription
 * server-side. Returns true on success.
 */
export async function subscribeToPush(
  subscribeMutation: { mutateAsync: (input: { subscription: Record<string, unknown> }) => Promise<unknown> }
): Promise<boolean> {
  const reg = await getRegistration();
  if (!reg) return false;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  // Fetch the VAPID key over plain HTTP to keep this helper hook-free; the
  // caller owns the subscribe mutation.
  let vapidKey: string | null = null;
  try {
    const res = await fetch("/api/trpc/pushSubscriptions.getVapidPublicKey");
    if (res.ok) {
      const json = await res.json();
      vapidKey = json?.result?.data?.key ?? null;
    }
  } catch {
    return false;
  }
  if (!vapidKey) return false;

  try {
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
    });
    const json = sub.toJSON();
    await subscribeMutation.mutateAsync({
      subscription: {
        endpoint: sub.endpoint,
        keys: json.keys ?? {},
      },
    });
    return true;
  } catch {
    return false;
  }
}

/** Unsubscribe this browser and remove the server-side record. */
export async function unsubscribeFromPush(
  unsubscribeMutation: { mutateAsync: (input: { endpoint: string }) => Promise<unknown> }
): Promise<boolean> {
  const sub = await getCurrentSubscription();
  if (!sub) return false;
  const endpoint = sub.endpoint;
  try {
    await sub.unsubscribe();
    await unsubscribeMutation.mutateAsync({ endpoint });
    return true;
  } catch {
    return false;
  }
}
