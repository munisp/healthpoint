import { afterEach, describe, expect, it } from "vitest";
import { TigerBeetleConfigurationError, getTigerBeetleConfiguration, getTigerBeetleReadiness } from "./tigerbeetle";

const originalEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

describe("TigerBeetle transport configuration", () => {
  it("reports disabled readiness when the optional capability is not enabled", () => {
    delete process.env.TIGERBEETLE_ENABLED;
    expect(getTigerBeetleReadiness()).toEqual({ enabled: false, ready: false, state: "disabled" });
  });

  it("uses a loopback-only client address and the configured cluster identifier", () => {
    process.env.TIGERBEETLE_ADDRESS = "127.0.0.1:16001";
    process.env.TIGERBEETLE_CLUSTER_ID = "145851240909969808468846706535455565498";
    const config = getTigerBeetleConfiguration();
    expect(config.localAddress).toBe("127.0.0.1:16001");
    expect(config.clusterId).toBe(BigInt("145851240909969808468846706535455565498"));
  });

  it("rejects a direct remote TigerBeetle client address", () => {
    process.env.TIGERBEETLE_ADDRESS = "173.66.76.192:32052";
    expect(() => getTigerBeetleConfiguration()).toThrow(TigerBeetleConfigurationError);
  });

  it("rejects ambiguous client-key configuration", () => {
    process.env.TIGERBEETLE_CLIENT_KEY_PATH = "/secure/client.key";
    process.env.TIGERBEETLE_CLIENT_KEY_PEM = "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----";
    expect(() => getTigerBeetleConfiguration()).toThrow("Configure exactly one");
  });
});
