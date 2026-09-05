/**
 * server/reconciliation.ts
 * Scheduled reconciliation between the Postgres operational ledger
 * (ledger_accounts / settlement_transfers) and the authoritative TigerBeetle
 * ledger reached through the Go sidecar.
 *
 * For every dispute with settlement activity the job compares:
 *   posted — Postgres ledger "paid" account balance vs. the net posted balance
 *            (creditsPosted − debitsPosted) of the dispute's TigerBeetle
 *            provider_settlement account.
 *   pending — transfers holding funds (status submitted/accepted with a
 *            mirrored hold) vs. the TigerBeetle creditsPending on that account.
 *
 * Every run writes a `reconciliation_runs` audit row (idempotent per run key,
 * default one row per UTC hour; table created by migration
 * 0027_complete_lily_hollister). Drift emits a durable `ledger.drift_detected`
 * outbox alert event. When the sidecar is unreachable the run records status
 * "error"; with TB_LEDGER_REQUIRED=true it additionally throws so the caller
 * (scheduled endpoint) surfaces a failure instead of a silent skip.
 *
 * NOTE: reconciliation_runs is declared in drizzle/schema-reconciliation.ts
 * (separate module to avoid concurrent-edit conflicts on schema.ts) and
 * accessed here with raw SQL; keep the column list in sync with migration
 * 0027_complete_lily_hollister.
 */

import { createHash } from "crypto";
import { inArray, sql } from "drizzle-orm";
import { eventLog, ledgerAccounts, settlementTransfers } from "../drizzle/schema";
import { getDb } from "./db";
import { LedgerIntegrityError } from "./ledger";
import { diffLedgerAccount, type LedgerAccountDrift } from "./reconciliation-diff";
import {
  deriveTigerBeetleAccountId,
  getTigerBeetleLedgerConfig,
  lookupLedgerBalances,
  TigerBeetleLedgerUnavailableError,
} from "./tigerbeetle-ledger";

const BALANCE_LOOKUP_BATCH = 128;

// The drift comparison rules live in ./reconciliation-diff (pure, unit-tested).
export type ReconciliationDrift = LedgerAccountDrift;

export type ReconciliationRun = {
  id: string;
  runKey: string;
  status: string;
  tigerBeetleEnabled: boolean;
  accountsCompared: number;
  driftCount: number;
  drifts: ReconciliationDrift[];
  errorMessage: string | null;
  triggeredBy: string;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
};

export function defaultReconciliationRunKey(now = new Date()): string {
  // One audit row per UTC hour by default; schedulers may pass their own key.
  return `recon:${now.toISOString().slice(0, 13)}`;
}

type RawRunRow = {
  id: string;
  runKey: string;
  status: string;
  tigerBeetleEnabled: boolean;
  accountsCompared: number;
  driftCount: number;
  drifts: ReconciliationDrift[];
  errorMessage: string | null;
  triggeredBy: string;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
};

function toRun(row: RawRunRow): ReconciliationRun {
  return row;
}

export async function runLedgerReconciliation(input: {
  runKey?: string;
  triggeredBy?: string;
} = {}): Promise<{ duplicate: boolean; run: ReconciliationRun | null }> {
  const db = await getDb();
  if (!db) throw new LedgerIntegrityError("Database unavailable; ledger reconciliation was not run");
  const config = getTigerBeetleLedgerConfig();
  const runKey = input.runKey ?? defaultReconciliationRunKey();
  const triggeredBy = input.triggeredBy ?? "scheduled";
  const startedAt = new Date();

  const existingRows = await db.execute(sql`SELECT * FROM reconciliation_runs WHERE "runKey" = ${runKey} LIMIT 1`);
  const existing = (existingRows as unknown as RawRunRow[])[0];
  if (existing) return { duplicate: true, run: toRun(existing) };

  const writeRun = async (run: {
    status: "passed" | "drift" | "error" | "skipped";
    accountsCompared: number;
    drifts: ReconciliationDrift[];
    errorMessage?: string;
  }): Promise<ReconciliationRun | null> => {
    const now = new Date();
    const inserted = await db.execute(sql`
      INSERT INTO reconciliation_runs
        (id, "runKey", status, "tigerBeetleEnabled", "accountsCompared", "driftCount", drifts, "errorMessage", "triggeredBy", "startedAt", "completedAt", "createdAt")
      VALUES
        (${crypto.randomUUID()}, ${runKey}, ${run.status}, ${config.enabled}, ${run.accountsCompared}, ${run.drifts.length},
         ${JSON.stringify(run.drifts)}::jsonb, ${run.errorMessage ?? null}, ${triggeredBy}, ${startedAt}, ${now}, ${now})
      ON CONFLICT ("runKey") DO NOTHING
      RETURNING *`);
    const row = (inserted as unknown as RawRunRow[])[0];
    if (row) return toRun(row);
    // A concurrent run claimed this key first.
    const winner = await db.execute(sql`SELECT * FROM reconciliation_runs WHERE "runKey" = ${runKey} LIMIT 1`);
    const winnerRow = (winner as unknown as RawRunRow[])[0];
    return winnerRow ? toRun(winnerRow) : null;
  };

  if (!config.enabled) {
    const run = await writeRun({ status: "skipped", accountsCompared: 0, drifts: [], errorMessage: "TB_LEDGER_ENABLED is not true" });
    return { duplicate: false, run };
  }

  try {
    // Disputes with settlement activity are the ones mirrored to TigerBeetle.
    const transfers = await db.select().from(settlementTransfers);
    const disputeIds = [...new Set(transfers.map(transfer => transfer.disputeId))];

    const drifts: ReconciliationDrift[] = [];
    let accountsCompared = 0;

    for (let offset = 0; offset < disputeIds.length; offset += BALANCE_LOOKUP_BATCH) {
      const batch = disputeIds.slice(offset, offset + BALANCE_LOOKUP_BATCH);
      const providerAccountIds = batch.map(disputeId => deriveTigerBeetleAccountId(disputeId, "provider_settlement"));
      const balances = await lookupLedgerBalances(providerAccountIds, config);
      accountsCompared += balances.length;

      const pgAccounts = await db.select().from(ledgerAccounts).where(inArray(ledgerAccounts.disputeId, batch));
      for (let i = 0; i < batch.length; i++) {
        const disputeId = batch[i];
        const paidAccount = pgAccounts.find(account => account.disputeId === disputeId && account.accountType === "paid");
        const drift = diffLedgerAccount({
          disputeId,
          accountId: providerAccountIds[i],
          balance: balances[i],
          postgresPaidCents: paidAccount?.balanceCents ?? 0,
          transfers: transfers.filter(transfer => transfer.disputeId === disputeId),
        });
        if (drift) drifts.push(drift);
      }
    }

    const status = drifts.length > 0 ? "drift" : "passed";
    const run = await writeRun({ status, accountsCompared, drifts });

    if (drifts.length > 0) {
      const now = new Date();
      console.error(`[reconciliation] ledger drift detected in ${drifts.length} account(s)`, { runKey });
      await db.insert(eventLog).values({
        id: crypto.randomUUID(),
        topic: "idr.payments",
        eventType: "ledger.drift_detected",
        aggregateId: runKey,
        aggregateType: "reconciliation_run",
        payload: { runKey, driftCount: drifts.length, drifts: drifts.slice(0, 50) },
        metadata: { userId: "system", source: "ledger_reconciliation", timestamp: now.toISOString() },
        idempotencyKey: `ledger-drift:${createHash("sha256").update(runKey).digest("hex").slice(0, 32)}`,
        status: "pending",
        retryCount: 0,
        nextAttemptAt: now,
        createdAt: now,
      }).onConflictDoNothing();
    }
    return { duplicate: false, run };
  } catch (error) {
    const message = error instanceof Error ? error.message : "ledger reconciliation failed";
    const run = await writeRun({ status: "error", accountsCompared: 0, drifts: [], errorMessage: message.slice(0, 2000) });
    if (config.required && error instanceof TigerBeetleLedgerUnavailableError) {
      throw new LedgerIntegrityError(`Ledger reconciliation failed closed: ${message}`);
    }
    return { duplicate: false, run };
  }
}
