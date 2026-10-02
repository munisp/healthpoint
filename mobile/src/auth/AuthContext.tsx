/**
 * Auth context — OIDC Authorization Code + PKCE sign-in (Phase 7).
 *
 * Uses expo-auth-session's AuthRequest against the same OIDC discovery
 * endpoint the web app uses (server/_core/oidc.ts). The authorization code
 * is exchanged for tokens with PKCE; the access token authenticates tRPC
 * calls (server accepts Bearer tokens via mobileAccessTokens / OAuth JWT
 * verification), and the refresh token is stored in Expo SecureStore for
 * silent re-authentication.
 *
 * If the OIDC endpoints are unreachable (dev without an IdP), the context
 * surfaces a clear error instead of hanging.
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
import * as WebBrowser from "expo-web-browser";
import Constants from "expo-constants";
import {
  destroySession,
  getValidAccessToken,
  loadSession,
  saveSession,
  type Session,
} from "./session";
import { setMobileAccessTokenProvider } from "../api/trpc";
import { logoutServerSide } from "../api/hooks";
import { unregisterPushToken } from "../notifications/push";

WebBrowser.maybeCompleteAuthSession();

export type AuthStatus = "loading" | "signedOut" | "signedIn";

export interface AuthContextValue {
  status: AuthStatus;
  /** True once the OIDC discovery document + auth request are ready. */
  ready: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Returns a valid access token (refreshing if needed), or null. */
  getAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue>({
  status: "loading",
  ready: false,
  error: null,
  signIn: async () => {},
  signOut: async () => {},
  getAccessToken: async () => null,
});

export function useAuthContext(): AuthContextValue {
  return useContext(AuthContext);
}

function extra(): { oidcBaseUrl?: string; oidcClientId?: string } {
  return (Constants.expoConfig?.extra ?? {}) as {
    oidcBaseUrl?: string;
    oidcClientId?: string;
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<Session | null>(null);

  const oidcBaseUrl = extra().oidcBaseUrl?.replace(/\/$/, "");
  const clientId = extra().oidcClientId;

  // OIDC discovery (same well-known endpoint as the web app).
  const discovery = AuthSession.useAutoDiscovery(
    oidcBaseUrl ? `${oidcBaseUrl}/.well-known/openid-configuration` : ""
  );

  // Redirect URI: hp://auth/callback in dev/standalone builds.
  const redirectUri = AuthSession.makeRedirectUri({
    scheme: "hp",
    path: "auth/callback",
  });

  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: clientId ?? "",
      redirectUri,
      scopes: ["openid", "profile", "email", "offline_access"],
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
    },
    discovery
  );

  // Restore a persisted session on launch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadSession();
      if (cancelled) return;
      if (stored) {
        sessionRef.current = stored;
        setStatus("signedIn");
      } else {
        setStatus("signedOut");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applySession = useCallback(async (session: Session | null) => {
    sessionRef.current = session;
    if (session) {
      await saveSession(session);
      setStatus("signedIn");
    } else {
      await destroySession();
      setStatus("signedOut");
    }
  }, []);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    if (!discovery?.tokenEndpoint) return sessionRef.current?.accessToken ?? null;
    const next = await getValidAccessToken(
      discovery.tokenEndpoint,
      clientId ?? "",
      sessionRef.current
    );
    if (next !== sessionRef.current) {
      await applySession(next);
    }
    return next?.accessToken ?? null;
  }, [discovery, clientId, applySession]);

  // Wire the tRPC Bearer token provider once getAccessToken exists.
  useEffect(() => {
    setMobileAccessTokenProvider(getAccessToken);
  }, [getAccessToken]);

  // Exchange the authorization code for tokens when the browser returns.
  const exchangeCode = useCallback(
    async (code: string) => {
      if (!discovery?.tokenEndpoint || !request?.codeVerifier || !clientId) {
        throw new Error("OIDC discovery not ready");
      }
      const tokenResponse = await AuthSession.exchangeCodeAsync(
        {
          clientId,
          code,
          redirectUri,
          extraParams: { code_verifier: request.codeVerifier },
        },
        { tokenEndpoint: discovery.tokenEndpoint }
      );
      const now = Math.floor(Date.now() / 1000);
      const session: Session = {
        accessToken: tokenResponse.accessToken,
        refreshToken: tokenResponse.refreshToken,
        idToken: tokenResponse.idToken,
        expiresAt: now + (tokenResponse.expiresIn ?? 3600),
        issuedAt: now,
      };
      await applySession(session);
    },
    [discovery, request, clientId, redirectUri, applySession]
  );

  const signIn = useCallback(async () => {
    setError(null);
    if (!oidcBaseUrl || !clientId) {
      setError(
        "OIDC is not configured for this build (extra.oidcBaseUrl / extra.oidcClientId missing)."
      );
      return;
    }
    try {
      const result = await promptAsync();
      if (result.type === "success" && result.params.code) {
        await exchangeCode(result.params.code);
      } else if (result.type === "error") {
        setError(result.error?.message ?? "Sign-in failed");
      }
      // "cancel" / "dismiss" — user backed out; leave state as-is.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
    }
  }, [oidcBaseUrl, clientId, promptAsync, exchangeCode]);

  const signOut = useCallback(async () => {
    // Best-effort server-side session teardown (trpc.auth.logout) BEFORE
    // local tokens are wiped — after destroySession the Bearer token is gone
    // and the call would 401. Failure must not block local sign-out.
    try {
      await unregisterPushToken();
    } catch {
      // push unregister is best effort (helper already swallows errors)
    }
    try {
      await logoutServerSide();
    } catch {
      // offline / server unreachable — local teardown still proceeds
    }
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
