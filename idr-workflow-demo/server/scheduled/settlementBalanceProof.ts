import type { Request, Response } from "express";
import { runDailySettlementBalanceProof } from "../settlement-proof";

/**
 * Daily controlled settlement proof endpoint. Route-level scheduledAuth provides
 * the production bearer-token gate; this handler additionally limits the date
 * format and relies on the proof table's unique date key for idempotency.
 */
export async function settlementBalanceProofHandler(req: Request, res: Response) {
  const requestedDate = typeof req.body?.proofDate === "string" ? req.body.proofDate : undefined;
  if (requestedDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    return res.status(400).json({ error: "proofDate must use YYYY-MM-DD" });
  }
  try {
    const result = await runDailySettlementBalanceProof(requestedDate);
    return res.status(result.duplicate ? 200 : 201).json({
      duplicate: result.duplicate,
      proof: result.proof,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Settlement balance proof failed";
    console.error("[settlement-proof] daily proof failed", { message });
    return res.status(503).json({ error: "Settlement balance proof was not generated", message });
  }
}
