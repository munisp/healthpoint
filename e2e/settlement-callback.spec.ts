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
});

test.afterAll(async () => {
  await sql`DELETE FROM event_log WHERE "aggregateId" = ${disputeId}`;
  await sql`DELETE FROM settlement_callbacks WHERE "disputeId" = ${disputeId}`;
  await sql`DELETE FROM dispute_events WHERE "disputeId" = ${disputeId}`;
  await sql`DELETE FROM ledger_entries WHERE "disputeId" = ${disputeId}`;
  await sql`DELETE FROM ledger_accounts WHERE "disputeId" = ${disputeId}`;
  await sql`DELETE FROM disputes WHERE "id" = ${disputeId}`;
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
