import { createHash } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { disputeEvents, disputes, eventLog, settlementCallbacks } from "../drizzle/schema";
import { getDb } from "./db";
import { recordPaymentInTransaction, LedgerIntegrityError } from "./ledger";
import { dispatchOutboxBatch } from "./outbox";

export const settlementCallbackSchema = z.object({
  provider: z.string().trim().min(2).max(64),
  eventId: z.string().trim().min(8).max(128),
  transferId: z.string().trim().min(3).max(128),
  disputeId: z.string().uuid(),
  status: z.enum(["settled", "failed"]),
  amountCents: z.number().int().positive().max(1_000_000_000),
  currency: z.literal("USD"),
  occurredAt: z.string().datetime({ offset: true }),
  signatureVersion: z.literal("v1").default("v1"),
});

export type SettlementCallbackInput = z.infer<typeof settlementCallbackSchema>;

function settlementOutboxKey(provider: string, eventId: string): string {
  return `settlement:${createHash("sha256").update(`${provider}:${eventId}`).digest("hex")}`;
}

function settlementLedgerKey(provider: string, eventId: string): string {
  // ledger_entries.idempotencyKey is varchar(64); retain 224 bits of SHA-256
  // entropy while reserving a recognizable prefix for audit investigations.
  return `settle:${createHash("sha256").update(`${provider}:${eventId}`).digest("hex").slice(0, 56)}`;
}

export async function reconcileAuthenticatedSettlementCallback(
  input: SettlementCallbackInput,
  rawPayload: Record<string, unknown>,
): Promise<{ duplicate: boolean; settlementCallbackId: string; ledgerEntryId: string | null }> {
  const db = await getDb();
  if (!db) throw new LedgerIntegrityError("Database unavailable; settlement callback was not reconciled");

  const result = await db.transaction(async tx => {
    // Serialize all settlement callbacks for one dispute. This lock is retained
    // for the callback, ledger, timeline, and outbox writes.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.disputeId}))`);
    const duplicate = await tx.select().from(settlementCallbacks).where(and(
      eq(settlementCallbacks.provider, input.provider),
      eq(settlementCallbacks.providerEventId, input.eventId),
    )).limit(1);
    if (duplicate[0]) {
      return { duplicate: true, settlementCallbackId: duplicate[0].id, ledgerEntryId: duplicate[0].ledgerEntryId };
    }

    const disputeRows = await tx.select().from(disputes).where(eq(disputes.id, input.disputeId)).limit(1);
    const dispute = disputeRows[0];
    if (!dispute) throw new LedgerIntegrityError("Settlement callback references an unknown dispute");

    const now = new Date();
    const callbackId = crypto.randomUUID();
    let ledgerEntryId: string | null = null;
    const outboxEventType = input.status === "settled" ? "payment.settled" : "payment.settlement_failed";

    if (input.status === "settled") {
      const entry = await recordPaymentInTransaction(
        tx,
        input.disputeId,
        input.amountCents,
        input.transferId,
        settlementLedgerKey(input.provider, input.eventId),
      );
      ledgerEntryId = entry.id;

      const wasPaymentDetermination = dispute.currentStep === "STEP_14_PAYMENT_DETERMINATION";
      if (wasPaymentDetermination) {
        await tx.update(disputes).set({
          currentStep: "STEP_15_PAYMENT_MADE",
          // The final administrative-fee and closing controls remain pending.
          status: "payment_pending",
          updatedAt: now,
        }).where(eq(disputes.id, input.disputeId));
        await tx.insert(disputeEvents).values({
          id: crypto.randomUUID(),
          disputeId: input.disputeId,
          step: "STEP_15_PAYMENT_MADE",
          previousStep: "STEP_14_PAYMENT_DETERMINATION",
          eventType: "settlement_callback_reconciled",
          description: `Authenticated ${input.provider} settlement callback reconciled for ${input.amountCents} cents.`,
          performedBy: "settlement-provider",
          performedByName: input.provider,
          metadata: { providerEventId: input.eventId, providerTransferId: input.transferId, ledgerEntryId: entry.id },
          createdAt: now,
        });
      }
    }

    await tx.insert(settlementCallbacks).values({
      id: callbackId,
      provider: input.provider,
      providerEventId: input.eventId,
      providerTransferId: input.transferId,
      disputeId: input.disputeId,
      amountCents: input.amountCents,
      currency: input.currency,
      status: input.status,
      occurredAt: new Date(input.occurredAt),
      signatureVersion: input.signatureVersion,
      rawPayload,
      ledgerEntryId,
      reconciliationNote: input.status === "settled" ? "Authenticated provider settlement reconciled" : "Authenticated provider reported settlement failure",
      reconciledAt: now,
      createdAt: now,
    });

    await tx.insert(eventLog).values({
      id: crypto.randomUUID(),
      topic: "idr.payments",
      eventType: outboxEventType,
      aggregateId: input.disputeId,
      aggregateType: "dispute",
      payload: {
        settlementCallbackId: callbackId,
        provider: input.provider,
        providerEventId: input.eventId,
        providerTransferId: input.transferId,
        amountCents: input.amountCents,
        currency: input.currency,
        status: input.status,
        ledgerEntryId,
      },
      metadata: { userId: "settlement-provider", timestamp: now.toISOString(), source: "authenticated_settlement_callback" },
      idempotencyKey: settlementOutboxKey(input.provider, input.eventId),
      status: "pending",
      retryCount: 0,
      nextAttemptAt: now,
      createdAt: now,
    });

    return { duplicate: false, settlementCallbackId: callbackId, ledgerEntryId };
  });

  // This is intentionally post-commit. A delivery problem leaves the durable
  // outbox row pending for the worker rather than rolling back settlement proof.
  if (!result.duplicate) await dispatchOutboxBatch(1);
  return result;
}
