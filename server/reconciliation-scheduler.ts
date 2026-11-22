/**
 * server/reconciliation-scheduler.ts
 * In-process scheduler for the Postgres ↔ TigerBeetle ledger reconciliation
 * job (server/reconciliation.ts). Mirrors the single-flight interval pattern
 * of the outbox worker (server/outbox-worker.ts).
 *
 * Cadence is env-configurable via LEDGER_RECONCILIATION_INTERVAL_MINUTES
 * (default 60 = hourly; "0" or a negative value disables the in-process
 * scheduler, e.g. when an external cron drives
 * POST /api/scheduled/ledger-reconciliation instead). The run key defaults to
 * one row per UTC hour, so a shorter interval still persists at most one run
 * per hour and every tick is idempotent on reconciliation_runs."runKey".
 */

import { runLedgerReconciliation } from "./reconciliation";

const RAW_MINUTES = Number(process.env.LEDGER_RECONCILIATION_INTERVAL_MINUTES ?? 60);
const DISABLED = Number.isFinite(RAW_MINUTES) && RAW_MINUTES <= 0;
const INTERVAL_MS = Math.max(1, Number.isFinite(RAW_MINUTES) && RAW_MINUTES > 0 ? RAW_MINUTES : 60) * 60_000;

let timer: NodeJS.Timeout | undefined;
let running = false;

export async function runLedgerReconciliationOnce(): Promise<void> {
  if (running) return; // single-flight per process
  running = true;
  try {
    const result = await runLedgerReconciliation({ triggeredBy: "in-process-scheduler" });
    const run = result.run;
    if (run) {
      const log = run.status === "passed" ? console.info : console.warn;
      log("[reconciliation] scheduled run complete", {
        runKey: run.runKey,
        status: run.status,
        accountsCompared: run.accountsCompared,
        driftCount: run.driftCount,
        duplicate: result.duplicate,
      });
    }
  } catch (error) {
    // Fail-closed posture lives in runLedgerReconciliation (TB_LEDGER_REQUIRED);
    // a thrown LedgerIntegrityError is logged here so the interval keeps ticking.
    console.error("[reconciliation] scheduled run failed", error);
  } finally {
    running = false;
  }
}

export function startLedgerReconciliationScheduler(): void {
  if (timer || DISABLED) return;
  void runLedgerReconciliationOnce();
  timer = setInterval(() => void runLedgerReconciliationOnce(), INTERVAL_MS);
  timer.unref();
}

export function stopLedgerReconciliationScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = undefined;
}
