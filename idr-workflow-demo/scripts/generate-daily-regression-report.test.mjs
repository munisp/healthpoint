#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const reporter = resolve(root, "scripts/generate-daily-regression-report.mjs");
const fixture = resolve(root, "scripts/fixtures/daily-regression-report-window.json");

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, env: { ...process.env, ...options.env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", code => resolvePromise({ code, stdout, stderr }));
  });
}

const outputDir = await mkdtemp(join(tmpdir(), "healthpoint-daily-regression-report-"));
try {
  const result = await run(process.execPath, [reporter, "--fixture", fixture, "--output-dir", outputDir, "--window-hours", "24", "--dry-run"], {
    env: { HEALTHPOINT_REGRESSION_REPORT_DELIVERY: "none", GITHUB_TOKEN: "" },
  });
  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.event, "healthpoint_daily_regression_report");
  assert.equal(output.completedRuns, 2);
  assert.equal(output.successfulRuns, 1);
  assert.equal(output.failedRuns, 1);
  assert.equal(output.overall, "FAIL");
  assert.equal(output.deliveryAttempted, false);
  assert.equal(output.dryRun, true);

  const markdown = await readFile(join(outputDir, "daily-regression-report.md"), "utf8");
  assert.match(markdown, /# HealthPoint Daily CI Regression Report — FAIL/);
  assert.match(markdown, /\| 2 \| 1 \| 1 \| 0 \| 0 \| \*\*FAIL\*\* \|/);
  assert.match(markdown, /Daily protected regression/);
  assert.match(markdown, /Earlier protected regression/);
  assert.doesNotMatch(markdown, /GITHUB_TOKEN|HEALTHPOINT_.*TOKEN/i);

  const metrics = JSON.parse(await readFile(join(outputDir, "daily-regression-report.metrics.json"), "utf8"));
  assert.equal(metrics.workflowName, "Security gates");
  assert.equal(metrics.windowHours, 24);
  assert.equal(metrics.delivery, "none");
  assert.equal(metrics.overall, "FAIL");

  const blockedDelivery = await run(process.execPath, [reporter, "--fixture", fixture, "--output-dir", outputDir, "--deliver"], {
    env: { HEALTHPOINT_REGRESSION_REPORT_DELIVERY: "none" },
  });
  assert.equal(blockedDelivery.code, 1);
  assert.match(blockedDelivery.stderr, /delivery is requested but HEALTHPOINT_REGRESSION_REPORT_DELIVERY is none/);
  process.stdout.write("daily regression report tests: 2 passed\n");
} finally {
  await rm(outputDir, { recursive: true, force: true });
}
