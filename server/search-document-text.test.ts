/**
 * W6: document full-text search (v1) — extracted OCR/smart-form text is
 * indexed as 'document' hits with documentId+disputeId linkage, scoped by the
 * existing visibility rules. Runs only with DATABASE_URL (embedded PG).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { search, invalidateSearchIndex } from "./search";

const DB_URL = process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

describeDb("document full-text search (DB)", () => {
  const sql = postgres(DB_URL!, { max: 1 });
  const run = Date.now();
  const disputeA = `w6doc-a-${run}`;
  const disputeB = `w6doc-b-${run}`;
  const docId = `w6doc-doc-${run}`;
  const anaId = `w6doc-ana-${run}`;
  const sfeId = `w6doc-sfe-${run}`;
  const userA = `w6doc-user-a-${run}`;
  const userB = `w6doc-user-b-${run}`;
  const UNIQUE_TERM = `zyxquarx${run}`;

  beforeAll(async () => {
    const mkDispute = (id: string, ref: string, owner: string) => sql.unsafe(
      `INSERT INTO disputes (id, "referenceNumber", "initiatingPartyId", "initiatingPartyType", "initiatingPartyName", "serviceType", "serviceDate", "patientState", "facilityState", "cptCodes", "billedAmount", "currentStep", "status")
       VALUES ($1, $2, $3, 'provider', 'Prov', 'emergency_medicine', now(), 'TX', 'TX', '[]', '100', 'STEP_01_OPEN_NEGOTIATION_INITIATED', 'open_negotiation')`,
      [id, ref, owner],
    );
    await mkDispute(disputeA, `W6DOCA-${run}`, userA);
    await mkDispute(disputeB, `W6DOCB-${run}`, userB);
    await sql.unsafe(
      `INSERT INTO dispute_documents (id, "disputeId", "documentType", "fileName", "uploadedBy")
       VALUES ($1, $2, 'eob', 'eob-scan.pdf', $3)`,
      [docId, disputeA, userA],
    );
    await sql.unsafe(
      `INSERT INTO document_analyses (id, "disputeId", "userId", "fileName", "fileType", status, "ocrText")
       VALUES ($1, $2, $3, 'eob-scan.pdf', 'pdf', 'completed', $4)`,
      [anaId, disputeA, userA, `Explanation of benefits ... ${UNIQUE_TERM} underpaid line item`],
    );
    await sql.unsafe(
      `INSERT INTO smart_form_extractions (id, "userId", "targetForm", "disputeId", "inputType", "inputPreview", "extractedFields", status)
       VALUES ($1, $2, 'generic', $3, 'text', $4, '{}', 'complete')`,
      [sfeId, userA, disputeA, `CMS-1500 extraction ${UNIQUE_TERM}smartform`],
    );
    invalidateSearchIndex();
  });

  afterAll(async () => {
    await sql.unsafe(`DELETE FROM smart_form_extractions WHERE id = $1`, [sfeId]);
    await sql.unsafe(`DELETE FROM document_analyses WHERE id = $1`, [anaId]);
    await sql.unsafe(`DELETE FROM dispute_documents WHERE id = $1`, [docId]);
    await sql.unsafe(`DELETE FROM disputes WHERE id IN ($1, $2)`, [disputeA, disputeB]);
    await sql.end();
  });

  it("matches OCR text and returns documentId+disputeId linkage (admin)", async () => {
    const r = await search({ q: UNIQUE_TERM, entityTypes: ["document"], userRole: "admin" });
    expect(r.hits.length).toBeGreaterThanOrEqual(1);
    const hit = r.hits.find(h => h.id === docId);
    expect(hit).toBeDefined();
    expect((hit!.item as any).disputeId).toBe(disputeA);
  });

  it("matches smart-form extraction content as a document hit", async () => {
    const r = await search({ q: `${UNIQUE_TERM}smartform`, entityTypes: ["document"], userRole: "admin" });
    expect(r.hits.some(h => h.id === `sfe:${sfeId}`)).toBe(true);
  });

  it("respects visibility scoping: unrelated user cannot see the hit", async () => {
    const asB = await search({ q: UNIQUE_TERM, entityTypes: ["document"], userId: userB, userRole: "user" });
    expect(asB.hits.find(h => h.id === docId)).toBeUndefined();
    const asA = await search({ q: UNIQUE_TERM, entityTypes: ["document"], userId: userA, userRole: "user" });
    expect(asA.hits.find(h => h.id === docId)).toBeDefined();
  });
});
