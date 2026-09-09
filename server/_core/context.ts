import { TRPCError } from "@trpc/server";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { authenticateRequest } from "./keycloak";
import { authenticateBearerRequest, hasBearerToken } from "../auth/bearer";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  // Mobile app + headless API clients authenticate with a Keycloak Bearer
  // access token, verified server-side against the realm JWKS
  // (server/auth/bearer.ts). When an Authorization: Bearer header is present,
  // any verification failure rejects the request with 401 — there is NO
  // fall-through to the session cookie. Without a Bearer header, the existing
  // session-cookie flow applies unchanged (optional for public procedures).
  if (hasBearerToken(opts.req)) {
    try {
      user = await authenticateBearerRequest(opts.req);
    } catch (err) {
      console.warn("[Auth] Bearer authentication failed:", err instanceof Error ? err.message : err);
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid or expired bearer token" });
    }
  } else {
    try {
      user = await authenticateRequest(opts.req);
    } catch {
      // Authentication is optional for public procedures.
      user = null;
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
