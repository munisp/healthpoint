#!/usr/bin/env node
/**
 * Report a pending HealthPoint pull-request approval.
 *
 * The script is intentionally notification-only. It never approves, merges,
 * updates labels, changes reviewers, or mutates pull-request state.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const DEFAULT_PR_NUMBER = 2;
const VALID_DELIVERIES = new Set(["none", "mattermost"]);

function usage(message) {
  if (message) process.stderr.write(`ERROR: ${message}\n`);
  process.stderr.write("Usage: node scripts/report-pending-pr-approval.mjs [--fixture FILE] [--pr-number N] [--output-dir DIR] [--deliver]\n");
  process.exit(message ? 2 : 0);
}

function readOption(args, option) {
  const index = args.indexOf(option);
  if (index === -1) return undefined;
  if (index === args.length - 1 || args[index + 1].startsWith("--")) usage(`${option} requires a value`);
  return args[index + 1];
}

function parseArguments() {
  const args = process.argv.slice(2).filter(argument => argument !== "--");
  const known = new Set(["--fixture", "--pr-number", "--output-dir", "--deliver", "--help"]);
  for (const argument of args) {
    if (argument.startsWith("--") && !known.has(argument)) usage(`unknown option ${argument}`);
  }
  if (args.includes("--help")) usage();
  const prRaw = readOption(args, "--pr-number") ?? String(DEFAULT_PR_NUMBER);
  const prNumber = Number(prRaw);
  if (!Number.isInteger(prNumber) || prNumber < 1) usage("--pr-number must be a positive integer");
  return {
    fixture: readOption(args, "--fixture"),
    prNumber,
    outputDir: readOption(args, "--output-dir") ?? "artifacts/pending-pr-approval-report",
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

function normalizeCheck(check) {
  return {
    name: typeof check?.name === "string" ? check.name : "unnamed check",
    status: typeof check?.status === "string" ? check.status : "UNKNOWN",
    conclusion: typeof check?.conclusion === "string" && check.conclusion ? check.conclusion : "PENDING",
  };
}

function normalizeReview(review) {
  return {
    author: typeof review?.author === "string" ? review.author : "unknown",
    state: typeof review?.state === "string" ? review.state : "UNKNOWN",
    submittedAt: typeof review?.submittedAt === "string" ? review.submittedAt : null,
  };
}

function normalizePr(input, repository, expectedPrNumber) {
  if (!input || typeof input !== "object") throw new Error("pull request data must be an object");
  const number = Number(input.number ?? expectedPrNumber);
  if (!Number.isInteger(number) || number !== expectedPrNumber) throw new Error("pull request number did not match requested value");
  const state = typeof input.state === "string" ? input.state : "UNKNOWN";
  const headRefOid = typeof input.headRefOid === "string" ? input.headRefOid : "unknown";
  const author = typeof input.author === "string" ? input.author : "unknown";
  const reviewDecision = typeof input.reviewDecision === "string" ? input.reviewDecision : "REVIEW_REQUIRED";
  const checks = Array.isArray(input.checks) ? input.checks.map(normalizeCheck) : [];
  const reviews = Array.isArray(input.reviews) ? input.reviews.map(normalizeReview) : [];
  return { number, repository, state, headRefOid, author, reviewDecision, checks, reviews };
}

async function loadPullRequest({ fixture, prNumber }) {
  if (fixture) {
    const parsed = JSON.parse(await readFile(resolve(fixture), "utf8"));
    return normalizePr(parsed, requireNonEmpty(parsed.repository, "fixture.repository"), prNumber);
  }
  const repository = requireNonEmpty(process.env.GITHUB_REPOSITORY, "GITHUB_REPOSITORY");
  const token = requireNonEmpty(process.env.GITHUB_TOKEN, "GITHUB_TOKEN");
  const query = `query($owner:String!, $name:String!, $number:Int!) {
    repository(owner:$owner, name:$name) {
      pullRequest(number:$number) {
        number state reviewDecision headRefOid author { login }
        reviews(last: 20) { nodes { state submittedAt author { login } } }
        commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes { ... on CheckRun { name status conclusion } ... on StatusContext { context state } } } } } } }
      }
    }
  }`;
  const [owner, name] = repository.split("/");
  if (!owner || !name) throw new Error("GITHUB_REPOSITORY must be owner/name");
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "healthpoint-pr-review-reporter",
    },
    body: JSON.stringify({ query, variables: { owner, name, number: prNumber } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`GitHub GraphQL API returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.errors?.length) throw new Error(`GitHub GraphQL API error: ${payload.errors[0].message}`);
  const pr = payload.data?.repository?.pullRequest;
  if (!pr) throw new Error(`pull request #${prNumber} was not found`);
  const contexts = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];
  const checks = contexts.map(context => ({
    name: context.name ?? context.context,
    status: context.status ?? context.state,
    conclusion: context.conclusion ?? context.state ?? "PENDING",
  }));
  const reviews = (pr.reviews?.nodes ?? []).map(review => ({ author: review.author?.login, state: review.state, submittedAt: review.submittedAt }));
  return normalizePr({ ...pr, author: pr.author?.login, checks, reviews }, repository, prNumber);
}

function summarize(pr) {
  const completed = pr.checks.filter(check => check.status === "COMPLETED");
  const failed = completed.filter(check => !["SUCCESS", "NEUTRAL", "SKIPPED"].includes(check.conclusion));
  const pending = pr.checks.filter(check => check.status !== "COMPLETED");
  const independentApprovals = pr.reviews.filter(review => review.state === "APPROVED" && review.author !== pr.author);
  const pendingApproval = pr.state === "OPEN" && pr.reviewDecision === "REVIEW_REQUIRED";
  const status = pendingApproval ? "APPROVAL_PENDING" : pr.state === "MERGED" ? "MERGED" : failed.length > 0 ? "CHECKS_FAILED" : pending.length > 0 ? "CHECKS_PENDING" : "NO_ACTION";
  return { completed: completed.length, failed: failed.length, pending: pending.length, independentApprovals: independentApprovals.length, pendingApproval, status };
}

function escapeMarkdown(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function renderReport(pr, summary, generatedAt) {
  const lines = [
    `# HealthPoint PR #${pr.number} Approval Status — ${summary.status}`,
    "",
    `**Repository:** \`${pr.repository}\`  `,
    `**PR:** [#${pr.number}](https://github.com/${pr.repository}/pull/${pr.number})  `,
    `**Generated (UTC):** ${generatedAt}  `,
    `**Head SHA:** \`${pr.headRefOid}\``,
    "",
    "## Merge-Control Summary",
    "",
    "| PR state | Review decision | Independent approvals | Completed checks | Failed checks | Pending checks |",
    "|---|---|---:|---:|---:|---:|",
    `| ${escapeMarkdown(pr.state)} | ${escapeMarkdown(pr.reviewDecision)} | ${summary.independentApprovals} | ${summary.completed} | ${summary.failed} | ${summary.pending} |`,
    "",
  ];
  if (summary.pendingApproval) {
    lines.push(
      "## Required Reviewer Action",
      "",
      `PR #${pr.number} has green or pending checks as shown below, but GitHub still requires an **independent approving review** after the current head SHA. A reviewer other than \`${pr.author}\` must review the current changes and use **Review changes → Approve**. This notification cannot approve, merge, or bypass branch protection.`,
      ""
    );
  }
  lines.push("## Check Status", "", "| Check | Status | Conclusion |", "|---|---|---|");
  if (pr.checks.length === 0) lines.push("| No check data returned | UNKNOWN | UNKNOWN |");
  else for (const check of pr.checks) lines.push(`| ${escapeMarkdown(check.name)} | ${escapeMarkdown(check.status)} | ${escapeMarkdown(check.conclusion)} |`);
  lines.push("", "## Review History", "", "| Reviewer | State | Submitted (UTC) |", "|---|---|---|");
  if (pr.reviews.length === 0) lines.push("| No review record returned | — | — |");
  else for (const review of pr.reviews) lines.push(`| ${escapeMarkdown(review.author)} | ${escapeMarkdown(review.state)} | ${escapeMarkdown(review.submittedAt ?? "—")} |`);
  lines.push("", "## Notification Boundary", "", "This report is read-only. It contains no token, webhook, health payload, PHI, or financial transaction data. It does not change pull-request, reviewer, branch-protection, or merge state.", "");
  return `${lines.join("\n")}\n`;
}

async function atomicWrite(path, content) {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, content, { encoding: "utf8", mode: 0o600 });
  await rename(temp, path);
}

async function deliverMattermost(markdown) {
  const endpoint = parseHttpsUrl(process.env.HEALTHPOINT_MATTERMOST_WEBHOOK_URL, "HEALTHPOINT_MATTERMOST_WEBHOOK_URL");
  if (!endpoint.pathname.startsWith("/hooks/")) throw new Error("HEALTHPOINT_MATTERMOST_WEBHOOK_URL must be an incoming /hooks/ URL");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: markdown, username: "healthpoint-pr-review" }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Mattermost review reminder returned HTTP ${response.status}`);
  return { provider: "mattermost", status: response.status };
}

async function main() {
  const options = parseArguments();
  const delivery = (process.env.HEALTHPOINT_PR_REVIEW_REMINDER_DELIVERY ?? "none").trim().toLowerCase();
  if (!VALID_DELIVERIES.has(delivery)) throw new Error("HEALTHPOINT_PR_REVIEW_REMINDER_DELIVERY must be one of: none, mattermost");
  const pr = await loadPullRequest(options);
  const summary = summarize(pr);
  const generatedAt = new Date().toISOString();
  const markdown = renderReport(pr, summary, generatedAt);
  const outputDir = resolve(options.outputDir);
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const reportPath = resolve(outputDir, "pending-pr-approval-report.md");
  const metricsPath = resolve(outputDir, "pending-pr-approval-report.metrics.json");
  const metrics = { generatedAt, prNumber: pr.number, repository: pr.repository, headRefOid: pr.headRefOid, ...summary, delivery, deliveryAttempted: options.deliver };
  await atomicWrite(reportPath, markdown);
  await atomicWrite(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`);
  let deliveryResult = null;
  if (options.deliver && summary.pendingApproval) {
    if (delivery === "none") throw new Error("delivery requested while HEALTHPOINT_PR_REVIEW_REMINDER_DELIVERY is none");
    deliveryResult = await deliverMattermost(markdown);
  }
  process.stdout.write(`${JSON.stringify({ event: "healthpoint_pending_pr_approval_report", report: basename(reportPath), metrics: basename(metricsPath), ...metrics, deliveryResult })}\n`);
}

main().catch(error => {
  process.stderr.write(`pending PR approval report failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
