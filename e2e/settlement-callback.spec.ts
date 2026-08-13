import { expect, test, type APIRequestContext } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://idr_user:idr_pass123@127.0.0.1:5432/idr_demo";
const callbackKeyring = JSON.parse(process.env.SETTLEMENT_CALLBACK_KEYRING ?? "{}") as Record<string, string>;
const [callbackKeyId, callbackSecret] = Object.entries(callbackKeyring)[0] ?? [];
const mtlsFingerprint = (process.env.SETTLEMENT_MTLS_CLIENT_FINGERPRINTS ?? "").split(",")[0]?.replace(/[^A-Fa-f0-9]/g, "").toUpperCase();
const mtlsIngressToken = process.env.SETTLEMENT_MTLS_INGRESS_TOKEN;
const sql = postgres(databaseUrl, { max: 1 });
const disputeId = randomUUID();
const lifecycleDisputeId = randomUUID();
const lifecycleTransferId = randomUUID();
const lifecycleProviderTransferId = `provider-${randomUUID()}`;
const exceptionTransferId = randomUUID();
const proofDate = "2099-01-01";
const referenceNumber = `PW-${randomUUID().replace(/-/g, "").slice(0, 24)}`;

function sign(timestamp: string, body: string): string {
  if (!callbackSecret) throw new Error("SETTLEMENT_CALLBACK_SECRET is required for settlement E2E tests");
  return createHmac("sha256", callbackSecret).update(`${timestamp}.${body}`).digest("hex");
}

function callbackBody(overrides: Record<string, unknown> = {}) {
  return {
    provider: "mojaloop",
    eventId: randomUUID(),
    transferId: `transfer-${randomUUID()}`,
    disputeId,
    status: "settled",
    amountCents: 12_000,
    currency: "USD",
    occurredAt: new Date().toISOString(),
    signatureVersion: "v1",
    ...overrides,
  };
}

async function postSignedCallback(request: APIRequestContext, body: Record<string, unknown>, options: { timestamp?: string; signature?: string; eventHeader?: string } = {}) {
  const raw = JSON.stringify(body);
  const timestamp = options.timestamp ?? String(Date.now());
  return request.post("/api/settlement/callbacks", {
    headers: {
      "content-type": "application/json",
      "x-settlement-key-id": callbackKeyId,
      "x-settlement-timestamp": timestamp,
      "x-settlement-signature": options.signature ?? sign(timestamp, raw),
      "x-settlement-event-id": options.eventHeader ?? String(body.eventId),
      "x-settlement-mtls-verified": "true",
      "x-settlement-mtls-fingerprint": mtlsFingerprint ?? "",
      "x-settlement-ingress-token": mtlsIngressToken ?? "",
    },
    data: raw,
  });
}

function reportBody(overrides: Record<string, unknown> = {}) {
  return {
    provider: "mojaloop",
    reportId: randomUUID(),
    transferId: lifecycleTransferId,
    providerTransferId: lifecycleProviderTransferId,
    status: "settled",
    amountCents: 8_000,
    currency: "USD",
    reportedAt: new Date().toISOString(),
    ...overrides,
  };
}

async function postSignedReport(request: APIRequestContext, body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  const timestamp = String(Date.now());
  return request.post("/api/settlement/reports", {
    headers: {
      "content-type": "application/json",
      "x-settlement-key-id": callbackKeyId,
      "x-settlement-timestamp": timestamp,
      "x-settlement-signature": sign(timestamp, raw),
      "x-settlement-event-id": String(body.reportId),
      "x-settlement-mtls-verified": "true",
      "x-settlement-mtls-fingerprint": mtlsFingerprint ?? "",
      "x-settlement-ingress-token": mtlsIngressToken ?? "",
    },
    data: raw,
  });
}

test.beforeAll(async () => {
  expect(callbackSecret).toBeTruthy();
  expect(callbackKeyId).toBeTruthy();
  expect(mtlsFingerprint).toMatch(/^[A-F0-9]{64}$/);
  expect(mtlsIngressToken).toBeTruthy();
  await sql`INSERT INTO disputes (
    "id", "referenceNumber", "initiatingPartyId", "initiatingPartyType", "initiatingPartyName",
    "serviceType", "serviceDate", "patientState", "facilityState", "cptCodes", "billedAmount",
    "determinationAmount", "paidAmount", "currentStep", "status", "createdAt", "updatedAt"
  ) VALUES (
    ${disputeId}, ${referenceNumber}, 'e2e-provider', 'provider', 'Playwright Provider',
    'emergency_medicine', NOW(), 'NY', 'NY', ${JSON.stringify(["99285"])}::jsonb, '200.00',
    '120.00', '0.00', 'STEP_14_PAYMENT_DETERMINATION', 'payment_pending', NOW(), NOW()
  )`;
  await sql`INSERT INTO disputes (
    "id", "referenceNumber", "initiatingPartyId", "initiatingPartyType", "initiatingPartyName",
    "serviceType", "serviceDate", "patientState", "facilityState", "cptCodes", "billedAmount",
    "determinationAmount", "paidAmount", "currentStep", "status", "createdAt", "updatedAt"
  ) VALUES (
    ${lifecycleDisputeId}, ${`LC-${randomUUID().replace(/-/g, "").slice(0, 24)}`}, 'lifecycle-maker', 'provider', 'Lifecycle Provider',
    'emergency_medicine', NOW(), 'NY', 'NY', ${JSON.stringify(["99285"])}::jsonb, '100.00',
    '80.00', '0.00', 'STEP_14_PAYMENT_DETERMINATION', 'payment_pending', NOW(), NOW()
  )`;
  await sql`INSERT INTO settlement_transfers (
    "id", "disputeId", "provider", "providerTransferId", "amountCents", "currency", "status",
    "requestedBy", "requestedByName", "requestReason", "idempotencyKey", "authorizedAt", "submittedAt", "createdAt", "updatedAt"
  ) VALUES (
    ${lifecycleTransferId}, ${lifecycleDisputeId}, 'mojaloop', ${lifecycleProviderTransferId}, 8000, 'USD', 'submitted',
    'lifecycle-maker', 'Lifecycle Maker', 'Validated lifecycle E2E request', ${`e2e-${lifecycleTransferId}`}, NOW(), NOW(), NOW(), NOW()
  ), (
    ${exceptionTransferId}, ${lifecycleDisputeId}, 'mojaloop', ${`provider-${exceptionTransferId}`}, 4000, 'USD', 'submitted',
    'exception-maker', 'Exception Maker', 'Exception lifecycle E2E request', ${`e2e-${exceptionTransferId}`}, NOW(), NOW(), NOW(), NOW()
  )`;
});

test.afterAll(async () => {
  await sql`DELETE FROM event_log WHERE "aggregateId" = ${disputeId}`;
  await sql`DELETE FROM event_log WHERE "aggregateId" = ${lifecycleDisputeId}`;
  await sql`DELETE FROM settlement_balance_proofs WHERE "proofDate" = ${proofDate}`;
  await sql`DELETE FROM settlement_exception_reviews WHERE "reconciliationId" IN (SELECT id FROM settlement_reconciliations WHERE "transferId" IN (${lifecycleTransferId}, ${exceptionTransferId}))`;
  await sql`DELETE FROM settlement_reconciliations WHERE "transferId" IN (${lifecycleTransferId}, ${exceptionTransferId})`;
  await sql`DELETE FROM settlement_provider_reports WHERE "transferId" IN (${lifecycleTransferId}, ${exceptionTransferId})`;
  await sql`DELETE FROM settlement_approvals WHERE "transferId" IN (${lifecycleTransferId}, ${exceptionTransferId})`;
  await sql`DELETE FROM settlement_transfers WHERE "id" IN (${lifecycleTransferId}, ${exceptionTransferId})`;
  await sql`DELETE FROM settlement_callbacks WHERE "disputeId" = ${disputeId}`;
  await sql`DELETE FROM dispute_events WHERE "disputeId" = ${disputeId}`;
  await sql`DELETE FROM ledger_entries WHERE "disputeId" = ${disputeId}`;
  await sql`DELETE FROM ledger_accounts WHERE "disputeId" = ${disputeId}`;
  await sql`DELETE FROM disputes WHERE "id" = ${disputeId}`;
  await sql`DELETE FROM ledger_entries WHERE "disputeId" = ${lifecycleDisputeId}`;
  await sql`DELETE FROM ledger_accounts WHERE "disputeId" = ${lifecycleDisputeId}`;
  await sql`DELETE FROM disputes WHERE "id" = ${lifecycleDisputeId}`;
  await sql.end({ timeout: 5 });
});

test("rejects unsigned, stale, and header/body-mismatched callbacks before reconciliation", async ({ request }) => {
  const body = callbackBody();
  const raw = JSON.stringify(body);
  const unsigned = await request.post("/api/settlement/callbacks", { data: raw, headers: { "content-type": "application/json" } });
  expect(unsigned.status()).toBe(401);

  const staleTimestamp = String(Date.now() - 10 * 60 * 1000);
  const stale = await postSignedCallback(request, body, { timestamp: staleTimestamp });
  expect(stale.status()).toBe(401);

  const mismatched = await postSignedCallback(request, body, { eventHeader: randomUUID() });
  expect(mismatched.status()).toBe(400);
  const callbacks = await sql`SELECT count(*)::int AS count FROM settlement_callbacks WHERE "disputeId" = ${disputeId}`;
  expect(callbacks[0].count).toBe(0);
});

test("reconciles a signed settlement exactly once and preserves ledger/outbox invariants", async ({ request }) => {
  const body = callbackBody();
  const accepted = await postSignedCallback(request, body);
  expect(accepted.status()).toBe(202);
  const acceptedJson = await accepted.json();
  expect(acceptedJson.status).toBe("reconciled");

  const duplicate = await postSignedCallback(request, body);
  expect(duplicate.status()).toBe(200);
  await expect(duplicate.json()).resolves.toMatchObject({ status: "duplicate", ledgerEntryId: acceptedJson.ledgerEntryId });

  const dispute = await sql`SELECT "paidAmount", "currentStep" FROM disputes WHERE id = ${disputeId}`;
  expect(String(dispute[0].paidAmount)).toBe("120.00");
  expect(dispute[0].currentStep).toBe("STEP_15_PAYMENT_MADE");
  const entries = await sql`SELECT count(*)::int AS count FROM ledger_entries WHERE "disputeId" = ${disputeId}`;
  const callbacks = await sql`SELECT count(*)::int AS count FROM settlement_callbacks WHERE "disputeId" = ${disputeId}`;
  expect(entries[0].count).toBe(1);
  expect(callbacks[0].count).toBe(1);
  await expect.poll(async () => {
    const outbox = await sql`SELECT status FROM event_log WHERE "aggregateId" = ${disputeId} AND "eventType" = 'payment.settled'`;
    return outbox[0]?.status;
  }).toBe("delivered");
});

test("rejects an overpayment atomically and records an authenticated failed settlement without a ledger entry", async ({ request }) => {
  const overpayment = callbackBody({ amountCents: 1 });
  const rejected = await postSignedCallback(request, overpayment);
  expect(rejected.status()).toBe(409);

  const failed = callbackBody({ status: "failed", amountCents: 1 });
  const failedResponse = await postSignedCallback(request, failed);
  expect(failedResponse.status()).toBe(202);
  const failedCallback = await sql`SELECT status, "ledgerEntryId" FROM settlement_callbacks WHERE "providerEventId" = ${String(failed.eventId)}`;
  expect(failedCallback[0]).toMatchObject({ status: "failed", ledgerEntryId: null });
  const entries = await sql`SELECT count(*)::int AS count FROM ledger_entries WHERE "disputeId" = ${disputeId}`;
  expect(entries[0].count).toBe(1);
});

test("retires the legacy unauthenticated Mojaloop callback endpoint", async ({ request }) => {
  const response = await request.post("/api/mojaloop/callbacks/transfers", { data: { transferId: "legacy-transfer" } });
  expect(response.status()).toBe(410);
});

test("reconciles a signed provider report exactly once and records a matching independent reconciliation", async ({ request }) => {
  const body = reportBody();
  const accepted = await postSignedReport(request, body);
  expect(accepted.status()).toBe(202);
  await expect(accepted.json()).resolves.toMatchObject({ reconciliationStatus: "matched", transferStatus: "reconciled" });
  const duplicate = await postSignedReport(request, body);
  expect(duplicate.status()).toBe(200);
  const transfer = await sql`SELECT status, "settledAt", "reconciledAt" FROM settlement_transfers WHERE id = ${lifecycleTransferId}`;
  expect(transfer[0]).toMatchObject({ status: "reconciled" });
  expect(transfer[0].settledAt).toBeTruthy();
  const reconciliation = await sql`SELECT status FROM settlement_reconciliations WHERE "transferId" = ${lifecycleTransferId}`;
  expect(reconciliation[0]).toMatchObject({ status: "matched" });
});

test("persists a provider-report exception without changing the submitted transfer", async ({ request }) => {
  const body = reportBody({ transferId: exceptionTransferId, providerTransferId: `provider-${exceptionTransferId}`, amountCents: 3_999 });
  const response = await postSignedReport(request, body);
  expect(response.status()).toBe(409);
  await expect(response.json()).resolves.toMatchObject({ reconciliationStatus: "exception", transferStatus: "submitted" });
  const reconciliation = await sql`SELECT status, "exceptionReason" FROM settlement_reconciliations WHERE "transferId" = ${exceptionTransferId}`;
  expect(reconciliation[0].status).toBe("exception");
  expect(reconciliation[0].exceptionReason).toMatch(/amount/);
});

test("records a signed provider reversal as an immutable correcting entry", async ({ request }) => {
  const body = reportBody({ status: "reversed" });
  const response = await postSignedReport(request, body);
  expect(response.status()).toBe(202);
  await expect(response.json()).resolves.toMatchObject({ reconciliationStatus: "matched", transferStatus: "reconciled" });
  const dispute = await sql`SELECT "paidAmount" FROM disputes WHERE id = ${lifecycleDisputeId}`;
  expect(String(dispute[0].paidAmount)).toBe("0.00");
  const entries = await sql`SELECT "entryType" FROM ledger_entries WHERE "disputeId" = ${lifecycleDisputeId} ORDER BY "createdAt"`;
  expect(entries.map(entry => entry.entryType)).toEqual(["credit", "reversal"]);
});

test("generates an idempotent daily balance-proof and alerts on an unresolved reconciliation exception", async ({ request }) => {
  const created = await request.post("/api/scheduled/settlement-balance-proof", { data: { proofDate } });
  expect(created.status()).toBe(201);
  await expect(created.json()).resolves.toMatchObject({ duplicate: false, proof: { status: "failed", unresolvedExceptionCount: 1, ledgerMismatchCount: 0 } });
  const duplicate = await request.post("/api/scheduled/settlement-balance-proof", { data: { proofDate } });
  expect(duplicate.status()).toBe(200);
  const proof = await sql`SELECT status, "unresolvedExceptionCount", "evidenceHash" FROM settlement_balance_proofs WHERE "proofDate" = ${proofDate}`;
  expect(proof[0]).toMatchObject({ status: "failed", unresolvedExceptionCount: 1 });
  expect(proof[0].evidenceHash).toMatch(/^[a-f0-9]{64}$/);
  const review = await sql`SELECT status FROM settlement_exception_reviews WHERE "reconciliationId" IN (SELECT id FROM settlement_reconciliations WHERE "transferId" = ${exceptionTransferId})`;
  expect(review[0]).toMatchObject({ status: "open" });
});
