import { afterEach, describe, expect, it } from "vitest";
import {
  getTigerBeetleConfiguration,
  startTigerBeetleTunnel,
  stopTigerBeetleTunnel,
  verifyTigerBeetleReadConnectivity,
} from "./tigerbeetle";

const runLive = process.env.HEALTHPOINT_RUN_TIGERBEETLE_MTLS_INTEGRATION === "true";
const requiredEnvironment = [
  "TIGERBEETLE_ADDRESS",
  "TIGERBEETLE_TLS_REMOTE_ADDRESS",
  "TIGERBEETLE_TLS_SERVER_NAME",
  "TIGERBEETLE_CLUSTER_ID",
  "TIGERBEETLE_CA_PATH",
  "TIGERBEETLE_CLIENT_CERT_PATH",
];

describe.skipIf(!runLive)("TigerBeetle mTLS read-only integration", () => {
  afterEach(async () => {
    await stopTigerBeetleTunnel();
  });

  it("establishes an explicitly configured mTLS tunnel and completes a read-only cluster probe", async () => {
    for (const name of requiredEnvironment) {
      expect(process.env[name], `${name} is required for a live mTLS integration test`).toBeTruthy();
    }
    expect(Boolean(process.env.TIGERBEETLE_CLIENT_KEY_PATH) !== Boolean(process.env.TIGERBEETLE_CLIENT_KEY_PEM)).toBe(true);

    const configuration = getTigerBeetleConfiguration();
    expect(configuration.localAddress).toMatch(/^(127\.0\.0\.1|\[::1\]):\d+$/);
    await startTigerBeetleTunnel();
    const result = await verifyTigerBeetleReadConnectivity(10_000);

    expect(result.address).toBe(configuration.localAddress);
    expect(result.accountsReturned).toBeGreaterThanOrEqual(0);
  }, 20_000);
});
