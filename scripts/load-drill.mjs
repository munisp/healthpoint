import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = (process.env.LOAD_DRILL_BASE_URL ?? "http://127.0.0.1:4174").replace(/\/$/, "");
const endpoint = process.env.LOAD_DRILL_ENDPOINT ?? "/api/health";
const requests = Number.parseInt(process.env.LOAD_DRILL_REQUESTS ?? "200", 10);
const concurrency = Number.parseInt(process.env.LOAD_DRILL_CONCURRENCY ?? "20", 10);
const maxErrorRate = Number.parseFloat(process.env.LOAD_DRILL_MAX_ERROR_RATE ?? "0.01");
const maxP95Ms = Number.parseFloat(process.env.LOAD_DRILL_MAX_P95_MS ?? "3000");

if (!Number.isInteger(requests) || requests < 1 || !Number.isInteger(concurrency) || concurrency < 1) {
  throw new Error("LOAD_DRILL_REQUESTS and LOAD_DRILL_CONCURRENCY must be positive integers");
}

function percentile(sorted, value) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * value) - 1))] ?? 0;
}

let cursor = 0;
const results = [];
async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= requests) return;
    const startedAt = performance.now();
    try {
      const response = await fetch(`${baseUrl}${endpoint}`, { headers: { "cache-control": "no-store" } });
      results.push({ ok: response.ok, status: response.status, durationMs: performance.now() - startedAt });
    } catch (error) {
      results.push({ ok: false, status: 0, durationMs: performance.now() - startedAt, error: error instanceof Error ? error.message : "network error" });
    }
  }
}

const startedAt = new Date();
await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, worker));
const durations = results.map(result => result.durationMs).sort((a, b) => a - b);
const failed = results.filter(result => !result.ok);
const report = {
  startedAt: startedAt.toISOString(),
  completedAt: new Date().toISOString(),
  baseUrl,
  endpoint,
  requests,
  concurrency,
  successfulRequests: results.length - failed.length,
  failedRequests: failed.length,
  errorRate: failed.length / results.length,
  latencyMs: {
    min: durations[0] ?? 0,
    p50: percentile(durations, 0.5),
    p95: percentile(durations, 0.95),
    max: durations.at(-1) ?? 0,
  },
  thresholds: { maxErrorRate, maxP95Ms },
};

const reportDir = process.env.LOAD_DRILL_OUTPUT_DIR ?? "/tmp/healthpoint-load-drills";
await mkdir(reportDir, { recursive: true });
const outputPath = resolve(reportDir, `load-drill-${startedAt.toISOString().replace(/[:.]/g, "-")}.json`);
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ ...report, outputPath }));

if (report.errorRate > maxErrorRate || report.latencyMs.p95 > maxP95Ms) {
  process.exitCode = 1;
}
