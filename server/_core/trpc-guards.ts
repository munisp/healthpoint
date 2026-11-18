/**
 * server/_core/trpc-guards.ts
 *
 * Phase 24 Express-level guards mounted on /api/trpc BEFORE the tRPC handler
 * (server/_core/index.ts). tRPC over HTTP puts the procedure path(s) in the
 * URL's final path segment — comma-joined for batched calls
 * (/api/trpc/a.b,c.d?batch=1) — so both guards parse req.path.
 *
 * 1. trpcBatchSizeGuard (F3 / identity+api audit §10): batching is enabled
 *    (httpBatchLink) with no server-side batch-size cap, and the /api/trpc
 *    rate limiter counts a whole batch as ONE request — a batch of N
 *    amplifies N procedure executions per counted request. Reject batches
 *    larger than TRPC_MAX_BATCH_SIZE with 400 before any procedure runs.
 *
 * 2. ollamaActiveBackendGuard (F0 — INTERIM mitigation for the CRITICAL
 *    LLM key leak, data/llm audit §4): `ollama.activeBackend` is a
 *    publicProcedure returning resolveBackend() INCLUDING apiKey. The
 *    permanent fix (admin-only procedure + apiKey stripped) lives in the
 *    workstream-owned server/routers.ts and is staged separately; until it
 *    lands, this guard rejects any (batched or direct) call naming
 *    ollama.activeBackend unless the request carries a full admin session.
 *    Session-level roles are only "user"|"admin" (drizzle/schema.ts
 *    roleEnum), so "admin/staff" per the wave spec maps to the session
 *    admin role — the same bar as routers.ts's adminProcedure.
 */

import type { NextFunction, Request, Response } from "express";
import { resolveSession } from "./keycloak";

export const TRPC_MAX_BATCH_SIZE = 10;
export const GUARDED_PROCEDURE = "ollama.activeBackend";

/**
 * Procedure names targeted by this request (comma-joined when batched).
 *
 * Mirrors @trpc/server's express adapter exactly: the procedure path is the
 * LAST URL segment only (`req.path.slice(req.path.lastIndexOf("/") + 1)`),
 * comma-split for batched calls. Anything before the final "/" is the mount
 * prefix the adapter discards — parsing the entire req.path let an interior
 * segment shadow the real target (e.g. /api/trpc/x/ollama.activeBackend
 * resolved to the guarded procedure while the guard only saw "x"), so the
 * last segment must be extracted FIRST and only then comma-split.
 */
export function trpcProcedurePaths(req: Request): string[] {
  const lastSegment = req.path.slice(req.path.lastIndexOf("/") + 1);
  return lastSegment
    .split(",")
    .map(p => p.trim())
    .filter(Boolean);
}

/** F3: reject tRPC batches larger than TRPC_MAX_BATCH_SIZE. */
export function trpcBatchSizeGuard(req: Request, res: Response, next: NextFunction): void {
  const procedures = trpcProcedurePaths(req);
  if (procedures.length > TRPC_MAX_BATCH_SIZE) {
    res.status(400).json({
      error: `tRPC batch size ${procedures.length} exceeds the limit of ${TRPC_MAX_BATCH_SIZE} calls per request`,
    });
    return;
  }
  next();
}

/**
 * F0 (interim): ollama.activeBackend requires an authenticated admin session
 * until the procedure itself is restricted in routers.ts.
 *   - no/invalid or pre-MFA session → 401
 *   - non-admin role                → 403
 */
export async function ollamaActiveBackendGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!trpcProcedurePaths(req).includes(GUARDED_PROCEDURE)) {
    next();
    return;
  }
  let session: Awaited<ReturnType<typeof resolveSession>>;
  try {
    session = await resolveSession(req);
  } catch {
    res.status(401).json({ error: "Authentication required for ollama.activeBackend" });
    return;
  }
  if (session.type === "mfa-pending") {
    res.status(401).json({ error: "Authentication required for ollama.activeBackend" });
    return;
  }
  if (session.user.role !== "admin") {
    res.status(403).json({ error: "Admin role required for ollama.activeBackend" });
    return;
  }
  next();
}
