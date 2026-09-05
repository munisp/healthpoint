/**
 * tRPC client for the HealthPoint IDR API.
 *
 * - Targets `${apiUrl}/api/trpc` with httpBatchLink and the superjson
 *   transformer, matching the web client (client/src/main.tsx).
 * - Attaches the Keycloak access token as `Authorization: Bearer`. The server
 *   verifies it via RS256/JWKS against the Keycloak realm
 *   (server/auth/bearer.ts — iss/aud/exp enforced).
 * - On HTTP 401 the registered unauthorized handler fires (AuthContext uses
 *   it to drop the session and route back to login).
 * - Network failures (fetch rejects) are retried with backoff; HTTP error
 *   statuses are never retried.
 *
 * NOTE: the web app's AppRouter type (server/routers.ts) is not published as
 * a shared package, so this client is typed loosely. Replace `any` with the
 * real AppRouter type once a shared types package exists.
 */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import Constants from "expo-constants";
import superjson from "superjson";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
export const API_URL: string = extra.apiUrl ?? "http://localhost:3000";

// AuthContext registers an async access-token provider at runtime so this
// module stays free of React/auth imports (and refresh logic).
type TokenProvider = () => Promise<string | null>;
let tokenProvider: TokenProvider | null = null;

export function registerTokenProvider(provider: TokenProvider): void {
  tokenProvider = provider;
}

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

/** Called once per response that comes back HTTP 401 (token rejected). */
export function registerUnauthorizedHandler(handler: UnauthorizedHandler): void {
  unauthorizedHandler = handler;
}

const MAX_NETWORK_RETRIES = 2;

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  input: FetchInput,
  init?: FetchInit,
  attempt = 0
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (err) {
    // Only network-layer failures are retried (offline, DNS, socket reset).
    if (attempt < MAX_NETWORK_RETRIES) {
      await delay(300 * 2 ** attempt);
      return fetchWithRetry(input, init, attempt + 1);
    }
    throw err;
  }
  if (response.status === 401 && unauthorizedHandler) {
    // Refresh raced an expiry or the session was revoked — force re-login.
    unauthorizedHandler();
  }
  return response;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const trpc = createTRPCClient<any>({
  links: [
    httpBatchLink({
      url: `${API_URL}/api/trpc`,
      transformer: superjson,
      fetch: fetchWithRetry,
      async headers() {
        const token = tokenProvider ? await tokenProvider() : null;
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});
