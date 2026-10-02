# Mobile performance notes (phase14-perfc)

**Status: STATIC-ONLY guidance.** No device or emulator was available when
these changes were made; nothing below is a measured benchmark. All entries
are configuration/code rationale plus instructions for measuring on real
hardware.

## Settings applied

| Area | Setting | Where | Rationale (static) |
|---|---|---|---|
| JS engine | `jsEngine: "hermes"` | `app.json` | Explicit Hermes (Expo SDK 52 default, now pinned) — faster startup, lower memory vs JSC. |
| List virtualization | `initialNumToRender`/`maxToRenderPerBatch` 10–12, `updateCellsBatchingPeriod` 50, `windowSize` 7, `removeClippedSubviews` | `app/(tabs)/disputes.tsx`, `app/(tabs)/notifications.tsx` | Caps the initial render burst after a 50-item fetch and clips off-screen rows to bound native view memory on long lists. |
| Row memoization | `React.memo` on `DisputeRow`, `NotificationRow`, `StatusBadge`, `NotificationTypeBadge`, `Sparkline`, `KpiCard` | screens + `src/components/StatusBadge.tsx` | Parent state churn (search keystrokes, refetch flags) no longer re-renders unchanged rows. |
| Stable props | `useCallback` renderItem/keyExtractor/refetch, `useMemo` filter/refreshControl/header | list screens, `src/api/useCachedQuery.ts` | Prevents referential churn that defeats memoization and FlatList's internal optimizations. |
| Query defaults | `staleTime` 30s, `gcTime` 5min, `retry` 1, `refetchOnReconnect: true`, `refetchOnWindowFocus: false` | `src/api/queryClient.ts` | Avoids refetch storms on tab focus; back-navigation renders from cache; reconnect refreshes stale data on intermittent mobile networks. |
| Offline reads | AsyncStorage persister (24h maxAge) + per-query fallback cache | `src/api/persister.ts`, `src/api/cache.ts` | Cold start renders last-good lists instantly (pre-existing design). |

## Deliberately NOT changed

- **`expo-image`** (disk/memory image caching, `cachePolicy`) is not in
  `package.json`. No new dependency was added in this wave. The app
  currently ships no remote `<Image>` usage, so impact would be low; if
  remote avatars/attachments are added, install `expo-image` and use
  `cachePolicy="memory-disk"`.
- Dashboard/detail/`more` ScrollViews render small fixed-size content (KPI
  grid, ~6 recent disputes, 19 timeline rows) — converting them to FlatList
  would add complexity with no virtualization win. Revisit only if those
  sections become unbounded.
- New Architecture (`newArchEnabled: true`) is already enabled in
  `app.json`.

## How to measure on-device (guidance)

1. **Hermes + release build**: always measure with
   `eas build --profile production` (or `npx expo run:android --variant release`);
   dev builds hide real timing.
2. **Flipper / React DevTools Profiler**: record a commit while typing in
   the disputes search box; rows with unchanged data should show "Did not
   render" thanks to memoization.
3. **why-did-you-render** (optional, dev-only):
   `npx expo install why-did-you-render`, add
   `DisputeRow.whyDidYouRender = true` in a dev build to verify prop
   stability. Do not enable in production.
4. **FlatList windowing**: enable `debug` on VirtualizedList in a dev build
   to confirm the render window stays bounded while scrolling a large
   dispute list; watch for blank cells if `windowSize` is lowered further.
5. **Perf Monitor** (dev menu → Perf Monitor): watch JS/UI frame rates
   during scroll; dropped JS frames during fast scroll usually mean too
   much work in `renderItem`.
6. **Network**: Flipper Network plugin or a proxy to confirm no duplicate
   refetches on tab focus (staleTime) and a single retry on failure.
