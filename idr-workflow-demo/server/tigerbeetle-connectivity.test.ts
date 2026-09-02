import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTigerBeetleTunnel, stopTigerBeetleTunnel, verifyTigerBeetleReadConnectivity } from "./tigerbeetle";

const enabled = process.env.TIGERBEETLE_ASSURANCE === "true";
const assuranceIt = enabled ? it : it.skip;

describe("configured TigerBeetle endpoint", () => {
  beforeAll(async () => {
    if (enabled) await startTigerBeetleTunnel();
  }, 15_000);

  afterAll(async () => {
    if (enabled) await stopTigerBeetleTunnel();
  });

  assuranceIt("uses mTLS through stunnel and performs only a read-only account lookup", async () => {
    const result = await verifyTigerBeetleReadConnectivity();
    expect(result.address).toBe("127.0.0.1:16001");
    expect(result.accountsReturned).toBeGreaterThanOrEqual(0);
  }, 20_000);
});
