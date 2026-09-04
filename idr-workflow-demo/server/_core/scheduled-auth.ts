import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

function validSecret(value: string): boolean {
  return value.length >= 32 && !/^(?:dev|test|local|change-?me|example)/i.test(value);
}

function constantTimeTokenMatch(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return providedBytes.length === expectedBytes.length && crypto.timingSafeEqual(providedBytes, expectedBytes);
}

/** Platform-independent scheduler endpoint guard. */
export function createScheduledAuth(isProduction: boolean, scheduledSecret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isProduction) return next();
    if (!validSecret(scheduledSecret)) {
      res.status(503).json({ error: "Scheduled operation authorization is not configured" });
      return;
    }
    const authorization = req.header("authorization") ?? "";
    if (!authorization.startsWith("Bearer ") || !constantTimeTokenMatch(authorization.slice(7), scheduledSecret)) {
      res.status(401).json({ error: "Scheduled-operation bearer token required" });
      return;
    }
    next();
  };
}
