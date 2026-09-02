import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(new URL("..", import.meta.url).pathname);
const analyzer = resolve(repositoryRoot, "scripts/analyze-tigerbeetle-local-alertmanager-routing.mjs");

function captureRecord(path) {
  return JSON.stringify({ path, body: "synthetic-local-routing-notification" });
}

function run(lines) {
  const directory = mkdtempSync(resolve(tmpdir(), "healthpoint-routing-log-test-"));
  const file = resolve(directory, "capture.jsonl");
  writeFileSync(file, `${lines.join("\n")}\n`, { mode: 0o600 });
  try {
    return spawnSync("node", [analyzer, "--capture", file], { cwd: repositoryRoot, encoding: "utf8" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const passingLines = [
  ...Array.from({ length: 5 }, () => captureRecord("/pagerduty-abort")),
  ...Array.from({ length: 5 }, () => captureRecord("/slack-abort")),
  captureRecord("/pagerduty-no-go"),
  captureRecord("/slack-no-go"),
  captureRecord("/slack-warning"),
];

test("local analyzer accepts the exact abort, no-go, and advisory routing contract", () => {
  const result = run(passingLines);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /TIGERBEETLE_LOCAL_ALERT_ROUTING_VALID/);
  assert.doesNotMatch(result.stdout, /synthetic-local-routing-notification/);
});

test("local analyzer rejects an unexpected advisory PagerDuty delivery", () => {
  const result = run([...passingLines, captureRecord("/pagerduty-warning")]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unexpected receiver path/);
  assert.doesNotMatch(result.stderr, /synthetic-local-routing-notification/);
});
