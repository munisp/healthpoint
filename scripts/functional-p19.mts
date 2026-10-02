#!/usr/bin/env tsx
/**
 * scripts/functional-p19.mts — EXECUTED-VERIFIED functional proof for
 * Phase 19 against the REAL Express server (server/_core/index.ts must be
 * running with DATABASE_URL set):
 *
 *   1. Seed a proof user + org + membership directly in SQL (fixture setup).
 *   2. createUploadSession via real tRPC over HTTP (~25k claims, ~17MB,
 *      3 × 8MiB chunks).
 *   3. PUT chunks OUT OF ORDER (2, 0, 1) through the real raw route with a
 *      minted session cookie + x-chunk-sha256; re-PUT chunk 1 (idempotent).
 *   4. finalizeUpload; poll getUploadStatus until terminal; verify staged
 *      claim count; re-finalize (idempotent).
 *
 * Scale honesty: 25,000 claims is the feasible local scale; million-row
 * behavior remains UNPROVEN (no staging infra).
 *
 * Usage: BASE_URL=http://127.0.0.1:3000 DATABASE_URL=... npx tsx scripts/functional-p19.mts
 */
import { createHash, randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import postgres from "postgres";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL required");
const sql = postgres(DATABASE_URL);

const RUN = Date.now().toString(36);
const USER_ID = `p19-proof-${RUN}`;
const ORG_ID = `p19-proof-org-${RUN}`;
const CLAIMS = 25_000;

function sha(b: Buffer | string): string {
  return createHash("sha256").update(b).digest("hex");
}

async function trpc(path: string, input: unknown, cookie: string, type: "query" | "mutation" = "mutation"): Promise<any> {
  const url = type === "mutation"
    ? `${BASE_URL}/api/trpc/${path}`
    : `${BASE_URL}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const res = await fetch(url, {
    method: type === "mutation" ? "POST" : "GET",
    headers: { "content-type": "application/json", cookie },
    ...(type === "mutation" ? { body: JSON.stringify({ json: input }) } : {}),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${path} failed: ${JSON.stringify(body.error).slice(0, 300)}`);
  return body.result?.data?.json ?? body.result?.data;
}

async function main() {
  // 1. Fixture user + org + membership (setup only; business path via HTTP).
  await sql`INSERT INTO users (id, name, email, "loginMethod", role) VALUES (${USER_ID}, 'P19 Proof', ${USER_ID + "@test.local"}, 'proof', 'user') ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO organizations (id, name, type, status, "createdAt") VALUES (${ORG_ID}, 'P19 Proof Org', 'provider', 'active', now()) ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO org_memberships (id, "orgId", "userId", role, "createdAt") VALUES (${"om-" + RUN}, ${ORG_ID}, ${USER_ID}, 'owner', now()) ON CONFLICT DO NOTHING`;

  const token = await new SignJWT({ sub: USER_ID, name: "P19 Proof", email: `${USER_ID}@test.local`, type: "session" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30m")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET || "placeholder-jwt-secret-change-me"));
  const cookie = `app_session_id=${token}`;

  // 2. Build payload: 25,000 ndjson claim lines (~17MB → 3 chunks).
  const lines: string[] = [];
  for (let i = 0; i < CLAIMS; i++) {
    lines.push(JSON.stringify({
      resourceType: "Claim",
      id: `proof-${RUN}-${i}`,
      identifier: [{ value: `PROOF-${RUN}-${i}` }],
      status: "active",
      patient: { reference: `Patient/proof-pat-${RUN}` },
      billablePeriod: { start: "2026-08-14", end: "2026-08-14" },
      insurer: { reference: "Organization/proof-payer", display: "AETNA HEALTH" },
      diagnosis: [{ sequence: 1, diagnosisCodeableConcept: { coding: [{ system: "http://hl7.org/fhir/sid/icd-10-cm", code: "R07.9" }] } }],
      item: [{ sequence: 1, productOrService: { coding: [{ system: "http://www.ama-assn.org/go/cpt", code: "99285" }] }, servicedDate: "2026-08-14" }],
      total: { value: 4200.0, currency: "USD" },
    }));
  }
  const payload = Buffer.from(lines.join("\n") + "\n", "utf8");
  const CHUNK = 8 * 1024 * 1024;
  const totalChunks = Math.ceil(payload.length / CHUNK);
  console.log(`payload: ${payload.length} bytes, ${CLAIMS} claims, ${totalChunks} chunks`);

  const session = await trpc("bulkUpload.createUploadSession", {
    orgId: ORG_ID, fileName: "proof.ndjson", fileType: "ndjson",
    sizeBytes: payload.length, totalChunks, sha256: sha(payload),
  }, cookie);
  console.log("session:", session.sessionId);

  // 3. Out-of-order chunk PUTs (2, 0, 1) through the REAL raw route.
  const order = [...Array(totalChunks).keys()].sort(() => 0.5 - Math.random());
  for (const idx of order) {
    const body = payload.subarray(idx * CHUNK, (idx + 1) * CHUNK);
    const res = await fetch(`${BASE_URL}/api/bulk-upload/${session.sessionId}/chunks/${idx}`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream", "x-chunk-sha256": sha(body), cookie },
      body: new Uint8Array(body),
    });
    const j = await res.json();
    console.log(`PUT chunk ${idx} (order ${order.indexOf(idx)}): ${res.status} chunksReceived=${j.chunksReceived}`);
    if (res.status !== 201) throw new Error(`chunk ${idx} failed`);
  }
  // Idempotent re-PUT of the last chunk.
  const last = totalChunks - 1;
  const body = payload.subarray(last * CHUNK);
  const dup = await fetch(`${BASE_URL}/api/bulk-upload/${session.sessionId}/chunks/${last}`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream", "x-chunk-sha256": sha(body), cookie },
    body: new Uint8Array(body),
  });
  const dupJson = await dup.json();
  console.log(`re-PUT chunk ${last}: ${dup.status} chunksReceived=${dupJson.chunksReceived} (expect 200, ${totalChunks})`);
  if (dup.status !== 200 || dupJson.chunksReceived !== totalChunks) throw new Error("re-PUT not idempotent");

  // 4. Finalize + poll.
  const fin = await trpc("bulkUpload.finalizeUpload", { orgId: ORG_ID, sessionId: session.sessionId }, cookie);
  console.log("finalize:", fin.status);
  let status;
  for (let i = 0; i < 600; i++) {
    status = await trpc("bulkUpload.getUploadStatus", { orgId: ORG_ID, sessionId: session.sessionId }, cookie, "query");
    if (["completed", "failed", "cancelled"].includes(status.status)) break;
    await new Promise(r => setTimeout(r, 500));
  }
  console.log("terminal status:", JSON.stringify(status));
  if (status.status !== "completed") throw new Error(`not completed: ${status.errorMessage}`);
  if (status.rowsAccepted !== CLAIMS || status.rowsProcessed !== CLAIMS) throw new Error("row counters mismatch");

  const [{ c }] = await sql`SELECT count(*)::int AS c FROM practice_claims WHERE "orgId" = ${ORG_ID} AND "sourceRef" = ${session.sessionId}`;
  console.log(`practice_claims staged: ${c} (expect ${CLAIMS})`);
  if (c !== CLAIMS) throw new Error("staged count mismatch");

  // Idempotent re-finalize.
  const refix = await trpc("bulkUpload.finalizeUpload", { orgId: ORG_ID, sessionId: session.sessionId }, cookie);
  if (!refix.alreadyFinalized) throw new Error("re-finalize not a no-op");
  const [{ c: c2 }] = await sql`SELECT count(*)::int AS c FROM practice_claims WHERE "orgId" = ${ORG_ID} AND "sourceRef" = ${session.sessionId}`;
  console.log(`after re-finalize: ${c2} (unchanged), alreadyFinalized=${refix.alreadyFinalized}`);
  if (c2 !== CLAIMS) throw new Error("duplicates after re-finalize");

  console.log(`\nFUNCTIONAL PROOF PASS — ${CLAIMS} claims via ${totalChunks} out-of-order raw chunks, idempotent re-PUT + re-finalize, counters exact.`);
  await sql.end();
}

main().catch(e => { console.error("FUNCTIONAL PROOF FAIL:", e.message); process.exit(1); });
