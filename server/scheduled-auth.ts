import type { NextFunction, Request, Response } from "express";

type CronIdentity = { isCron?: boolean; taskUid?: string };
type CronAuthenticator = (req: Request) => Promise<CronIdentity>;

async function authenticatePlatformCron(req: Request): Promise<CronIdentity> {
  const { sdk } = await import("./_core/sdk");
  return sdk.authenticateRequest(req);
}

export function createScheduledAuth(
  isProduction: boolean,
  scheduledSecret: string,
  authenticateCron: CronAuthenticator = authenticatePlatformCron,
) {
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
    if (token === scheduledSecret) return next();

    res.status(401).json({ error: "Cron identity or scheduled-operation token required" });
  };
}
