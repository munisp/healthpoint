/**
 * Offline read cache backed by AsyncStorage.
 *
 * Stores the last successful payload for each list/detail query with a
 * timestamp, so screens can render stale data (with a staleness banner) when
 * the network is down. Cache writes/reads NEVER throw — caching is best
 * effort and must not take the app down with it.
 *
 * Security: only non-secret API payloads are cached here. Tokens live
 * exclusively in expo-secure-store (see src/auth/AuthContext.tsx).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "hp.cache.v1.";

export interface CachedEntry<T> {
  data: T;
  /** epoch ms of the successful fetch */
  fetchedAt: number;
}

export async function readCache<T>(key: string): Promise<CachedEntry<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEntry<T>;
    if (typeof parsed.fetchedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeCache<T>(key: string, data: T): Promise<void> {
  try {
    await AsyncStorage.setItem(
      PREFIX + key,
      JSON.stringify({ data, fetchedAt: Date.now() } satisfies CachedEntry<T>)
    );
  } catch {
    // best effort — ignore quota/serialization failures
  }
}

/** Drop all cached payloads (called on sign-out so PHI leaves the device). */
export async function clearAllCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const ours = keys.filter((k) => k.startsWith(PREFIX));
    if (ours.length) await AsyncStorage.multiRemove(ours);
  } catch {
    // best effort
  }
}
