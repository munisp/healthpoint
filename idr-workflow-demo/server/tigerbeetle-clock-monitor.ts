import https from "node:https";
import http from "node:http";
import { existsSync, readFileSync } from "node:fs";

type MonitorStatus = "starting" | "healthy" | "at_risk" | "no_go" | "telemetry_unavailable";

type MonitorConfig = {
  queryUrl: URL;
  caPath: string;
  certPath: string;
  keyPath: string;
  expectedTargets: number;
  intervalSeconds: number;
  warningSeconds: number;
  precheckLimitSeconds: number;
  listenAddress: string;
  listenPort: number;
};

type MonitorState = {
  status: MonitorStatus;
  lastPollSuccessTimestampSeconds: number;
  lastEvaluationTimestampSeconds: number;
  clockErrorBoundSeconds: number;
  healthyTargets: number;
  kernelSynchronized: number;
  remoteReferences: number;
  failureCount: number;
};

const REQUIRED_ENVIRONMENT = "staging";
const ALLOWED_PRIVATE_HOST = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
const ROLE_SELECTOR = "application|cni|otel_collector|prometheus";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`REFUSED: ${name} is required`);
  return value;
}

function parsePositiveInteger(name: string, minimum: number, maximum: number): number {
  const value = requiredEnvironment(name);
  if (!/^\d+$/.test(value)) throw new Error(`REFUSED: ${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`REFUSED: ${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function parseExactSeconds(name: string, expected: number): number {
  const value = requiredEnvironment(name);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed !== expected) throw new Error(`REFUSED: ${name} must equal ${expected}`);
  return parsed;
}

function explicitTestFixtureMode(): boolean {
  return process.env.NODE_ENV === "test" && process.env.HEALTHPOINT_TIGERBEETLE_CLOCK_MONITOR_TEST_MODE === "true";
}

function validatePrivateHttpsUrl(value: string): URL {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  const privateHost = ALLOWED_PRIVATE_HOST.test(hostname) || hostname.endsWith(".svc.cluster.local") || hostname.endsWith(".internal");
  const loopbackFixtureHost = hostname === "127.0.0.1" || hostname === "::1" || hostname === "localhost";
  const permittedHost = privateHost || (explicitTestFixtureMode() && loopbackFixtureHost);
  if (url.protocol !== "https:" || !permittedHost || url.username || url.password || url.hash || url.search) {
    throw new Error("REFUSED: STAGING_PROMETHEUS_QUERY_URL must be a credential-free private HTTPS URL; loopback is allowed only in explicit NODE_ENV=test fixture mode");
  }
  return url;
}

function readOnlyFile(name: string): string {
  const path = requiredEnvironment(name);
  if (!existsSync(path)) throw new Error(`REFUSED: ${name} is not a readable file`);
  return path;
}

function loadConfig(): MonitorConfig {
  if (requiredEnvironment("HEALTHPOINT_TIGERBEETLE_MONITOR_ENV") !== REQUIRED_ENVIRONMENT) throw new Error("REFUSED: monitor environment must equal staging");
  if (requiredEnvironment("PAYMENT_EXECUTION_MODE") !== "disabled") throw new Error("REFUSED: PAYMENT_EXECUTION_MODE must equal disabled");
  return {
    queryUrl: validatePrivateHttpsUrl(requiredEnvironment("STAGING_PROMETHEUS_QUERY_URL")),
    caPath: readOnlyFile("STAGING_PROMETHEUS_CA_PATH"),
    certPath: readOnlyFile("STAGING_PROMETHEUS_CLIENT_CERT_PATH"),
    keyPath: readOnlyFile("STAGING_PROMETHEUS_CLIENT_KEY_PATH"),
    expectedTargets: parsePositiveInteger("TIGERBEETLE_TIMING_TARGET_COUNT", 4, 500),
    intervalSeconds: parsePositiveInteger("TIGERBEETLE_CLOCK_MONITOR_INTERVAL_SECONDS", explicitTestFixtureMode() ? 1 : 15, 60),
    warningSeconds: parseExactSeconds("TIGERBEETLE_CLOCK_MONITOR_WARNING_SECONDS", 0.025),
    precheckLimitSeconds: parseExactSeconds("TIGERBEETLE_CLOCK_MONITOR_PRECHECK_LIMIT_SECONDS", 0.05),
    listenAddress: requiredEnvironment("TIGERBEETLE_CLOCK_MONITOR_LISTEN_ADDRESS"),
    listenPort: parsePositiveInteger("TIGERBEETLE_CLOCK_MONITOR_LISTEN_PORT", explicitTestFixtureMode() ? 0 : 1024, 65535),
  };
}

function metricLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels).map(([key, value]) => `${key}="${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "")}"`);
  return entries.length ? `{${entries.join(",")}}` : "";
}

function nowSeconds(): number { return Date.now() / 1000; }

function statusMetric(state: MonitorState): string {
  return ["starting", "healthy", "at_risk", "no_go", "telemetry_unavailable"]
    .map(status => `healthpoint_tigerbeetle_clock_monitor_status${metricLabels({ status })} ${state.status === status ? 1 : 0}`)
    .join("\n");
}

function renderMetrics(state: MonitorState): string {
  return [
    "# HELP healthpoint_tigerbeetle_clock_monitor_status Current staging clock-audit status; one status label is 1.",
    "# TYPE healthpoint_tigerbeetle_clock_monitor_status gauge",
    statusMetric(state),
    "# HELP healthpoint_tigerbeetle_clock_monitor_last_poll_success_timestamp_seconds Unix timestamp of the last successful Prometheus evaluation.",
    "# TYPE healthpoint_tigerbeetle_clock_monitor_last_poll_success_timestamp_seconds gauge",
    `healthpoint_tigerbeetle_clock_monitor_last_poll_success_timestamp_seconds ${state.lastPollSuccessTimestampSeconds}`,
    "# HELP healthpoint_tigerbeetle_clock_monitor_last_evaluation_timestamp_seconds Unix timestamp of the latest evaluation attempt.",
    "# TYPE healthpoint_tigerbeetle_clock_monitor_last_evaluation_timestamp_seconds gauge",
    `healthpoint_tigerbeetle_clock_monitor_last_evaluation_timestamp_seconds ${state.lastEvaluationTimestampSeconds}`,
    "# HELP healthpoint_tigerbeetle_clock_monitor_clock_error_bound_seconds Maximum observed Chrony accuracy bound across required timing targets.",
    "# TYPE healthpoint_tigerbeetle_clock_monitor_clock_error_bound_seconds gauge",
    `healthpoint_tigerbeetle_clock_monitor_clock_error_bound_seconds ${state.clockErrorBoundSeconds}`,
    "# HELP healthpoint_tigerbeetle_clock_monitor_healthy_targets Count of healthy Chrony targets across required timing roles.",
    "# TYPE healthpoint_tigerbeetle_clock_monitor_healthy_targets gauge",
    `healthpoint_tigerbeetle_clock_monitor_healthy_targets ${state.healthyTargets}`,
    "# HELP healthpoint_tigerbeetle_clock_monitor_kernel_synchronized Whether all required timing targets have Linux kernel synchronization.",
    "# TYPE healthpoint_tigerbeetle_clock_monitor_kernel_synchronized gauge",
    `healthpoint_tigerbeetle_clock_monitor_kernel_synchronized ${state.kernelSynchronized}`,
    "# HELP healthpoint_tigerbeetle_clock_monitor_remote_references Whether all required timing targets retain approved remote Chrony references.",
    "# TYPE healthpoint_tigerbeetle_clock_monitor_remote_references gauge",
    `healthpoint_tigerbeetle_clock_monitor_remote_references ${state.remoteReferences}`,
    "# HELP healthpoint_tigerbeetle_clock_monitor_failures_total Failed read-only Prometheus evaluation attempts since this process started.",
    "# TYPE healthpoint_tigerbeetle_clock_monitor_failures_total counter",
    `healthpoint_tigerbeetle_clock_monitor_failures_total ${state.failureCount}`,
    "",
  ].join("\n");
}

function requestScalar(config: MonitorConfig, agent: https.Agent, name: string, query: string): Promise<number> {
  const url = new URL("/api/v1/query", config.queryUrl);
  url.searchParams.set("query", query);
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method: "GET", agent, timeout: 10_000 }, response => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode !== 200) return reject(new Error(`${name}: Prometheus returned HTTP ${response.statusCode}`));
        try {
          const parsed = JSON.parse(body);
          const result = parsed?.data?.result;
          if (parsed?.status !== "success" || parsed?.data?.resultType !== "vector" || !Array.isArray(result) || result.length !== 1) {
            return reject(new Error(`${name}: expected exactly one Prometheus vector result`));
          }
          const value = Number(result[0]?.value?.[1]);
          if (!Number.isFinite(value)) return reject(new Error(`${name}: received non-numeric Prometheus value`));
          resolve(value);
        } catch {
          reject(new Error(`${name}: Prometheus returned invalid JSON`));
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error(`${name}: Prometheus query timed out`)));
    request.on("error", error => reject(new Error(`${name}: ${error.message}`)));
    request.end();
  });
}

async function evaluate(config: MonitorConfig, agent: https.Agent, state: MonitorState): Promise<void> {
  const window = `${Math.max(config.intervalSeconds * 2, 120)}s`;
  const queries: Array<[string, string]> = [
    ["healthy_timing_targets", `sum(min_over_time(chrony_up{job="chrony-exporter",healthpoint_timing_role=~"${ROLE_SELECTOR}"}[${window}]))`],
    ["remote_references", `min(min_over_time(chrony_tracking_remote_reference{job="chrony-exporter",healthpoint_timing_role=~"${ROLE_SELECTOR}"}[${window}]))`],
    ["clock_error_bound", `max(max_over_time(healthpoint:chrony_clock_error_bound_seconds{healthpoint_timing_role=~"${ROLE_SELECTOR}"}[${window}]))`],
    ["kernel_synchronization", `min(min_over_time(node_timex_sync_status{job="node-exporter",healthpoint_timing_role=~"${ROLE_SELECTOR}"}[${window}]))`],
  ];
  const observed: Record<string, number> = {};
  for (const [name, query] of queries) observed[name] = await requestScalar(config, agent, name, query);
  state.lastEvaluationTimestampSeconds = nowSeconds();
  state.lastPollSuccessTimestampSeconds = state.lastEvaluationTimestampSeconds;
  state.healthyTargets = observed.healthy_timing_targets;
  state.remoteReferences = observed.remote_references;
  state.clockErrorBoundSeconds = observed.clock_error_bound;
  state.kernelSynchronized = observed.kernel_synchronization;
  state.status = observed.healthy_timing_targets !== config.expectedTargets || observed.remote_references !== 1 || observed.kernel_synchronization !== 1
    ? "no_go"
    : observed.clock_error_bound > config.precheckLimitSeconds
      ? "no_go"
      : observed.clock_error_bound > config.warningSeconds
        ? "at_risk"
        : "healthy";
  process.stdout.write(`${JSON.stringify({ event: "tigerbeetle_clock_monitor_evaluation", status: state.status, clock_error_bound_seconds: state.clockErrorBoundSeconds, healthy_targets: state.healthyTargets, remote_references: state.remoteReferences, kernel_synchronized: state.kernelSynchronized, observed_at: new Date().toISOString() })}\n`);
}

function startServer(config: MonitorConfig, state: MonitorState): http.Server {
  return http.createServer((request, response) => {
    if (request.method !== "GET") { response.writeHead(405).end(); return; }
    if (request.url === "/metrics") {
      response.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8", "cache-control": "no-store" });
      response.end(renderMetrics(state));
      return;
    }
    if (request.url === "/healthz" || request.url === "/readyz") {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      response.end("ok\n");
      return;
    }
    response.writeHead(404).end();
  }).listen(config.listenPort, config.listenAddress);
}

const config = loadConfig();
const state: MonitorState = {
  status: "starting",
  lastPollSuccessTimestampSeconds: 0,
  lastEvaluationTimestampSeconds: 0,
  clockErrorBoundSeconds: Number.NaN,
  healthyTargets: 0,
  kernelSynchronized: 0,
  remoteReferences: 0,
  failureCount: 0,
};
const agent = new https.Agent({
  ca: readFileSync(config.caPath),
  cert: readFileSync(config.certPath),
  key: readFileSync(config.keyPath),
  minVersion: "TLSv1.2",
  rejectUnauthorized: true,
});
const server = startServer(config, state);
server.on("listening", () => {
  const address = server.address();
  const listenPort = typeof address === "object" && address ? address.port : config.listenPort;
  process.stdout.write(`${JSON.stringify({ event: "tigerbeetle_clock_monitor_started", environment: REQUIRED_ENVIRONMENT, listen_address: config.listenAddress, listen_port: listenPort, interval_seconds: config.intervalSeconds })}\n`);
});

async function loop(): Promise<void> {
  try {
    await evaluate(config, agent, state);
  } catch (error) {
    state.lastEvaluationTimestampSeconds = nowSeconds();
    state.failureCount += 1;
    state.status = "telemetry_unavailable";
    process.stderr.write(`${JSON.stringify({ event: "tigerbeetle_clock_monitor_evaluation_failed", status: state.status, failure_count: state.failureCount, reason_code: "prometheus_query_failed", observed_at: new Date().toISOString() })}\n`);
  }
  setTimeout(() => { void loop(); }, config.intervalSeconds * 1000).unref();
}
void loop();

function shutdown(signal: string) {
  process.stdout.write(`${JSON.stringify({ event: "tigerbeetle_clock_monitor_stopping", signal })}\n`);
  agent.destroy();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
