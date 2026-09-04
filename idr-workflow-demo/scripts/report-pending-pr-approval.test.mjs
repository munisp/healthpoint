#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const reporter = resolve(root, "scripts/report-pending-pr-approval.mjs");
const fixture = resolve(root, "scripts/fixtures/pending-pr-approval.json");

function run(args, env = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [reporter, ...args], { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", code => resolvePromise({ code, stdout, stderr }));
  });
}

const outputDir = await mkdtemp(join(tmpdir(), "healthpoint-pr-review-reminder-"));
try {
  const result = await run(["--fixture", fixture, "--output-dir", outputDir], { HEALTHPOINT_PR_REVIEW_REMINDER_DELIVERY: "none" });
  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.event, "healthpoint_pending_pr_approval_report");
  assert.equal(output.status, "APPROVAL_PENDING");
  assert.equal(output.pendingApproval, true);
  assert.equal(output.independentApprovals, 0);
  assert.equal(output.failed, 0);
  assert.equal(output.pending, 0);
  assert.equal(output.deliveryAttempted, false);

  const markdown = await readFile(join(outputDir, "pending-pr-approval-report.md"), "utf8");
  assert.match(markdown, /# HealthPoint PR #2 Approval Status — APPROVAL_PENDING/);
  assert.match(markdown, /independent approving review/);
  assert.match(markdown, /Node quality and hermetic integration tests/);
  assert.match(markdown, /REVIEW_REQUIRED/);
  assert.doesNotMatch(markdown, /GITHUB_TOKEN|MATTERMOST_WEBHOOK/i);

  const metrics = JSON.parse(await readFile(join(outputDir, "pending-pr-approval-report.metrics.json"), "utf8"));
  assert.equal(metrics.status, "APPROVAL_PENDING");
  assert.equal(metrics.completed, 3);
  assert.equal(metrics.delivery, "none");

  const blockedDelivery = await run(["--fixture", fixture, "--output-dir", outputDir, "--deliver"], { HEALTHPOINT_PR_REVIEW_REMINDER_DELIVERY: "none" });
  assert.equal(blockedDelivery.code, 1);
  assert.match(blockedDelivery.stderr, /delivery requested while HEALTHPOINT_PR_REVIEW_REMINDER_DELIVERY is none/);
  process.stdout.write("pending PR approval reporter tests: 2 passed\n");
} finally {
  await rm(outputDir, { recursive: true, force: true });
}
