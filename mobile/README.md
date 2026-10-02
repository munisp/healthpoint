# HealthPoint IDR — Mobile (Expo)

Native mobile companion for the HealthPoint IDR web app (React Native via
Expo SDK 52, TypeScript, expo-router).

## Setup

```bash
cd mobile
npm install
npx expo start
```

No `create-expo-app` step is needed — this directory is self-contained.
Store/EAS release steps live in [STORE.md](./STORE.md).

## Configuration

Runtime endpoints are read from `app.json → expo.extra` (surfaced via
`expo-constants`):

| Key                | Default                    | Purpose                               |
| ------------------ | -------------------------- | ------------------------------------- |
| `apiUrl`           | `http://localhost:3000`    | HealthPoint API base (`/api/trpc`)    |
| `keycloakUrl`      | `http://localhost:8080`    | Keycloak base URL                     |
| `keycloakRealm`    | `healthpoint`              | OIDC realm                            |
| `keycloakClientId` | `healthpoint-app`          | Public OIDC client for the mobile app |

For a physical device, point `apiUrl`/`keycloakUrl` at LAN-reachable hosts
(`localhost` will not resolve from a device).

## Architecture

- `app/` — expo-router file-based routes:
  - `_layout.tsx` — root stack, `QueryClientProvider`, `AuthProvider`,
    `BiometricGate`, push-notification tap deep-links.
  - `index.tsx` — redirects to `/login` or `/disputes` based on auth state.
  - `login.tsx` — SSO sign-in entry point.
  - `(tabs)/_layout.tsx` — auth-gated tab shell: **Disputes**, **Alerts**
    (unread badge), **Profile**; registers for push on sign-in.
  - `(tabs)/disputes.tsx` — searchable/filterable dispute list
    (`disputes.list`) with status badges, pull-to-refresh, skeletons, and
    offline staleness banner.
  - `(tabs)/notifications.tsx` — alerts (`notifications.list`), tap = mark
    read (`notifications.markRead`) + deep-link to the dispute, mark-all.
  - `(tabs)/profile.tsx` — identity (`auth.me`), org (`profiles.get`),
    sign-out with confirmation.
  - `dispute/[id].tsx` — detail via `disputes.getTimeline`: amounts (USD),
    details, deadlines, offers, 19-step IDR timeline, documents, notes.
- `src/auth/AuthContext.tsx` — OIDC **PKCE** flow via `expo-auth-session`
  against Keycloak (discovery:
  `${keycloakUrl}/realms/healthpoint/.well-known/openid-configuration`),
  tokens in `expo-secure-store` (never AsyncStorage), silent refresh with a
  30s expiry skew, and 401-driven session teardown (tRPC layer →
  `registerUnauthorizedHandler` → tokens + caches wiped → `/login`).
- `src/auth/BiometricGate.tsx` — Face ID / Touch ID / fingerprint re-entry
  lock (expo-local-authentication) with OS passcode fallback; no-ops on
  devices without enrolled biometrics.
- `src/api/trpc.ts` — tRPC v11 client (`createTRPCClient` + `httpBatchLink`)
  targeting `${apiUrl}/api/trpc` with superjson; attaches the Keycloak access
  token as `Authorization: Bearer`; retries network failures with backoff
  (HTTP statuses are never retried).
- `src/api/cache.ts` + `src/api/useCachedQuery.ts` — AsyncStorage read cache
  per query; when a fetch fails, screens render the last good payload behind
  a staleness banner. Cache is cleared on sign-out.
- `src/notifications/push.ts` — expo-notifications registration, Android
  channel, notification-tap → `/dispute/[id]` deep-link.
- `src/theme.ts` — muted green/amber/red badge palette mirroring the web
  client (Tailwind 100/700 pairs).

## Authentication

Keycloak issues RS256 access tokens for the public client `healthpoint-app`
(redirect URI `healthpoint://auth/callback`, PKCE). The server verifies them
via JWKS (`server/auth/bearer.ts`) with iss/aud/exp enforcement — no session
cookie is used by the mobile app. Refresh tokens are stored in the device
keychain and rotated on silent refresh.

Deep links: custom scheme `healthpoint://` plus universal links for the
configured host (currently the placeholder `app.healthpoint.example.com` —
see STORE.md §0 before release).

## What is real vs TODO

**Real:**
- PKCE login, secure token storage, silent refresh, 401 → re-login.
- Biometric re-entry lock with graceful fallback.
- Disputes list/detail, timeline, notifications, profile — all with
  pull-to-refresh, skeleton, empty, error+retry, and offline-cache states.
- Push notification tap deep-links into dispute detail.

**TODO / known gaps:**
- **Push token upload has no server route.** `src/notifications/push.ts`
  fetches the Expo push token but skips the registration POST until
  `PUSH_TOKEN_ENDPOINT` points at a real endpoint (none exists in
  `server/routers.ts` — add one server-side first, do not invent a path).
- Binary store assets (icon/splash) are not committed — see
  `assets/README.md`.
- `extra.eas.projectId` and the universal-link host are placeholders
  (STORE.md §0).
- The mobile client is typed loosely (`createTRPCClient<any>`) because the
  web app's `AppRouter` type is not exported as a shared package; response
  shapes are hand-verified in `src/api/types.ts`.
- No dispute creation/editing or document upload from mobile yet (read-only
  companion + notifications).
- Dependency versions are plausible pins for Expo SDK 52 but should be
  confirmed with `npx expo install --check` on first install.
