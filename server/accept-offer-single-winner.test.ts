/**
 * server/accept-offer-single-winner.test.ts
 *
 * Regression: acceptOffer must be a single-winner operation. Before the fix it
 * did an unguarded read-then-update, so two concurrent (or double-fired)
 * acceptances each marked a different offer accepted and raced the
 * determination amount. Now a per-dispute advisory lock + status/accepted-offer
 * re-check inside the transaction guarantees exactly one winner.
 *
 * DB-backed: needs a migrated PostgreSQL (DATABASE_URL). Skips when absent so
 * CI without a database is unaffected (matches the repo's connectivity tests).
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { acceptOffer } from "./db";

const HAS_DB = !!process.env.DATABASE_URL;
const sql = HAS_DB ? postgres(process.env.DATABASE_URL!, { max: 4, onnotice: () => {} }) : (null as any);

async function seedDispute(): Promise<string> {
  const id = randomUUID();
  await sql`insert into disputes (id, "referenceNumber", "initiatingPartyType", "initiatingPartyName", "serviceType", "serviceDate", "patientState", "facilityState", "cptCodes", "billedAmount", status, "currentStep", "createdBy", "initiatingPartyId")
    values (${id}, ${'QA-' + id.slice(0, 8)}, 'provider', 'QA', 'emergency_medicine', now(), 'TX', 'TX', ${JSON.stringify(["99285"])}::jsonb, '1000.00', 'idr_initiated', 'STEP_09_OFFER_SUBMISSION', 'qa', 'qa')`;
  return id;
}

describe.skipIf(!HAS_DB)("acceptOffer single-winner guard (DB-backed)", () => {
  afterAll(async () => { if (sql) await sql.end(); });

  it("marks exactly one offer accepted when two are accepted concurrently", async () => {
    const d = await seedDispute();
    const o1 = randomUUID(), o2 = randomUUID();
    await sql`insert into dispute_offers (id,"disputeId","offerType",amount,"submittedBy") values
      (${o1},${d},'responding_party','300.00','qa'),(${o2},${d},'responding_party','900.00','qa')`;
    const results = await Promise.allSettled([
      acceptOffer(d, o1, "qa", "QA"),
      acceptOffer(d, o2, "qa", "QA"),
    ]);
    const fulfilled = results.filter(r => r.status === "fulfilled").length;
    const accepted = Number((await sql`select count(*) c from dispute_offers where "disputeId"=${d} and "isAccepted"=true`)[0].c);
    expect(accepted).toBe(1);
    expect(fulfilled).toBe(1); // exactly one winner; the other rejects with CONFLICT
  });

  it("rejects a second acceptance once the dispute is resolved", async () => {
    const d = await seedDispute();
    const o1 = randomUUID();
    await sql`insert into dispute_offers (id,"disputeId","offerType",amount,"submittedBy") values (${o1},${d},'responding_party','500.00','qa')`;
    await acceptOffer(d, o1, "qa", "QA");
    await expect(acceptOffer(d, randomUUID(), "qa", "QA")).rejects.toMatchObject({ code: "CONFLICT" });
    const accepted = Number((await sql`select count(*) c from dispute_offers where "disputeId"=${d} and "isAccepted"=true`)[0].c);
    expect(accepted).toBe(1);
  });
});
