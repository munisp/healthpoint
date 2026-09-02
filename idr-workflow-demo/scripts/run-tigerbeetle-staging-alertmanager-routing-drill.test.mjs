import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(new URL("..", import.meta.url).pathname);
const script = resolve(repositoryRoot, "scripts/run-tigerbeetle-staging-alertmanager-routing-drill.sh");

function execute(environment = {}, args = ["--execute"]) {
  return spawnSync("bash", [script, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 10_000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...environment },
  });
}

function expectRefusal(result, phrase) {
  assert.equal(result.status, 64, `expected guarded refusal; stdout=${result.stdout}; stderr=${result.stderr}`);
  assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(phrase));
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /STAGING_ALERTMANAGER_ROUTING_DRILL_INJECTED/);
}

test("routing drill defaults to a no-network dry run", () => {
  const result = execute({}, []);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /DRY_RUN: no Alertmanager, PagerDuty, Slack, Prometheus, Kubernetes, TigerBeetle, or payment endpoint will be contacted in dry-run mode/);
});

test("routing drill refuses execute mode without explicit operator opt-in", () => {
  expectRefusal(execute(), "HEALTHPOINT_STAGING_ALERT_ROUTING_DRILL=yes");
});

test("routing drill refuses a non-staging designation before certificate or network access", () => {
  expectRefusal(execute({ HEALTHPOINT_STAGING_ALERT_ROUTING_DRILL: "yes", HEALTHPOINT_STAGING_ENV: "production" }), "HEALTHPOINT_STAGING_ENV must equal staging");
});

test("routing drill refuses enabled payments before Alertmanager contact", () => {
  expectRefusal(execute({
    HEALTHPOINT_STAGING_ALERT_ROUTING_DRILL: "yes",
    HEALTHPOINT_STAGING_ENV: "staging",
    PAYMENT_EXECUTION_MODE: "enabled",
  }), "PAYMENT_EXECUTION_MODE must equal disabled");
});
