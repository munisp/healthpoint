import { metrics } from "@opentelemetry/api";

/**
 * Bounded lifecycle telemetry for the read-only TigerBeetle mTLS boundary.
 *
 * The adapter supervises one local stunnel process and creates one native client
 * per explicit read-only probe. It is not an application-managed connection pool;
 * these metrics make that distinction observable without recording endpoints,
 * certificates, account IDs, tenants, transfers, error strings, or process IDs.
 */

export type TigerBeetleTunnelStopReason = "graceful_stop" | "startup_failure" | "unexpected_exit";
export type TigerBeetleReadProbeOutcome = "ok" | "error" | "timeout";

type LifecycleSnapshot = {
  activeTunnels: number;
  activeReadClients: number;
  maxActiveReadClients: number;
  tunnelStarts: number;
  tunnelUnexpectedExits: number;
  readClientsCreated: number;
  readClientsDestroyed: number;
  readProbeOk: number;
  readProbeError: number;
  readProbeTimeout: number;
};

const meter = metrics.getMeter("healthpoint.tigerbeetle.lifecycle");
const activeTunnelGauge = meter.createObservableGauge("healthpoint.tigerbeetle.tunnel.active", {
  description: "Active locally supervised TigerBeetle stunnel processes; bounded to zero or one by the adapter.",
});
const activeReadClientGauge = meter.createObservableGauge("healthpoint.tigerbeetle.read_client.active", {
  description: "In-flight explicit read-only TigerBeetle native clients; never a tenant- or account-labelled pool metric.",
});
const tunnelLifecycleCounter = meter.createCounter("healthpoint.tigerbeetle.tunnel.lifecycle.total", {
  description: "Bounded TigerBeetle stunnel lifecycle events by event and fixed stop reason.",
});
const readClientLifecycleCounter = meter.createCounter("healthpoint.tigerbeetle.read_client.lifecycle.total", {
  description: "Bounded creation and destruction events for explicit read-only TigerBeetle native clients.",
});
const readProbeCounter = meter.createCounter("healthpoint.tigerbeetle.read_probe.total", {
  description: "Read-only connectivity probe outcomes by bounded result; never labelled with an account or endpoint.",
});
const tunnelUptimeHistogram = meter.createHistogram("healthpoint.tigerbeetle.tunnel.uptime", {
  description: "Lifetime of a locally supervised TigerBeetle stunnel process before it stops or exits.",
  unit: "ms",
});

const state: LifecycleSnapshot = {
  activeTunnels: 0,
  activeReadClients: 0,
  maxActiveReadClients: 0,
  tunnelStarts: 0,
  tunnelUnexpectedExits: 0,
  readClientsCreated: 0,
  readClientsDestroyed: 0,
  readProbeOk: 0,
  readProbeError: 0,
  readProbeTimeout: 0,
};

activeTunnelGauge.addCallback(result => result.observe(state.activeTunnels));
activeReadClientGauge.addCallback(result => result.observe(state.activeReadClients));

function incrementOutcome(outcome: TigerBeetleReadProbeOutcome): void {
  if (outcome === "ok") state.readProbeOk += 1;
  else if (outcome === "error") state.readProbeError += 1;
  else state.readProbeTimeout += 1;
}

/** Records the beginning of an explicit attempt to start the single local tunnel. */
export function recordTigerBeetleTunnelStartAttempt(): void {
  state.tunnelStarts += 1;
  tunnelLifecycleCounter.add(1, { "healthpoint.event": "start_attempt" });
}

/** Marks the adapter-owned tunnel ready. A duplicate ready event is intentionally ignored. */
export function recordTigerBeetleTunnelReady(): void {
  if (state.activeTunnels === 1) return;
  state.activeTunnels = 1;
  tunnelLifecycleCounter.add(1, { "healthpoint.event": "ready" });
}

/** Marks the adapter-owned tunnel stopped and records a bounded uptime/stop reason. */
export function recordTigerBeetleTunnelStopped(reason: TigerBeetleTunnelStopReason, uptimeMs?: number): void {
  const wasActive = state.activeTunnels === 1;
  state.activeTunnels = 0;
  if (!wasActive && reason !== "startup_failure") return;
  if (reason === "unexpected_exit") state.tunnelUnexpectedExits += 1;
  tunnelLifecycleCounter.add(1, { "healthpoint.event": "stopped", "healthpoint.reason": reason });
  if (typeof uptimeMs === "number" && Number.isFinite(uptimeMs) && uptimeMs >= 0) {
    tunnelUptimeHistogram.record(uptimeMs, { "healthpoint.reason": reason });
  }
}

/** Records an explicit read-only native client and returns an idempotent release function. */
export function registerTigerBeetleReadClient(): () => void {
  state.activeReadClients += 1;
  state.maxActiveReadClients = Math.max(state.maxActiveReadClients, state.activeReadClients);
  state.readClientsCreated += 1;
  readClientLifecycleCounter.add(1, { "healthpoint.event": "created" });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.activeReadClients = Math.max(0, state.activeReadClients - 1);
    state.readClientsDestroyed += 1;
    readClientLifecycleCounter.add(1, { "healthpoint.event": "destroyed" });
  };
}

/** Records the bounded outcome of a non-mutating connectivity probe. */
export function recordTigerBeetleReadProbe(outcome: TigerBeetleReadProbeOutcome): void {
  incrementOutcome(outcome);
  readProbeCounter.add(1, { "healthpoint.outcome": outcome });
}

/** Snapshot for unit tests and local health diagnostics. It contains no external identifiers. */
export function getTigerBeetleLifecycleMetricsSnapshot(): Readonly<LifecycleSnapshot> {
  return { ...state };
}

/** Test isolation only; production code must use lifecycle events rather than resetting telemetry state. */
export function resetTigerBeetleLifecycleMetricsForTests(): void {
  state.activeTunnels = 0;
  state.activeReadClients = 0;
  state.maxActiveReadClients = 0;
  state.tunnelStarts = 0;
  state.tunnelUnexpectedExits = 0;
  state.readClientsCreated = 0;
  state.readClientsDestroyed = 0;
  state.readProbeOk = 0;
  state.readProbeError = 0;
  state.readProbeTimeout = 0;
}
