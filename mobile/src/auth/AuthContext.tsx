/**
 * OIDC (PKCE) authentication against Keycloak for the mobile app.
 *
 * Flow: expo-auth-session `useAuthRequest` (PKCE on by default) →
 * authorization-code exchange → tokens persisted in expo-secure-store →
 * proactive silent refresh via the stored refresh token (30s expiry skew so
 * a token never dies mid-request).
 *
 * Session lifecycle:
 * - Any API response with HTTP 401 triggers the unauthorized handler
 *   registered with the tRPC layer → tokens cleared → router redirects to
 *   /login (see app/(tabs)/_layout.tsx guard).
 * - Sign-out clears SecureStore tokens AND the AsyncStorage read cache
 *   (PHI must not linger) AND the react-query in-memory cache.
 *
 * Discovery document:
 *   ${keycloakUrl}/realms/healthpoint/.well-known/openid-configuration
 * Client: `healthpoint-app` (public client; must allow the redirect URI
 *   `healthpoint://auth/callback` and PKCE).
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as AuthSession from "expo-auth-session";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import Constants from "expo-constants";
import { registerTokenProvider, registerUnauthorizedHandler } from "../api/trpc";
import { clearAllCache } from "../api/cache";
import { queryClient } from "../api/queryClient";

WebBrowser.maybeCompleteAuthSession();

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
const KEYCLOAK_URL: string = extra.keycloakUrl ?? "http://localhost:8080";
const REALM: string = extra.keycloakRealm ?? "healthpoint";
const CLIENT_ID: string = extra.keycloakClientId ?? "healthpoint-app";
const ISSUER = `${KEYCLOAK_URL}/realms/${REALM}`;

const STORE_KEYS = {
  accessToken: "hp.accessToken",
  refreshToken: "hp.refreshToken",
  expiresAt: "hp.expiresAt", // epoch ms
} as const;

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  status: AuthStatus;
  /** True once discovery + request objects are ready and sign-in can start. */
  ready: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Returns a valid access token, refreshing silently if necessary. */
  getAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function persistTokens(
  accessToken: string,
  refreshToken: string | undefined,
  expiresInSeconds: number | undefined
): Promise<void> {
  const expiresAt = Date.now() + (expiresInSeconds ?? 300) * 1000;
  await SecureStore.setItemAsync(STORE_KEYS.accessToken, accessToken);
  await SecureStore.setItemAsync(STORE_KEYS.expiresAt, String(expiresAt));
  if (refreshToken) {
    await SecureStore.setItemAsync(STORE_KEYS.refreshToken, refreshToken);
  }
}

async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(STORE_KEYS.accessToken),
    SecureStore.deleteItemAsync(STORE_KEYS.refreshToken),
    SecureStore.deleteItemAsync(STORE_KEYS.expiresAt),
  ]);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  const discovery = AuthSession.useAutoDiscovery(ISSUER);
  const redirectUri = AuthSession.makeRedirectUri({
    scheme: "healthpoint",
    path: "auth/callback",
  });

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: CLIENT_ID,
      redirectUri,
      scopes: ["openid", "profile", "email", "offline_access"],
      responseType: AuthSession.ResponseType.Code,
    },
    discovery
  );

  const refreshAsyncRef = useRef<
    null | ((refreshToken: string) => Promise<string | null>)
  >(null);

  // Full local teardown: tokens, offline cache, in-memory query cache.
  const destroySession = useCallback(async (): Promise<void> => {
    await clearTokens();
    await clearAllCache();
    queryClient.clear();
    setStatus("unauthenticated");
  }, []);

  // 401 → re-login: the tRPC layer fires this when the server rejects the
  // Bearer token (expired refresh, revoked session, role change, etc.).
  useEffect(() => {
    registerUnauthorizedHandler(() => {
      void destroySession();
    });
  }, [destroySession]);

  // Returns a valid access token: cached if unexpired, otherwise refreshed.
  const getAccessToken = useCallback(async (): Promise<string | null> => {
    const [accessToken, refreshToken, expiresAtRaw] = await Promise.all([
      SecureStore.getItemAsync(STORE_KEYS.accessToken),
      SecureStore.getItemAsync(STORE_KEYS.refreshToken),
      SecureStore.getItemAsync(STORE_KEYS.expiresAt),
    ]);
    if (!accessToken) return null;

    const expiresAt = Number(expiresAtRaw ?? 0);
    // 30s skew so we never hand out a token that expires mid-request.
    if (expiresAt - 30_000 > Date.now()) return accessToken;

    if (!refreshToken || !refreshAsyncRef.current) return null;
    return refreshAsyncRef.current(refreshToken);
  }, []);

  // Refresh helper needs `discovery`, which only exists after discovery loads.
  useEffect(() => {
    if (!discovery) return;
    refreshAsyncRef.current = async (refreshToken: string) => {
      try {
        const refreshed = await AuthSession.refreshAsync(
          { clientId: CLIENT_ID, refreshToken },
          discovery
        );
        if (!refreshed.accessToken) return null;
        await persistTokens(
          refreshed.accessToken,
          refreshed.refreshToken ?? refreshToken,
          refreshed.expiresIn ?? undefined
        );
        setStatus("authenticated");
        return refreshed.accessToken;
      } catch {
        // Refresh token rejected — drop the session; user must sign in again.
        await destroySession();
        return null;
      }
    };
  }, [discovery, destroySession]);

  // Expose the token getter to the tRPC client.
  useEffect(() => {
    registerTokenProvider(getAccessToken);
  }, [getAccessToken]);

  // Restore a persisted session on launch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await SecureStore.getItemAsync(STORE_KEYS.accessToken);
      if (cancelled) return;
      setStatus(token ? "authenticated" : "unauthenticated");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Handle the authorization response: exchange the code for tokens.
  useEffect(() => {
    if (!response) return;
    if (response.type === "error") {
      setError(response.error?.message ?? "Sign-in failed");
      return;
    }
    if (response.type !== "success") return;
    const code = response.params.code;
    if (!code || !discovery || !request?.codeVerifier) {
      setError("Sign-in response was incomplete.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const tokens = await AuthSession.exchangeCodeAsync(
          {
            clientId: CLIENT_ID,
            code,
            redirectUri,
            extraParams: { code_verifier: request.codeVerifier! },
          },
          discovery
        );
        if (cancelled) return;
        if (!tokens.accessToken) {
          setError("Token response did not include an access token.");
          return;
        }
        await persistTokens(
          tokens.accessToken,
          tokens.refreshToken ?? undefined,
          tokens.expiresIn ?? undefined
        );
        setError(null);
        setStatus("authenticated");
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Token exchange failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [response, discovery, request, redirectUri]);

  const signIn = useCallback(async () => {
    setError(null);
    await promptAsync();
  }, [promptAsync]);

  const signOut = useCallback(async () => {
    // TODO: also hit the Keycloak end-session endpoint to fully log out of SSO.
    await destroySession();
  }, [destroySession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      ready: !!discovery && !!request,
      error,
      signIn,
      signOut,
      getAccessToken,
    }),
    [status, discovery, request, error, signIn, signOut, getAccessToken]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
