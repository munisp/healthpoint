/**
 * tRPC client for the HealthPoint IDR API.
 *
 * - Targets `${apiUrl}/api/trpc` with httpBatchLink and the superjson
 *   transformer, matching the web client (client/src/main.tsx).
 * - Attaches the Keycloak access token as `Authorization: Bearer`.
 *
 * NOTE: the server currently authenticates via its own session cookie and
 * does NOT yet verify Bearer tokens. See mobile/README.md ("known gaps").
 *
 * NOTE: the web app's AppRouter type (server/routers.ts) is not published
 * as a shared package, so this client is typed loosely. Replace `any` with
 * the real AppRouter type once a shared types package exists.
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const trpc = createTRPCClient<any>({
  links: [
    httpBatchLink({
      url: `${API_URL}/api/trpc`,
      transformer: superjson,
      async headers() {
        const token = tokenProvider ? await tokenProvider() : null;
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});
