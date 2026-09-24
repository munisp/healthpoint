import { TRPCError } from "@trpc/server";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { resolveSession } from "./keycloak";
import { authenticateBearerRequest, hasBearerToken, isApiKeyToken, authenticateApiKeyRequest, extractBearerTokenRaw } from "../auth/bearer";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  /**
   * True when the session is a pre-MFA token (two-stage login). The user row
   * is resolved, but protectedProcedure rejects everything outside the MFA
   * allow-list with 403 mfa_required (see server/_core/trpc.ts).
   */
  mfaPending: boolean;
  /** True when the request authenticated via an hp_ API key (not a session). */
  viaApiKey: boolean;
  /** Effective scopes of the API key (admin stripped for non-admin owners). */
  apiKeyScopes: string[];
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let mfaPending = false;
  let viaApiKey = false;
  let apiKeyScopes: string[] = [];

  // Mobile app + headless API clients authenticate with a Keycloak Bearer
  // access token, verified server-side against the realm JWKS
  // (server/auth/bearer.ts), OR with an `hp_` API key checked against
  // api_keys.keyHash. When an Authorization: Bearer header is present, any
  // verification failure rejects the request with 401 — there is NO
  // fall-through to the session cookie. Without a Bearer header, the existing
  // session-cookie flow applies unchanged (optional for public procedures).
  const rawBearer = extractBearerTokenRaw(opts.req);
  if (rawBearer && isApiKeyToken(rawBearer)) {
    try {
      const result = await authenticateApiKeyRequest(opts.req);
      user = result.user;
      viaApiKey = true;
      apiKeyScopes = result.scopes;
    } catch (err) {
      console.warn("[Auth] API key authentication failed:", err instanceof Error ? err.message : err);
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid, expired, or revoked API key" });
    }
  } else if (hasBearerToken(opts.req)) {
    try {
      user = await authenticateBearerRequest(opts.req);
    } catch (err) {
      console.warn("[Auth] Bearer authentication failed:", err instanceof Error ? err.message : err);
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid or expired bearer token" });
    }
  } else {
    try {
      const session = await resolveSession(opts.req);
      user = session.user;
      mfaPending = session.type === "mfa-pending";
    } catch {
      // Authentication is optional for public procedures.
      user = null;
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    mfaPending,
    viaApiKey,
    apiKeyScopes,
  };
}
