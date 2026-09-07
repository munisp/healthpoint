/**
 * useCachedQuery — react-query wrapper with an AsyncStorage fallback.
 *
 * On success the payload is persisted (with a timestamp); on failure the
 * cached payload is returned instead and `isFromCache` is set so screens can
 * show a staleness indicator. This is the "offline queue" for reads: last
 * fetched lists stay visible when the network is unavailable.
 */
import { useEffect, useState } from "react";
import { useQuery, type QueryKey } from "@tanstack/react-query";
import { readCache, writeCache, type CachedEntry } from "./cache";

export interface CachedQueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isRefetching: boolean;
  /** True when rendering AsyncStorage data because the network fetch failed. */
  isFromCache: boolean;
  /** Timestamp (epoch ms) of the data currently rendered. */
  dataUpdatedAtMs: number | null;
  refetch: () => void;
}

export function useCachedQuery<T>(opts: {
  cacheKey: string;
  queryKey: QueryKey;
  queryFn: () => Promise<T>;
  enabled?: boolean;
}): CachedQueryResult<T> {
  const { cacheKey, queryKey, queryFn, enabled = true } = opts;
  const [cached, setCached] = useState<CachedEntry<T> | null>(null);

  useEffect(() => {
    let active = true;
    void readCache<T>(cacheKey).then((entry) => {
      if (active && entry) setCached(entry);
    });
    return () => {
      active = false;
    };
  }, [cacheKey]);

  const query = useQuery({ queryKey, queryFn, enabled });

  useEffect(() => {
    if (query.data != null) void writeCache(cacheKey, query.data);
  }, [cacheKey, query.data]);

  const fromCache = query.data == null && cached != null;
  return {
    data: (query.data ?? cached?.data) as T | undefined,
    isLoading: query.isLoading && cached == null,
    isError: query.isError && cached == null,
    error: query.error,
    isRefetching: query.isRefetching,
    isFromCache: fromCache,
    dataUpdatedAtMs: query.dataUpdatedAt || cached?.fetchedAt || null,
    refetch: () => {
      void query.refetch();
    },
  };
}
