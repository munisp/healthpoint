import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

type CronIdentity = { isCron?: boolean; taskUid?: string };
type CronAuthenticator = (req: Request) => Promise<CronIdentity>;

async function authenticatePlatformCron(req: Request): Promise<CronIdentity> {
  const { sdk } = await import("./_core/sdk");
  return sdk.authenticateRequest(req);
}

/**
 * Length-guarded constant-time comparison for the bearer fallback token.
 * timingSafeEqual throws on length mismatch, so lengths are checked first
 * (length itself is not secret).
 */
function scheduledTokenMatches(token: string, secret: string): boolean {
  if (!token || !secret) return false;
  const tokenBuf = Buffer.from(token, "utf8");
  const secretBuf = Buffer.from(secret, "utf8");
  if (tokenBuf.length !== secretBuf.length) return false;
  return timingSafeEqual(tokenBuf, secretBuf);
}

export function createScheduledAuth(
  isProduction: boolean,
  scheduledSecret: string,
  authenticateCron: CronAuthenticator = authenticatePlatformCron,
) {
  // Fail closed: scheduled endpoints must never run behind a default or empty
  // secret in production.
  if (isProduction && !scheduledSecret) {
    throw new Error("SCHEDULED_SECRET is required in production — refusing to initialize scheduled-endpoint auth without it");
  }
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!isProduction) return next();

    try {
      const user = await authenticateCron(req);
      if (user.isCron && user.taskUid) return next();
    } catch {
      // A controlled bearer fallback below supports operational invocation only.
    }

    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (scheduledTokenMatches(token, scheduledSecret)) return next();

    res.status(401).json({ error: "Cron identity or scheduled-operation token required" });
  };
}
