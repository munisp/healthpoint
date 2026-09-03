import http from "node:http";
import {
  getTigerBeetleReadiness,
  isTigerBeetleEnabled,
  startTigerBeetleTunnel,
  stopTigerBeetleTunnel,
  verifyTigerBeetleReadConnectivity,
} from "./tigerbeetle";

type MonitorStatus = "starting" | "healthy" | "at_risk" | "no_go";
type ProbeOutcome = "success" | "timeout" | "error";

type MonitorConfig = {
  intervalMs: number;
  probeTimeoutMs: number;
  failureThreshold: number;
  listenAddress: string;
  listenPort: number;
};

type MonitorState = {
  status: MonitorStatus;
  lastEvaluationTimestampSeconds: number;
  lastSuccessTimestampSeconds: number;
  consecutiveFailures: number;
  failureCount: number;
  probeSuccessCount: number;
  probeTimeoutCount: number;
  probeErrorCount: number;
  lastProbeDurationSeconds: number;
};

const REQUIRED_ENVIRONMENT = "staging";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || value.includes("\0")) throw new Error(`REFUSED: ${name} is required`);
  return value;
}

function parseBoundedInteger(name: string, minimum: number, maximum: number, fallback?: number): number {
  const raw = process.env[name]?.trim() || (fallback === undefined ? "" : String(fallback));
  if (!/^\d+$/.test(raw)) throw new Error(`REFUSED: ${name} must be an integer`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`REFUSED: ${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function loadConfig(): MonitorConfig {
  if (requiredEnvironment("HEALTHPOINT_TIGERBEETLE_CONNECTIVITY_MONITOR_ENV") !== REQUIRED_ENVIRONMENT) {
    throw new Error("REFUSED: monitor environment must equal staging");
  }
  if (requiredEnvironment("PAYMENT_EXECUTION_MODE") !== "disabled") {
    throw new Error("REFUSED: PAYMENT_EXECUTION_MODE must equal disabled");
  }
  if (process.env.TIGERBEETLE_FINALITY_EXECUTION === "true") {
    throw new Error("REFUSED: TIGERBEETLE_FINALITY_EXECUTION must not be true for a read-only connectivity monitor");
  }
  if (!isTigerBeetleEnabled()) {
    throw new Error("REFUSED: TIGERBEETLE_ENABLED must equal true for the read-only connectivity monitor");
  }
  return {
    intervalMs: parseBoundedInteger("TIGERBEETLE_CONNECTIVITY_MONITOR_INTERVAL_MS", 5_000, 60_000, 15_000),
    probeTimeoutMs: parseBoundedInteger("TIGERBEETLE_CONNECTIVITY_MONITOR_PROBE_TIMEOUT_MS", 1_000, 30_000, 10_000),
    failureThreshold: parseBoundedInteger("TIGERBEETLE_CONNECTIVITY_MONITOR_FAILURE_THRESHOLD", 1, 10, 2),
    listenAddress: requiredEnvironment("TIGERBEETLE_CONNECTIVITY_MONITOR_LISTEN_ADDRESS"),
    listenPort: parseBoundedInteger("TIGERBEETLE_CONNECTIVITY_MONITOR_LISTEN_PORT", 1024, 65535),
  };
}

function nowSeconds(): number {
  return Date.now() / 1000;
}

function labels(values: Record<string, string>): string {
  const encoded = Object.entries(values)
    .map(([key, value]) => `${key}="${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\r|\n/g, "")}"`)
    .join(",");
  return `{${encoded}}`;
}

function statusMetrics(state: MonitorState): string {
  return (["starting", "healthy", "at_risk", "no_go"] as const)
    .map(status => `healthpoint_tigerbeetle_connectivity_monitor_status${labels({ status })} ${state.status === status ? 1 : 0}`)
    .join("\n");
}

function renderMetrics(state: MonitorState): string {
  return [
    "# HELP healthpoint_tigerbeetle_connectivity_monitor_status Current read-only staging TigerBeetle connectivity status; exactly one status label is 1.",
    "# TYPE healthpoint_tigerbeetle_connectivity_monitor_status gauge",
    statusMetrics(state),
    "# HELP healthpoint_tigerbeetle_connectivity_monitor_last_evaluation_timestamp_seconds Unix timestamp of the latest probe evaluation.",
    "# TYPE healthpoint_tigerbeetle_connectivity_monitor_last_evaluation_timestamp_seconds gauge",
    `healthpoint_tigerbeetle_connectivity_monitor_last_evaluation_timestamp_seconds ${state.lastEvaluationTimestampSeconds}`,
    "# HELP healthpoint_tigerbeetle_connectivity_monitor_last_success_timestamp_seconds Unix timestamp of the latest successful read-only probe.",
    "# TYPE healthpoint_tigerbeetle_connectivity_monitor_last_success_timestamp_seconds gauge",
    `healthpoint_tigerbeetle_connectivity_monitor_last_success_timestamp_seconds ${state.lastSuccessTimestampSeconds}`,
    "# HELP healthpoint_tigerbeetle_connectivity_monitor_consecutive_failures Current consecutive failed read-only probes.",
    "# TYPE healthpoint_tigerbeetle_connectivity_monitor_consecutive_failures gauge",
    `healthpoint_tigerbeetle_connectivity_monitor_consecutive_failures ${state.consecutiveFailures}`,
    "# HELP healthpoint_tigerbeetle_connectivity_monitor_failures_total Failed read-only probe evaluations since process start.",
    "# TYPE healthpoint_tigerbeetle_connectivity_monitor_failures_total counter",
    `healthpoint_tigerbeetle_connectivity_monitor_failures_total ${state.failureCount}`,
    "# HELP healthpoint_tigerbeetle_connectivity_monitor_probes_total Read-only TigerBeetle probe outcomes since process start.",
    "# TYPE healthpoint_tigerbeetle_connectivity_monitor_probes_total counter",
    `healthpoint_tigerbeetle_connectivity_monitor_probes_total${labels({ outcome: "success" })} ${state.probeSuccessCount}`,
    `healthpoint_tigerbeetle_connectivity_monitor_probes_total${labels({ outcome: "timeout" })} ${state.probeTimeoutCount}`,
    `healthpoint_tigerbeetle_connectivity_monitor_probes_total${labels({ outcome: "error" })} ${state.probeErrorCount}`,
    "# HELP healthpoint_tigerbeetle_connectivity_monitor_last_probe_duration_seconds Duration of the latest read-only probe attempt.",
    "# TYPE healthpoint_tigerbeetle_connectivity_monitor_last_probe_duration_seconds gauge",
    `healthpoint_tigerbeetle_connectivity_monitor_last_probe_duration_seconds ${state.lastProbeDurationSeconds}`,
    "",
  ].join("\n");
}

function readinessBody(state: MonitorState): { statusCode: number; body: string } {
  if (state.status === "healthy" || state.status === "at_risk") return { statusCode: 200, body: "ok\n" };
  return { statusCode: 503, body: "not-ready\n" };
}

function startMetricsServer(config: MonitorConfig, state: MonitorState): http.Server {
  return http.createServer((request, response) => {
    if (request.method !== "GET") { response.writeHead(405).end(); return; }
    if (request.url === "/metrics") {
      response.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8", "cache-control": "no-store" });
      response.end(renderMetrics(state));
      return;
    }
    if (request.url === "/healthz") {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }).end("ok\n");
      return;
    }
    if (request.url === "/readyz") {
      const result = readinessBody(state);
      response.writeHead(result.statusCode, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }).end(result.body);
      return;
    }
    response.writeHead(404).end();
  }).listen(config.listenPort, config.listenAddress);
}

function classifyError(error: unknown): ProbeOutcome {
  const message = error instanceof Error ? error.message : String(error);
  return /timed out/i.test(message) ? "timeout" : "error";
}

async function evaluate(config: MonitorConfig, state: MonitorState): Promise<void> {
  const startedAt = Date.now();
  try {
    await startTigerBeetleTunnel();
    await verifyTigerBeetleReadConnectivity(config.probeTimeoutMs);
    state.lastEvaluationTimestampSeconds = nowSeconds();
    state.lastSuccessTimestampSeconds = state.lastEvaluationTimestampSeconds;
    state.lastProbeDurationSeconds = (Date.now() - startedAt) / 1000;
    state.probeSuccessCount += 1;
    state.consecutiveFailures = 0;
    state.status = "healthy";
    process.stdout.write(`${JSON.stringify({ event: "tigerbeetle_connectivity_monitor_probe", status: state.status, outcome: "success", duration_seconds: state.lastProbeDurationSeconds, observed_at: new Date().toISOString() })}\n`);
  } catch (error) {
    const outcome = classifyError(error);
    state.lastEvaluationTimestampSeconds = nowSeconds();
    state.lastProbeDurationSeconds = (Date.now() - startedAt) / 1000;
    state.failureCount += 1;
    state.consecutiveFailures += 1;
    if (outcome === "timeout") state.probeTimeoutCount += 1;
    else state.probeErrorCount += 1;
    state.status = state.consecutiveFailures >= config.failureThreshold ? "no_go" : "at_risk";
    const readiness = getTigerBeetleReadiness();
    process.stderr.write(`${JSON.stringify({ event: "tigerbeetle_connectivity_monitor_probe", status: state.status, outcome, consecutive_failures: state.consecutiveFailures, duration_seconds: state.lastProbeDurationSeconds, tunnel_state: readiness.state, reason_code: outcome === "timeout" ? "tigerbeetle_read_timeout" : "tigerbeetle_read_error", observed_at: new Date().toISOString() })}\n`);
  }
}

const config = loadConfig();
const state: MonitorState = {
  status: "starting",
  lastEvaluationTimestampSeconds: 0,
  lastSuccessTimestampSeconds: 0,
  consecutiveFailures: 0,
  failureCount: 0,
  probeSuccessCount: 0,
  probeTimeoutCount: 0,
  probeErrorCount: 0,
  lastProbeDurationSeconds: 0,
};
const server = startMetricsServer(config, state);
server.on("listening", () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.listenPort;
  process.stdout.write(`${JSON.stringify({ event: "tigerbeetle_connectivity_monitor_started", environment: REQUIRED_ENVIRONMENT, listen_address: config.listenAddress, listen_port: port, interval_ms: config.intervalMs, probe_timeout_ms: config.probeTimeoutMs, failure_threshold: config.failureThreshold })}\n`);
});

async function loop(): Promise<void> {
  await evaluate(config, state);
  setTimeout(() => { void loop(); }, config.intervalMs).unref();
}
void loop();

async function shutdown(signal: string): Promise<void> {
  process.stdout.write(`${JSON.stringify({ event: "tigerbeetle_connectivity_monitor_stopping", signal })}\n`);
  try {
    await stopTigerBeetleTunnel();
  } finally {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  }
}
process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
process.on("SIGINT", () => { void shutdown("SIGINT"); });
