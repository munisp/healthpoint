/**
 * W6: Da Vinci PAS live-transport tests.
 * EXECUTED-VERIFIED against a local mock FHIR server (node:http) — the PAS
 * Bundle is actually POSTed over HTTP and the receipt parsed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  submitViaPasHttp,
  pollPasStatusHttp,
  parsePasReceiptId,
  parsePasDecision,
  type PasConfig,
} from "./pas-adapter";

let server: Server;
let baseUrl: string;
let lastRequestBody: unknown = null;
let mode: "ok" | "error500" | "slow" = "ok";

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => {
      if (mode === "slow") return; // never respond → client timeout
      lastRequestBody = body ? JSON.parse(body) : null;
      if (mode === "error500") {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "payer exploded" }));
        return;
      }
      if (req.method === "POST" && req.url === "/$submit") {
        res.writeHead(200, { "Content-Type": "application/fhir+json" });
        res.end(JSON.stringify({ resourceType: "Parameters", id: "receipt-abc-123" }));
        return;
      }
      if (req.method === "GET" && req.url?.startsWith("/$status")) {
        res.writeHead(200, { "Content-Type": "application/fhir+json" });
        res.end(JSON.stringify({ resourceType: "ClaimResponse", outcome: "complete", disposition: "approved" }));
        return;
      }
      res.writeHead(404).end("{}");
    });
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise(r => server.close(r)));

const cfg = (over: Partial<PasConfig> = {}): PasConfig => ({
  paApi2027Enabled: true,
  davinciPasEndpoint: baseUrl,
  timeoutMs: 1000,
  ...over,
});

describe("submitViaPasHttp (EXECUTED-VERIFIED vs node:http mock FHIR server)", () => {
  it("POSTs the PAS bundle and parses the payer receipt id", async () => {
    mode = "ok";
    const r = await submitViaPasHttp({ id: "tx-1", urgency: "EXPEDITED" }, cfg());
    expect(r.status).toBe("SUBMITTED");
    if (r.status === "SUBMITTED") expect(r.receipt.receiptId).toBe("receipt-abc-123");
    // Verify the wire payload is the FHIR Bundle.
    const sent = lastRequestBody as Record<string, unknown>;
    expect(sent.resourceType).toBe("Bundle");
    expect((sent.entry as any[])[0].resource.priority.coding[0].code).toBe("urgent");
  });

  it("is BLOCKED (fail-closed, no network) when endpoint unconfigured", async () => {
    lastRequestBody = null;
    const r = await submitViaPasHttp({ id: "tx-2", urgency: "STANDARD" }, { paApi2027Enabled: true });
    expect(r.status).toBe("BLOCKED");
    expect(lastRequestBody).toBeNull(); // no request hit the server
  });

  it("is BLOCKED when the feature flag is off", async () => {
    const r = await submitViaPasHttp({ id: "tx-3", urgency: "STANDARD" }, cfg({ paApi2027Enabled: false }));
    expect(r.status).toBe("BLOCKED");
    if (r.status === "BLOCKED") expect(r.reason).toContain("PA_API_2027_ENABLED");
  });

  it("surfaces payer 5xx as ERROR (not a silent pending)", async () => {
    mode = "error500";
    const r = await submitViaPasHttp({ id: "tx-4", urgency: "STANDARD" }, cfg());
    expect(r.status).toBe("ERROR");
    if (r.status === "ERROR") expect(r.httpStatus).toBe(500);
    mode = "ok";
  });

  it("times out as ERROR when the payer never responds", async () => {
    mode = "slow";
    const r = await submitViaPasHttp({ id: "tx-5", urgency: "STANDARD" }, cfg({ timeoutMs: 300 }));
    expect(r.status).toBe("ERROR");
    mode = "ok";
  });
});

describe("pollPasStatusHttp (EXECUTED-VERIFIED vs mock)", () => {
  it("GETs $status and maps the adjudication decision", async () => {
    const r = await pollPasStatusHttp("receipt-abc-123", cfg());
    expect(r.reachable).toBe(true);
    expect(r.decision).toBe("approved");
  });
  it("is fail-closed when unconfigured", async () => {
    const r = await pollPasStatusHttp("x", { paApi2027Enabled: false });
    expect(r.reachable).toBe(false);
  });
});

describe("parsers", () => {
  it("parsePasReceiptId handles plain, FHIR Parameters, and garbage", () => {
    expect(parsePasReceiptId({ id: "r1" })).toBe("r1");
    expect(parsePasReceiptId({ receiptId: "r2" })).toBe("r2");
    expect(parsePasReceiptId({ resourceType: "Parameters", parameter: [{ name: "receiptId", valueString: "r3" }] })).toBe("r3");
    expect(parsePasReceiptId(null)).toBeNull();
    expect(parsePasReceiptId("junk")).toBeNull();
  });
  it("parsePasDecision maps common shapes", () => {
    expect(parsePasDecision({ decision: "approved" })).toBe("approved");
    expect(parsePasDecision({ status: "denied" })).toBe("denied");
    expect(parsePasDecision({ resourceType: "ClaimResponse", outcome: "complete", disposition: "approved" })).toBe("approved");
    expect(parsePasDecision({ status: "in-progress" })).toBe("pended");
    expect(parsePasDecision(null)).toBeUndefined();
  });
});
