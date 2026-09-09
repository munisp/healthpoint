/**
 * Ledger Reconciliation Heartbeat Handler
 * Route: POST /api/scheduled/ledger-reconciliation
 *
 * Compares Postgres ledger balances with TigerBeetle balances per mirrored
 * dispute account and writes a `reconciliation_runs` audit row. Drift emits a
 * durable `ledger.drift_detected` outbox alert.
 *
 * Auth: scheduledAuth bearer middleware (same as the other scheduled routes);
 * in production the heartbeat cron-identity check runs additionally.
 * Idempotent: one run row per run key (default: one per UTC hour).
 */

import type { Request, Response } from "express";
import { ENV } from "../_core/env";
import { sdk } from "../_core/sdk";
import { runLedgerReconciliation } from "../reconciliation";

export async function ledgerReconciliationHandler(req: Request, res: Response) {
  if (ENV.isProduction) {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only endpoint" });
    } catch {
      return res.status(403).json({ error: "cron-only endpoint" });
    }
  }
  const runKey = typeof req.body?.runKey === "string" && /^[\w:.-]{1,128}$/.test(req.body.runKey) ? req.body.runKey : undefined;
  try {
    const result = await runLedgerReconciliation({ runKey, triggeredBy: "scheduled-endpoint" });
    return res.status(result.duplicate ? 200 : 201).json({
      duplicate: result.duplicate,
      run: result.run,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ledger reconciliation failed";
    console.error("[reconciliation] scheduled run failed", { message });
    return res.status(503).json({ error: "Ledger reconciliation was not completed", message });
  }
}
