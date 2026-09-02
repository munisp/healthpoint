import { afterEach, describe, expect, it } from "vitest";
import {
  getTigerBeetleLifecycleMetricsSnapshot,
  recordTigerBeetleReadProbe,
  recordTigerBeetleTunnelReady,
  recordTigerBeetleTunnelStartAttempt,
  recordTigerBeetleTunnelStopped,
  registerTigerBeetleReadClient,
  resetTigerBeetleLifecycleMetricsForTests,
} from "./tigerbeetle-lifecycle-metrics";

afterEach(() => resetTigerBeetleLifecycleMetricsForTests());

describe("TigerBeetle lifecycle metrics", () => {
  it("bounds one adapter-owned tunnel and classifies an unexpected exit", () => {
    recordTigerBeetleTunnelStartAttempt();
    recordTigerBeetleTunnelReady();
    recordTigerBeetleTunnelReady();
    recordTigerBeetleTunnelStopped("unexpected_exit", 125);

    expect(getTigerBeetleLifecycleMetricsSnapshot()).toEqual({
      activeTunnels: 0,
      activeReadClients: 0,
      maxActiveReadClients: 0,
      tunnelStarts: 1,
      tunnelUnexpectedExits: 1,
      readClientsCreated: 0,
      readClientsDestroyed: 0,
      readProbeOk: 0,
      readProbeError: 0,
      readProbeTimeout: 0,
    });
  });

  it("tracks explicit read client concurrency and cannot underflow on double release", () => {
    const releaseFirst = registerTigerBeetleReadClient();
    const releaseSecond = registerTigerBeetleReadClient();
    releaseFirst();
    releaseFirst();
    releaseSecond();

    expect(getTigerBeetleLifecycleMetricsSnapshot()).toMatchObject({
      activeReadClients: 0,
      maxActiveReadClients: 2,
      readClientsCreated: 2,
      readClientsDestroyed: 2,
    });
  });

  it("classifies bounded read probe outcomes without retaining error detail", () => {
    recordTigerBeetleReadProbe("ok");
    recordTigerBeetleReadProbe("error");
    recordTigerBeetleReadProbe("timeout");

    expect(getTigerBeetleLifecycleMetricsSnapshot()).toMatchObject({
      readProbeOk: 1,
      readProbeError: 1,
      readProbeTimeout: 1,
    });
  });
});
