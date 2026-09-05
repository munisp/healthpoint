# HealthPoint IDR — Mobile (Expo) Scaffold

> **STATUS: UNTESTED SCAFFOLD MVP.** This directory was generated as a
> text-only scaffold. It has NOT been installed, compiled, or run against a
> live server. Expect to fix version pins and small API mismatches on first
> `npm install` / `npx expo start`.

Native mobile companion for the HealthPoint IDR web app (React Native via
Expo, TypeScript, expo-router).

## Setup

```bash
cd mobile
npm install
npx expo start
```

No `create-expo-app` step is needed — this directory is self-contained.

## Configuration

Runtime endpoints are read from `app.json → expo.extra` (surfaced via
`expo-constants`):

| Key                | Default                    | Purpose                              |
| ------------------ | -------------------------- | ------------------------------------ |
| `apiUrl`           | `http://localhost:3000`    | HealthPoint API base (`/api/trpc`)   |
| `keycloakUrl`      | `http://localhost:8080`    | Keycloak base URL                    |
| `keycloakRealm`    | `healthpoint`              | OIDC realm                           |
| `keycloakClientId` | `healthpoint-app`          | Public OIDC client for the mobile app|

For a physical device, point `apiUrl`/`keycloakUrl` at LAN-reachable hosts
(`localhost` will not resolve from a device).

## Architecture

- `app/` — expo-router file-based routes:
  - `_layout.tsx` — root stack, `QueryClientProvider`, auth provider gate.
  - `index.tsx` — redirects to `/login` or `/disputes` based on auth state.
  - `login.tsx` — SSO sign-in entry point.
  - `disputes/index.tsx` — dispute list via `disputes.list`.
  - `disputes/[id].tsx` — dispute detail via `disputes.getById`.
- `src/auth/AuthContext.tsx` — OIDC **PKCE** flow via `expo-auth-session`
  against Keycloak (discovery:
  `${keycloakUrl}/realms/healthpoint/.well-known/openid-configuration`),
  token persistence in `expo-secure-store`, and access-token refresh.
- `src/api/trpc.ts` — tRPC v11 client (`createTRPCClient` +
  `httpBatchLink`) targeting `${apiUrl}/api/trpc` with the **superjson**
  transformer (matching the web client in `client/src/main.tsx`). The
  Keycloak access token is attached as an `Authorization: Bearer` header.

## What is real vs TODO

**Real (code-complete in this scaffold):**
- PKCE login against Keycloak, token storage, and refresh handling.
- Typed-`any` tRPC calls to `disputes.list` / `disputes.getById`
  (procedure names verified against `server/routers.ts`).
- Route gating on auth state.

**TODO / known gaps:**
- **REQUIRED server follow-up — Bearer/JWKS verification.** The server
  currently authenticates exclusively via its own session cookie (see
  `server/routers.ts` auth flow). The mobile app sends a Keycloak access
  token as `Authorization: Bearer`, which the server **does not yet
  accept**. End-to-end authenticated API calls will return 401 until the
  server gains OIDC JWT verification (e.g. JWKS validation against the
  Keycloak realm) or a token-exchange endpoint. Do not treat this scaffold
  as working end-to-end.
- The mobile client is typed loosely (`createTRPCClient<any>`) because the
  web app's `AppRouter` type is not exported as a shared package. Introduce
  a shared types package and replace the `any`.
- No offline support, push notifications, dispute creation/editing, or
  document upload.
- Dependency versions in `package.json` are plausible pins for Expo SDK 52
  but have not been resolved; run `npx expo install --fix` if needed.
- Keycloak must have a public client `healthpoint-app` with the redirect
  URI `healthpoint://auth/callback` registered (and PKCE enabled).
