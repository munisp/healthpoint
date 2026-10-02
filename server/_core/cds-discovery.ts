/**
 * server/_core/cds-discovery.ts
 *
 * CDS Hooks discovery endpoint (GET /cds-services) per the CDS Hooks spec:
 *   { services: [{ hook, id, title, description }] }
 * listing registered ACTIVE hooks from the cds_hooks table.
 *
 * Auth: when CDS_JWT_REQUIRED=true, requires a Bearer JWT signed with the
 * HS256 shared secret CDS_JWT_SECRET (the CDS Hooks mutual-auth deployment
 * pattern). Otherwise the endpoint is OPEN by design (documented) — hook
 * metadata is non-PHI and EHRs commonly fetch discovery before authorization.
 */
import type { Express, Request, Response } from "express";

export function registerCdsDiscovery(app: Express): void {
  app.get("/cds-services", async (req: Request, res: Response) => {
    try {
      if (process.env.CDS_JWT_REQUIRED === "true") {
        const auth = req.headers.authorization ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
        const secret = process.env.CDS_JWT_SECRET;
        if (!token || !secret) {
          res.status(401).json({ error: "unauthorized", error_description: "Bearer JWT (HS256, CDS_JWT_SECRET) required" });
          return;
        }
        try {
          const { jwtVerify } = await import("jose");
          await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ["HS256"] });
        } catch {
          res.status(401).json({ error: "unauthorized", error_description: "invalid CDS JWT" });
          return;
        }
      }
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) {
        res.status(503).json({ error: "unavailable", error_description: "Database unavailable" });
        return;
      }
      const { cdsHooks } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const rows = await db.select().from(cdsHooks).where(eq(cdsHooks.status, "active"));
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({
        services: rows.map(h => ({
          hook: h.hookId,
          id: h.id,
          title: h.title,
          description: h.description ?? "",
        })),
      });
    } catch (err) {
      console.error("[cds] discovery failed:", err);
      res.status(500).json({ error: "exception", error_description: "Failed to build the CDS discovery document" });
    }
  });
}
