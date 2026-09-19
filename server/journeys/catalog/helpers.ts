/**
 * Shared helpers for journey catalog modules. All creation goes through real
 * tRPC callers (production code paths); raw SQL is used ONLY for the final
 * persistence re-read verification where no read procedure exists.
 */
import type { JourneyContext } from "../framework";

export interface CreatedDispute {
  id: string;
  referenceNumber: string;
}

/** Create a fresh dispute as the provider fixture user (namespaced by runId). */
export async function createJourneyDispute(
  ctx: JourneyContext,
  label: string,
  opts: { billedAmount?: string; patientState?: string; facilityState?: string } = {}
): Promise<CreatedDispute> {
  const dispute = await ctx.provider.disputes.create({
    initiatingPartyType: "provider",
    initiatingPartyName: `Journey Provider ${ctx.ns(label)}`,
    initiatingPartyNpi: "1234567893",
    respondingPartyType: "payer",
    respondingPartyName: `Journey Payer ${ctx.ns(label)}`,
    serviceType: "emergency_medicine",
    serviceDate: new Date(Date.now() - 14 * 86400_000).toISOString(),
    patientState: opts.patientState ?? "TX",
    facilityState: opts.facilityState ?? "TX",
    cptCodes: ["99285"],
    billedAmount: opts.billedAmount ?? "4200.00",
    notes: `journey ${label} run ${ctx.runId}`,
  });
  return { id: dispute.id, referenceNumber: dispute.referenceNumber };
}

/**
 * Move a fresh dispute through STEP_01..STEP_03 so it is IDR-initiable.
 * STEP_01 requires qpaAmount (workflow requiredFields), so a QPA offer row is
 * submitted first — the real path the UI uses.
 */
export async function advanceToNegotiationFailed(
  ctx: JourneyContext,
  disputeId: string
): Promise<void> {
  await ctx.provider.disputes.submitOffer({
    disputeId,
    offerType: "qpa",
    amount: "2600.00",
    rationale: "Median contracted rate disclosure (journey)",
  });
  await ctx.provider.disputes.advance({
    disputeId,
    newStep: "STEP_02_OPEN_NEGOTIATION_PERIOD",
    newStatus: "open_negotiation",
    description: "Open negotiation period started (journey)",
  });
  await ctx.provider.disputes.advance({
    disputeId,
    newStep: "STEP_03_OPEN_NEGOTIATION_FAILED",
    newStatus: "idr_initiated",
    description: "Open negotiation failed (journey)",
  });
}

/** STEP_03 → STEP_06 (IDR initiated, notice sent, entity selection). */
export async function advanceToEntitySelection(
  ctx: JourneyContext,
  disputeId: string
): Promise<void> {
  await ctx.provider.disputes.advance({
    disputeId,
    newStep: "STEP_04_IDR_INITIATED",
    newStatus: "idr_initiated",
    description: "IDR initiated within 4 business days (journey)",
  });
  await ctx.provider.disputes.advance({
    disputeId,
    newStep: "STEP_05_IDR_NOTICE_SENT",
    newStatus: "idr_initiated",
    description: "IDR notice sent (journey)",
  });
  await ctx.provider.disputes.advance({
    disputeId,
    newStep: "STEP_06_IDR_ENTITY_SELECTION",
    newStatus: "idr_entity_selection",
    description: "Joint certified IDR entity selection window (journey)",
  });
}

/** Expect a promise to reject with a tRPC error code; returns the message. */
export async function expectTrpcError(
  ctx: JourneyContext,
  promise: Promise<unknown>,
  code: string,
  label: string
): Promise<string> {
  ctx.assertionCount++;
  try {
    await promise;
  } catch (err) {
    const errCode = (err as { code?: string })?.code;
    if (errCode === code) return err instanceof Error ? err.message : String(err);
    throw new Error(
      `${label}: expected TRPCError ${code}, got ${err instanceof Error ? `${err.name}/${errCode}: ${err.message}` : String(err)}`
    );
  }
  throw new Error(`${label}: expected TRPCError ${code}, but the call succeeded`);
}
