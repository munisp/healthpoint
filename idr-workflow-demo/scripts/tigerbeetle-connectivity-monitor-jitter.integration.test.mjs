import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import net from "node:net";
import test from "node:test";

const repositoryRoot = resolve(new URL("..", import.meta.url).pathname);
const monitorSource = resolve(repositoryRoot, "server/tigerbeetle-connectivity-monitor.ts");

async function freePort() {
  const server = net.createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise(resolvePromise => server.close(resolvePromise));
  return address.port;
}

function writeJitterTunnel(directory) {
  const executable = join(directory, "stunnel");
  writeFileSync(executable, `#!/usr/bin/env node
const fs = require("node:fs");
const net = require("node:net");
const config = fs.readFileSync(process.argv[2], "utf8");
const match = /^accept = (.+)$/m.exec(config);
if (!match) process.exit(64);
const separator = match[1].lastIndexOf(":");
const host = match[1].slice(0, separator).replace(/^\\[(.*)\\]$/, "$1");
const port = Number(match[1].slice(separator + 1));
const plan = (process.env.HEALTHPOINT_LOCAL_TUNNEL_PLAN || "pass,hold,drop:250").split(",");
let connectionNumber = 0;
const sockets = new Set();
const server = net.createServer(socket => {
  sockets.add(socket); socket.once("close", () => sockets.delete(socket));
  const action = plan[Math.min(connectionNumber, plan.length - 1)]; connectionNumber += 1;
  if (action.startsWith("drop:")) setTimeout(() => socket.destroy(), Number(action.slice(5))).unref();
});
server.listen(port, host);
function shutdown() { for (const socket of sockets) socket.destroy(); server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 1000).unref(); }
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
`);
  chmodSync(executable, 0o755);
}

function request(port, path) {
  return new Promise((resolvePromise, reject) => {
    const request = http.get({ host: "127.0.0.1", port, path, timeout: 1_000 }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolvePromise({ statusCode: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("monitor HTTP request timed out")));
  });
}

async function waitForNoGo(port) {
  const deadline = Date.now() + 14_000;
  let last = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await request(port, "/metrics");
      last = response.body;
      if (response.statusCode === 200
          && response.body.includes('healthpoint_tigerbeetle_connectivity_monitor_status{status="no_go"} 1')
          && response.body.includes('healthpoint_tigerbeetle_connectivity_monitor_probes_total{outcome="timeout"} 2')
          && response.body.includes('healthpoint_tigerbeetle_connectivity_monitor_probes_total{outcome="error"} 0')) return response;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
  }
  throw new Error(`jittered packet-loss monitor did not reach no-go: ${last}`);
}

async function stop(child) {
  if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
  if (child.exitCode === null) await new Promise(resolvePromise => child.once("exit", resolvePromise));
}

test("jittered packet loss and delayed socket reset remain bounded timeouts and meet the no-go alert condition", { timeout: 25_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "hp-connectivity-jitter-"));
  let child;
  try {
    const tunnelPort = await freePort();
    const monitorPort = await freePort();
    writeJitterTunnel(directory);
    for (const name of ["ca.crt", "client.crt", "client.key"]) writeFileSync(join(directory, name), "local-test-only\n", { mode: 0o400 });

    let stdout = "";
    let stderr = "";
    child = spawn("pnpm", ["exec", "tsx", monitorSource], {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: `${directory}:${process.env.PATH}`,
        HOME: process.env.HOME,
        NODE_ENV: "test",
        HEALTHPOINT_TIGERBEETLE_CONNECTIVITY_MONITOR_ENV: "staging",
        PAYMENT_EXECUTION_MODE: "disabled",
        TIGERBEETLE_FINALITY_EXECUTION: "false",
        TIGERBEETLE_ENABLED: "true",
        TIGERBEETLE_ADDRESS: `127.0.0.1:${tunnelPort}`,
        TIGERBEETLE_TLS_REMOTE_ADDRESS: "cluster.example.test:3000",
        TIGERBEETLE_TLS_SERVER_NAME: "cluster.example.test",
        TIGERBEETLE_CLUSTER_ID: "1",
        TIGERBEETLE_CA_PATH: join(directory, "ca.crt"),
        TIGERBEETLE_CLIENT_CERT_PATH: join(directory, "client.crt"),
        TIGERBEETLE_CLIENT_KEY_PATH: join(directory, "client.key"),
        TIGERBEETLE_CONNECTIVITY_MONITOR_INTERVAL_MS: "5000",
        TIGERBEETLE_CONNECTIVITY_MONITOR_PROBE_TIMEOUT_MS: "1000",
        TIGERBEETLE_CONNECTIVITY_MONITOR_FAILURE_THRESHOLD: "2",
        TIGERBEETLE_CONNECTIVITY_MONITOR_LISTEN_ADDRESS: "127.0.0.1",
        TIGERBEETLE_CONNECTIVITY_MONITOR_LISTEN_PORT: String(monitorPort),
        HEALTHPOINT_LOCAL_TUNNEL_PLAN: "pass,hold,drop:250",
      },
    });
    child.stdout.on("data", chunk => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });

    const metrics = await waitForNoGo(monitorPort);
    assert.match(metrics.body, /healthpoint_tigerbeetle_connectivity_monitor_failures_total 2/);
    const readiness = await request(monitorPort, "/readyz");
    assert.equal(readiness.statusCode, 503);
    assert.equal(readiness.body, "not-ready\n");
    const timeoutEvents = stderr.match(/\"outcome\":\"timeout\"/g) ?? [];
    assert.equal(timeoutEvents.length, 2);
    assert.doesNotMatch(stderr, /\"outcome\":\"error\"/);
    assert.doesNotMatch(stdout, /createTransfers|finality_transfer_submit/);

    // The critical PrometheusRule condition is the same status series asserted above.
    assert.match(metrics.body, /healthpoint_tigerbeetle_connectivity_monitor_status\{status="no_go"\} 1/);
  } finally {
    if (child) await stop(child);
    rmSync(directory, { recursive: true, force: true });
  }
});
