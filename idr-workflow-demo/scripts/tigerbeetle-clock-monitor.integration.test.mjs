import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(new URL("..", import.meta.url).pathname);
const monitorSource = resolve(repositoryRoot, "server/tigerbeetle-clock-monitor.ts");

function command(commandName, args, cwd) {
  execFileSync(commandName, args, { cwd, stdio: "pipe" });
}

function createMtlsMaterial(directory, { expiredServerCertificate = false, expiredClientCertificate = false } = {}) {
  const extensionPath = join(directory, "extensions.cnf");
  writeFileSync(extensionPath, "subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\n");
  command("openssl", ["genrsa", "-out", "ca.key", "2048"], directory);
  command("openssl", ["req", "-x509", "-new", "-nodes", "-key", "ca.key", "-sha256", "-days", "1", "-subj", "/CN=healthpoint-clock-monitor-test-ca", "-out", "ca.crt"], directory);
  command("openssl", ["genrsa", "-out", "server.key", "2048"], directory);
  command("openssl", ["req", "-new", "-key", "server.key", "-subj", "/CN=127.0.0.1", "-out", "server.csr"], directory);
  const serverCertificateArguments = expiredServerCertificate
    ? ["x509", "-req", "-in", "server.csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-out", "server.crt", "-days", "0", "-sha256", "-extfile", extensionPath]
    : ["x509", "-req", "-in", "server.csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-out", "server.crt", "-days", "1", "-sha256", "-extfile", extensionPath];
  command("openssl", serverCertificateArguments, directory);
  writeFileSync(extensionPath, "extendedKeyUsage=clientAuth\n");
  command("openssl", ["genrsa", "-out", "client.key", "2048"], directory);
  command("openssl", ["req", "-new", "-key", "client.key", "-subj", "/CN=healthpoint-clock-monitor-test-client", "-out", "client.csr"], directory);
  const clientCertificateArguments = expiredClientCertificate
    ? ["x509", "-req", "-in", "client.csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-out", "client.crt", "-days", "0", "-sha256", "-extfile", extensionPath]
    : ["x509", "-req", "-in", "client.csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-out", "client.crt", "-days", "1", "-sha256", "-extfile", extensionPath];
  command("openssl", clientCertificateArguments, directory);
  return {
    ca: join(directory, "ca.crt"),
    serverKey: join(directory, "server.key"),
    serverCert: join(directory, "server.crt"),
    clientKey: join(directory, "client.key"),
    clientCert: join(directory, "client.crt"),
  };
}

function prometheusResponse(value) {
  return JSON.stringify({ status: "success", data: { resultType: "vector", result: [{ metric: {}, value: [String(Math.floor(Date.now() / 1000)), String(value)] }] } });
}

async function startPrometheusFixture(material, scenario) {
  let connectionCount = 0;
  const server = https.createServer({
    key: readFileSync(material.serverKey),
    cert: readFileSync(material.serverCert),
    ca: readFileSync(material.ca),
    requestCert: true,
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
  }, (request, response) => {
    if (request.method !== "GET" || !request.url?.startsWith("/api/v1/query?")) {
      response.writeHead(404).end();
      return;
    }
    if (scenario.unavailable) {
      response.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ status: "error" }));
      return;
    }
    const query = new URL(request.url, "https://fixture.invalid").searchParams.get("query") ?? "";
    const value = query.includes("healthy_timing_targets") || query.includes("chrony_up")
      ? scenario.targets
      : query.includes("remote_references") || query.includes("chrony_tracking_remote_reference")
        ? scenario.remoteReferences
        : query.includes("clock_error_bound") || query.includes("healthpoint:chrony_clock_error_bound_seconds")
          ? scenario.clockErrorBound
          : query.includes("kernel_synchronization") || query.includes("node_timex_sync_status")
            ? scenario.kernelSynchronized
            : null;
    if (value === null) {
      response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ status: "error", error: "unrecognized test query" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" }).end(prometheusResponse(value));
  });
  server.on("secureConnection", socket => {
    connectionCount += 1;
    if (scenario.resetFirstTlsConnection && connectionCount === 1) socket.destroy();
  });
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, port: address.port };
}

function requestMetrics(port) {
  return new Promise((resolvePromise, reject) => {
    const request = http.get({ host: "127.0.0.1", port, path: "/metrics", timeout: 1000 }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolvePromise({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("metrics request timed out")));
  });
}

function waitForMonitorPort(child) {
  return new Promise((resolvePromise, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => reject(new Error(`monitor did not announce a listener: ${stderr}`)), 6_000);
    child.stdout.on("data", chunk => {
      stdout += chunk.toString("utf8");
      for (const line of stdout.split("\n")) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.event === "tigerbeetle_clock_monitor_started" && Number.isInteger(parsed.listen_port)) {
            clearTimeout(timer);
            resolvePromise(parsed.listen_port);
            return;
          }
        } catch { /* wait for a complete JSON line */ }
      }
    });
    child.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
    child.once("exit", code => {
      clearTimeout(timer);
      reject(new Error(`monitor exited before listener startup with code ${code}: ${stderr}`));
    });
  });
}

async function waitForState(port, state, timeoutMilliseconds = 6_000) {
  const marker = `healthpoint_tigerbeetle_clock_monitor_status{status="${state}"} 1`;
  let lastError = "monitor metrics not available";
  const attempts = Math.ceil(timeoutMilliseconds / 100);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await requestMetrics(port);
      if (response.status === 200 && response.body.includes(marker)) return response.body;
      lastError = response.body;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
  }
  throw new Error(`did not observe ${state}: ${lastError}`);
}

async function stop(child, server) {
  if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
  if (child.exitCode === null) await new Promise(resolvePromise => child.once("exit", resolvePromise));
  await new Promise(resolvePromise => server.close(resolvePromise));
}

async function startMonitor(name, scenario, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), `hp-clock-monitor-${name}-`));
  let fixture;
  let child;
  try {
    const material = createMtlsMaterial(directory, options);
    fixture = await startPrometheusFixture(material, scenario);
    child = spawn("pnpm", ["exec", "tsx", monitorSource], {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: "test",
        HEALTHPOINT_TIGERBEETLE_CLOCK_MONITOR_TEST_MODE: "true",
        HEALTHPOINT_TIGERBEETLE_MONITOR_ENV: "staging",
        PAYMENT_EXECUTION_MODE: "disabled",
        STAGING_PROMETHEUS_QUERY_URL: `https://127.0.0.1:${fixture.port}`,
        STAGING_PROMETHEUS_CA_PATH: material.ca,
        STAGING_PROMETHEUS_CLIENT_CERT_PATH: material.clientCert,
        STAGING_PROMETHEUS_CLIENT_KEY_PATH: material.clientKey,
        TIGERBEETLE_TIMING_TARGET_COUNT: "4",
        TIGERBEETLE_CLOCK_MONITOR_INTERVAL_SECONDS: options.fastPolling ? "1" : "15",
        TIGERBEETLE_CLOCK_MONITOR_WARNING_SECONDS: "0.025",
        TIGERBEETLE_CLOCK_MONITOR_PRECHECK_LIMIT_SECONDS: "0.05",
        TIGERBEETLE_CLOCK_MONITOR_LISTEN_ADDRESS: "127.0.0.1",
        TIGERBEETLE_CLOCK_MONITOR_LISTEN_PORT: "0",
      },
    });
    const monitorPort = await waitForMonitorPort(child);
    return { directory, fixture, child, monitorPort };
  } catch (error) {
    if (child && fixture) await stop(child, fixture.server);
    else if (fixture) await new Promise(resolvePromise => fixture.server.close(resolvePromise));
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

async function cleanupMonitor(context) {
  await stop(context.child, context.fixture.server);
  rmSync(context.directory, { recursive: true, force: true });
}

async function runScenario(name, scenario, expectedState, options = {}) {
  const context = await startMonitor(name, scenario, options);
  try {
    const output = await waitForState(context.monitorPort, expectedState);
    assert.match(output, new RegExp(`healthpoint_tigerbeetle_clock_monitor_status\\{status="${expectedState}"\\} 1`));
    if (expectedState === "telemetry_unavailable") assert.match(output, /healthpoint_tigerbeetle_clock_monitor_failures_total 1/);
  } finally {
    await cleanupMonitor(context);
  }
}

test("clock monitor exports healthy when all mTLS Prometheus timing gates are within the advisory bound", async () => {
  await runScenario("healthy", { targets: 4, remoteReferences: 1, clockErrorBound: 0.010, kernelSynchronized: 1 }, "healthy");
});

test("clock monitor exports at_risk before the 50 ms pre-check gate fails", async () => {
  await runScenario("at-risk", { targets: 4, remoteReferences: 1, clockErrorBound: 0.030, kernelSynchronized: 1 }, "at_risk");
});

test("clock monitor exports no_go when the Chrony bound exceeds 50 ms", async () => {
  await runScenario("no-go", { targets: 4, remoteReferences: 1, clockErrorBound: 0.051, kernelSynchronized: 1 }, "no_go");
});

test("clock monitor exports telemetry_unavailable when its mTLS Prometheus query returns an error", async () => {
  await runScenario("unavailable", { unavailable: true }, "telemetry_unavailable");
});

test("clock monitor exports telemetry_unavailable when the Prometheus server certificate is expired", async () => {
  await runScenario("expired-server-certificate", { targets: 4, remoteReferences: 1, clockErrorBound: 0.010, kernelSynchronized: 1 }, "telemetry_unavailable", { expiredServerCertificate: true });
});

test("clock monitor exports telemetry_unavailable when the mTLS client certificate is expired", async () => {
  await runScenario("expired-client-certificate", { targets: 4, remoteReferences: 1, clockErrorBound: 0.010, kernelSynchronized: 1 }, "telemetry_unavailable", { expiredClientCertificate: true });
});

test("clock monitor records an intermittent TLS socket failure and returns to healthy on the next successful poll", async () => {
  const context = await startMonitor("intermittent-tls-reset", { targets: 4, remoteReferences: 1, clockErrorBound: 0.010, kernelSynchronized: 1, resetFirstTlsConnection: true }, { fastPolling: true });
  try {
    const unavailable = await waitForState(context.monitorPort, "telemetry_unavailable");
    assert.match(unavailable, /healthpoint_tigerbeetle_clock_monitor_failures_total 1/);
    const healthy = await waitForState(context.monitorPort, "healthy", 7_000);
    assert.match(healthy, /healthpoint_tigerbeetle_clock_monitor_failures_total 1/);
  } finally {
    await cleanupMonitor(context);
  }
});
