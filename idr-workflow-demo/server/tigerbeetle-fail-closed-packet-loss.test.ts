import { afterEach, describe, expect, it } from "vitest";
import net from "node:net";
import {
  getTigerBeetleLifecycleMetricsSnapshot,
  resetTigerBeetleLifecycleMetricsForTests,
} from "./tigerbeetle-lifecycle-metrics";
import {
  submitTigerBeetleFinalityTransfer,
  verifyTigerBeetleReadConnectivity,
} from "./tigerbeetle";

const READ_CONCURRENCY = 16;
const SUBMISSION_CONCURRENCY = 64;
const TEST_TIMEOUT_MS = 1_000;
const ENVIRONMENT_NAMES = [
  "TIGERBEETLE_ENABLED",
  "TIGERBEETLE_ADDRESS",
  "TIGERBEETLE_TLS_REMOTE_ADDRESS",
  "TIGERBEETLE_TLS_SERVER_NAME",
  "TIGERBEETLE_CLUSTER_ID",
  "TIGERBEETLE_CA_PATH",
  "TIGERBEETLE_CLIENT_CERT_PATH",
  "TIGERBEETLE_CLIENT_KEY_PATH",
  "TIGERBEETLE_CLIENT_KEY_PEM",
  "TIGERBEETLE_FINALITY_EXECUTION",
] as const;

const savedEnvironment = new Map(ENVIRONMENT_NAMES.map(name => [name, process.env[name]]));

afterEach(() => {
  for (const name of ENVIRONMENT_NAMES) {
    const value = savedEnvironment.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetTigerBeetleLifecycleMetricsForTests();
});

async function startBlackholeServer(): Promise<{ server: net.Server; close: () => Promise<void> }> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer(socket => {
    // Deliberately accept then withhold the protocol response. This is a local,
    // deterministic packet-loss/unresponsive-peer simulation; it never creates
    // a TigerBeetle account, transfer, settlement, or ledger mutation.
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("blackhole listener did not expose a TCP port");

  process.env.TIGERBEETLE_ADDRESS = `127.0.0.1:${address.port}`;
  process.env.TIGERBEETLE_TLS_REMOTE_ADDRESS = "cluster.example.test:3000";
  process.env.TIGERBEETLE_TLS_SERVER_NAME = "cluster.example.test";
  process.env.TIGERBEETLE_CLUSTER_ID = "1";
  process.env.TIGERBEETLE_CA_PATH = "/local-test/not-used-ca.pem";
  process.env.TIGERBEETLE_CLIENT_CERT_PATH = "/local-test/not-used-client.crt";
  process.env.TIGERBEETLE_CLIENT_KEY_PEM = "local-test-not-used-by-read-probe";

  return {
    server,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

describe("TigerBeetle fail-closed behavior under packet loss and concurrent pressure", () => {
  it("classifies unresponsive concurrent read probes as timeouts and releases every client", async () => {
    const blackhole = await startBlackholeServer();
    try {
      resetTigerBeetleLifecycleMetricsForTests();
      const results = await Promise.allSettled(
        Array.from({ length: READ_CONCURRENCY }, () => verifyTigerBeetleReadConnectivity(TEST_TIMEOUT_MS))
      );

      expect(results).toHaveLength(READ_CONCURRENCY);
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(0);
      for (const result of results) {
        expect(result.status).toBe("rejected");
        if (result.status === "rejected") {
          expect(String(result.reason)).toContain(`TigerBeetle read connectivity timed out after ${TEST_TIMEOUT_MS}ms`);
        }
      }

      const metrics = getTigerBeetleLifecycleMetricsSnapshot();
      expect(metrics.readProbeTimeout).toBe(READ_CONCURRENCY);
      expect(metrics.readProbeError).toBe(0);
      expect(metrics.readProbeOk).toBe(0);
      expect(metrics.activeReadClients).toBe(0);
      expect(metrics.readClientsCreated).toBe(READ_CONCURRENCY);
      expect(metrics.readClientsDestroyed).toBe(READ_CONCURRENCY);
      expect(metrics.maxActiveReadClients).toBe(READ_CONCURRENCY);
      expect(metrics.activeTunnels).toBe(0);
    } finally {
      await blackhole.close();
    }
  }, 10_000);

  it("rejects every concurrent finality submission before network/client initialization when execution is disabled", async () => {
    delete process.env.TIGERBEETLE_FINALITY_EXECUTION;
    delete process.env.TIGERBEETLE_ENABLED;

    const input = {
      id: 1001n,
      debitAccountId: 2001n,
      creditAccountId: 2002n,
      amountCents: 9007199254740993n,
      ledger: 1,
      code: 1,
    };
    const results = await Promise.allSettled(
      Array.from({ length: SUBMISSION_CONCURRENCY }, () => submitTigerBeetleFinalityTransfer(input, TEST_TIMEOUT_MS))
    );

    expect(results).toHaveLength(SUBMISSION_CONCURRENCY);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(0);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(String(result.reason)).toContain("TigerBeetle finality submission is disabled until an approved staging execution flag is explicitly set");
      }
    }

    const metrics = getTigerBeetleLifecycleMetricsSnapshot();
    expect(metrics.activeReadClients).toBe(0);
    expect(metrics.readClientsCreated).toBe(0);
    expect(metrics.activeTunnels).toBe(0);
  });
});
