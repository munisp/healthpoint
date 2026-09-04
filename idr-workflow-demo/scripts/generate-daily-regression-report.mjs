#!/usr/bin/env node
/**
 * Generate a daily HealthPoint CI regression report.
 *
 * Delivery is deliberately opt-in and fail-closed:
 * - matrix: requires a homeserver URL, room ID, and access token.
 * - mattermost: requires a complete incoming webhook URL.
 * - none: creates an artifact only; --deliver rejects this mode.
 *
 * Secrets are read exclusively from environment variables supplied by GitHub
 * Actions secrets. They are never written to the Markdown/JSON report or logs.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const VALID_DELIVERIES = new Set(["none", "matrix", "mattermost"]);
const MAX_RUNS = 100;
const REPORT_WORKFLOW_NAME = "Security gates";

function usage(message) {
  if (message) process.stderr.write(`ERROR: ${message}\n`);
  process.stderr.write("Usage: node scripts/generate-daily-regression-report.mjs [--fixture FILE] [--output-dir DIR] [--window-hours N] [--dry-run] [--deliver]\n");
  process.exit(message ? 2 : 0);
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  if (index === args.length - 1 || args[index + 1].startsWith("--")) usage(`${name} requires a value`);
  return args[index + 1];
}

function parseArguments() {
  const args = process.argv.slice(2).filter(argument => argument !== "--");
  const known = new Set(["--fixture", "--output-dir", "--window-hours", "--dry-run", "--deliver", "--help"]);
  for (const argument of args) {
    if (argument.startsWith("--") && !known.has(argument)) usage(`unknown option ${argument}`);
  }
  if (args.includes("--help")) usage();
  const windowHoursRaw = optionValue(args, "--window-hours") ?? "24";
  const windowHours = Number(windowHoursRaw);
  if (!Number.isInteger(windowHours) || windowHours < 1 || windowHours > 168) usage("--window-hours must be an integer between 1 and 168");
  return {
    fixture: optionValue(args, "--fixture"),
    outputDir: optionValue(args, "--output-dir") ?? "artifacts/daily-regression-report",
    windowHours,
    dryRun: args.includes("--dry-run"),
    deliver: args.includes("--deliver"),
  };
}

function requireNonEmpty(value, label) {
  if (!value || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function parseHttpsUrl(value, label) {
  const url = new URL(requireNonEmpty(value, label));
  if (url.protocol !== "https:") throw new Error(`${label} must use https`);
  if (url.username || url.password) throw new Error(`${label} must not embed credentials`);
  return url;
}

function normalizeRun(input) {
  if (!input || typeof input !== "object") throw new Error("workflow run must be an object");
  const conclusion = typeof input.conclusion === "string" ? input.conclusion : "unknown";
  const status = typeof input.status === "string" ? input.status : "unknown";
  const updatedAt = typeof input.updated_at === "string" ? input.updated_at : "unknown";
  const htmlUrl = typeof input.html_url === "string" && input.html_url.startsWith("https://") ? input.html_url : null;
  return {
    id: typeof input.id === "number" || typeof input.id === "string" ? String(input.id) : "unknown",
    name: typeof input.name === "string" ? input.name : "unnamed workflow",
    displayTitle: typeof input.display_title === "string" ? input.display_title : "untitled run",
    status,
    conclusion,
    event: typeof input.event === "string" ? input.event : "unknown",
    branch: typeof input.head_branch === "string" ? input.head_branch : "unknown",
    sha: typeof input.head_sha === "string" ? input.head_sha.slice(0, 12) : "unknown",
    updatedAt,
    htmlUrl,
  };
}

function parseFixture(input) {
  if (!input || typeof input !== "object") throw new Error("fixture must be a JSON object");
  const repository = requireNonEmpty(input.repository, "fixture.repository");
  const branch = requireNonEmpty(input.branch, "fixture.branch");
  const generatedAt = requireNonEmpty(input.generatedAt, "fixture.generatedAt");
  const runs = Array.isArray(input.workflowRuns) ? input.workflowRuns.map(normalizeRun) : [];
  return { repository, branch, generatedAt, runs };
}

async function getWorkflowRuns({ fixture, windowHours }) {
  if (fixture) {
    const parsed = JSON.parse(await readFile(resolve(fixture), "utf8"));
    return parseFixture(parsed);
  }
  const repository = requireNonEmpty(process.env.GITHUB_REPOSITORY, "GITHUB_REPOSITORY");
  const branch = process.env.GITHUB_REF_NAME?.trim() || "main";
  const token = requireNonEmpty(process.env.GITHUB_TOKEN, "GITHUB_TOKEN");
  const generatedAt = new Date().toISOString();
  const since = Date.now() - windowHours * 60 * 60 * 1000;
  const endpoint = new URL(`https://api.github.com/repos/${repository}/actions/runs`);
  endpoint.searchParams.set("branch", branch);
  endpoint.searchParams.set("per_page", String(MAX_RUNS));
  const response = await fetch(endpoint, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "healthpoint-daily-regression-reporter",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`GitHub Actions API returned HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.workflow_runs)) throw new Error("GitHub Actions API response did not include workflow_runs");
  const runs = data.workflow_runs
    .filter(run => run?.name === REPORT_WORKFLOW_NAME)
    .filter(run => Date.parse(run.updated_at ?? "") >= since)
    .filter(run => run.status === "completed")
    .map(normalizeRun);
  return { repository, branch, generatedAt, runs };
}

function aggregate(runs) {
  const summary = { successful: 0, failed: 0, cancelled: 0, other: 0, total: runs.length };
  for (const run of runs) {
    if (run.conclusion === "success") summary.successful += 1;
    else if (run.conclusion === "failure" || run.conclusion === "timed_out" || run.conclusion === "action_required") summary.failed += 1;
    else if (run.conclusion === "cancelled" || run.conclusion === "skipped") summary.cancelled += 1;
    else summary.other += 1;
  }
  summary.overall = summary.failed > 0 ? "FAIL" : summary.other > 0 ? "ATTENTION" : "PASS";
  return summary;
}

function markdownEscape(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function renderReport({ repository, branch, generatedAt, windowHours, runs, summary }) {
  const title = `# HealthPoint Daily CI Regression Report — ${summary.overall}`;
  const lines = [
    title,
    "",
    `**Repository:** \`${repository}\`  `,
    `**Branch:** \`${branch}\`  `,
    `**Window:** previous ${windowHours} hour(s)  `,
    `**Generated (UTC):** ${generatedAt}`,
    "",
    "## Summary",
    "",
    "| Completed security-gate runs | Successful | Failed | Cancelled | Other | Overall |",
    "|---:|---:|---:|---:|---:|---|",
    `| ${summary.total} | ${summary.successful} | ${summary.failed} | ${summary.cancelled} | ${summary.other} | **${summary.overall}** |`,
    "",
    "## Completed Runs",
    "",
  ];
  if (runs.length === 0) {
    lines.push("No completed `Security gates` workflow runs were found in this reporting window.");
  } else {
    lines.push("| Updated (UTC) | Conclusion | Event | Commit | Run |", "|---|---|---|---|---|");
    for (const run of runs) {
      const link = run.htmlUrl ? `[${markdownEscape(run.displayTitle)}](${run.htmlUrl})` : markdownEscape(run.displayTitle);
      lines.push(`| ${markdownEscape(run.updatedAt)} | ${markdownEscape(run.conclusion)} | ${markdownEscape(run.event)} | \`${markdownEscape(run.sha)}\` | ${link} |`);
    }
  }
  lines.push(
    "",
    "## Interpretation",
    "",
    summary.overall === "PASS"
      ? "All completed security-gate runs in the reporting window succeeded. This report does not replace release approval, independent review, or external staging evidence."
      : "At least one workflow requires engineering review. Treat the result as a release signal only after examining the linked run evidence; do not infer that a failed or missing run is safe.",
    "",
    "## Delivery Boundary",
    "",
    "This report contains workflow metadata only. It does not contain credentials, runtime secrets, protected health payloads, PHI, or financial transaction data.",
    ""
  );
  return `${lines.join("\n")}\n`;
}

async function atomicWrite(path, content) {
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, content, { encoding: "utf8", mode: 0o600 });
  await rename(tempPath, path);
}

async function deliverMatrix(report) {
  const homeserver = parseHttpsUrl(process.env.HEALTHPOINT_MATRIX_HOMESERVER_URL, "HEALTHPOINT_MATRIX_HOMESERVER_URL");
  const roomId = requireNonEmpty(process.env.HEALTHPOINT_MATRIX_ROOM_ID, "HEALTHPOINT_MATRIX_ROOM_ID");
  const token = requireNonEmpty(process.env.HEALTHPOINT_MATRIX_ACCESS_TOKEN, "HEALTHPOINT_MATRIX_ACCESS_TOKEN");
  const transactionId = randomUUID();
  const endpoint = new URL(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${transactionId}`, homeserver);
  const response = await fetch(endpoint, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ msgtype: "m.text", body: report, format: "org.matrix.custom.html", formatted_body: `<pre>${report.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</pre>` }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Matrix delivery returned HTTP ${response.status}`);
  return { provider: "matrix", status: response.status, transactionId };
}

async function deliverMattermost(report) {
  const endpoint = parseHttpsUrl(process.env.HEALTHPOINT_MATTERMOST_WEBHOOK_URL, "HEALTHPOINT_MATTERMOST_WEBHOOK_URL");
  if (!endpoint.pathname.startsWith("/hooks/")) throw new Error("HEALTHPOINT_MATTERMOST_WEBHOOK_URL must be an incoming /hooks/ URL");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: report, username: "healthpoint-ci" }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Mattermost delivery returned HTTP ${response.status}`);
  return { provider: "mattermost", status: response.status };
}

async function main() {
  const options = parseArguments();
  if (options.dryRun && options.deliver) usage("--dry-run and --deliver cannot be combined");
  const delivery = (process.env.HEALTHPOINT_REGRESSION_REPORT_DELIVERY ?? "none").trim().toLowerCase();
  if (!VALID_DELIVERIES.has(delivery)) throw new Error("HEALTHPOINT_REGRESSION_REPORT_DELIVERY must be one of: none, matrix, mattermost");
  const { repository, branch, generatedAt, runs } = await getWorkflowRuns(options);
  const summary = aggregate(runs);
  const report = renderReport({ repository, branch, generatedAt, windowHours: options.windowHours, runs, summary });
  const outputDir = resolve(options.outputDir);
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const markdownPath = resolve(outputDir, "daily-regression-report.md");
  const metricsPath = resolve(outputDir, "daily-regression-report.metrics.json");
  const metrics = {
    generatedAt,
    repository,
    branch,
    windowHours: options.windowHours,
    workflowName: REPORT_WORKFLOW_NAME,
    completedRuns: summary.total,
    successfulRuns: summary.successful,
    failedRuns: summary.failed,
    cancelledRuns: summary.cancelled,
    otherRuns: summary.other,
    overall: summary.overall,
    delivery,
    deliveryAttempted: options.deliver,
    dryRun: options.dryRun,
  };
  await atomicWrite(markdownPath, report);
  await atomicWrite(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`);
  let deliveryResult = null;
  if (options.deliver) {
    if (delivery === "none") throw new Error("delivery is requested but HEALTHPOINT_REGRESSION_REPORT_DELIVERY is none");
    deliveryResult = delivery === "matrix" ? await deliverMatrix(report) : await deliverMattermost(report);
  }
  process.stdout.write(`${JSON.stringify({ event: "healthpoint_daily_regression_report", report: basename(markdownPath), metrics: basename(metricsPath), ...metrics, deliveryResult })}\n`);
}

main().catch(error => {
  process.stderr.write(`daily regression report failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
