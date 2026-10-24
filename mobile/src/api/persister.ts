/**
 * TanStack Query persistence to AsyncStorage.
 *
 * Restores the in-memory query cache on cold start so lists render instantly
 * (read-only when offline — mutations are never persisted). Persisted data
 * expires after 24h and is versioned via `buster`; bump the buster to
 * invalidate all persisted payloads after a breaking API change.
 *
 * This complements src/api/cache.ts: the persister restores the react-query
 * cache itself, while useCachedQuery provides the explicit stale-data +
 * "Offline — showing cached data" banner contract per screen.
 *
 * The AsyncStorage persister below implements the Persister interface from
 * @tanstack/react-query-persist-client directly (persist/restore/remove) so
 * we don't need the separate async-storage-persister package. All writes are
 * best effort and never throw.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  PersistedClient,
  Persister,
} from "@tanstack/react-query-persist-client";

export const PERSIST_BUSTER = "hp.persist.v1";
/** 24 hours — PHI-adjacent data should not linger longer than a day. */
export const PERSIST_MAX_AGE = 24 * 60 * 60 * 1000;

const STORAGE_KEY = "hp.queryCache.v1";

export const asyncStoragePersister: Persister = {
  persistClient: async (client: PersistedClient) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(client));
    } catch {
      // best effort — quota/serialization failures must not break the app
    }
  },
  restoreClient: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as PersistedClient) : undefined;
    } catch {
      return undefined;
    }
  },
  removeClient: async () => {
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {
      // best effort
    }
  },
};
