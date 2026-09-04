# Daily CI Regression Reporting

The workflow `.github/workflows/daily-regression-report.yml` executes at **03:17 UTC** every day and can be started manually. It runs the HealthPoint hermetic regression controls, creates a Markdown report plus a JSON metric summary, and retains the result as a GitHub Actions artifact for 90 days.

The report contains workflow metadata only: run conclusions, events, branch names, abbreviated commit identifiers, timestamps, and run URLs. It must not contain tokens, certificates, database URLs, PHI, or financial transaction content.

## Delivery Modes

| `HEALTHPOINT_REGRESSION_REPORT_DELIVERY` repository variable | Result | Required protected configuration |
|---|---|---|
| `none` | Artifact-only reporting. A scheduled workflow configured with this value fails closed if delivery is requested. | None. |
| `matrix` | Sends the Markdown report body to a configured Matrix room through the Matrix Client-Server API. | `HEALTHPOINT_MATRIX_HOMESERVER_URL`, `HEALTHPOINT_MATRIX_ROOM_ID`, and `HEALTHPOINT_MATRIX_ACCESS_TOKEN` GitHub secrets. |
| `mattermost` | Posts the Markdown report body to a configured Mattermost incoming webhook. | `HEALTHPOINT_MATTERMOST_WEBHOOK_URL` GitHub secret. |

The selected mode must be set as the GitHub repository **variable** `HEALTHPOINT_REGRESSION_REPORT_DELIVERY`. Secrets must be stored only under repository **Actions secrets**. Never place an incoming webhook URL or Matrix access token in a source file, issue, pull request comment, or workflow log.

## Matrix Setup

Use a dedicated non-administrator service account that is a member only of the intended private operations room. Configure the following repository secrets after verifying the private HTTPS homeserver endpoint and room membership:

```text
HEALTHPOINT_MATRIX_HOMESERVER_URL=https://matrix.example.internal
HEALTHPOINT_MATRIX_ROOM_ID=!privateOpsRoom:example.internal
HEALTHPOINT_MATRIX_ACCESS_TOKEN=<stored-as-a-secret>
```

The reporter sends a Matrix `m.room.message` event using a unique transaction ID. The delivery request has a 10-second timeout. Any non-success HTTP response fails the workflow; the report artifact remains available for investigation.

## Mattermost Setup

Create an incoming webhook for the intended private channel and store the complete HTTPS `/hooks/…` URL in the repository secret:

```text
HEALTHPOINT_MATTERMOST_WEBHOOK_URL=https://mattermost.example.internal/hooks/<stored-as-a-secret>
```

The reporter posts the Markdown text using JSON and a fixed `healthpoint-ci` sender label. The request has a 10-second timeout. Any non-success HTTP response fails the workflow; the report artifact remains available for investigation.

## Manual Dry Run

Select `dry_run=true` when manually dispatching the workflow. The report is generated and uploaded but no Matrix or Mattermost request is made. Locally, run the same no-network fixture test:

```bash
cd idr-workflow-demo
pnpm run test:daily-regression-report
pnpm run generate:daily-regression-report -- \
  --fixture scripts/fixtures/daily-regression-report-window.json \
  --output-dir /tmp/healthpoint-daily-report \
  --dry-run
```

The test verifies the Markdown table, pass/fail counters, JSON metric fields, artifact output, and the refusal to attempt delivery when mode is `none`.

## Operational Boundaries

Daily reporting is deterministic CI automation, not a release approval mechanism. A `PASS` report does not replace required independent pull-request review, production preflight, change management, live staging evidence, or financial execution controls. A delivery failure must be investigated as an observability incident; it does not authorize a fallback to an unaudited channel.
