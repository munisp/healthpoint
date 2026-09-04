# PR #2 Approval Reminder

The workflow `.github/workflows/pr2-approval-reminder.yml` checks PR #2 twice per day, at **00:17 UTC** and **12:17 UTC**. It is intentionally read-only: it queries the pull request’s state, head SHA, review decision, review records, and check conclusions; generates a Markdown/JSON artifact; and can notify a Mattermost engineering channel only if a required independent approval is still pending.

It cannot approve or merge the pull request, modify reviewers, change labels, modify branch-protection policy, create a token, or bypass GitHub’s protected-review rule.

## Mattermost Configuration

Create an incoming webhook in the designated private engineering channel. Store the complete HTTPS webhook URL only as the GitHub repository Actions secret named `HEALTHPOINT_MATTERMOST_WEBHOOK_URL`. Do not place the URL in source code, workflow YAML, issues, pull requests, artifacts, or messages.

Set the GitHub repository variable `HEALTHPOINT_PR_REVIEW_REMINDER_ENABLED` to `true` only after the secret is configured and an operations owner has confirmed the intended channel. Until then, scheduled runs generate artifacts only and do not make an outbound Mattermost call. A manual workflow run may request delivery after the same secret is configured.

A delivery attempt requires an HTTPS URL whose path begins `/hooks/`. The reporter uses a 10-second timeout. A missing or invalid delivery configuration causes the workflow to fail rather than silently treating a reminder as delivered. The report artifact remains available for diagnosis.

## Engineering-Channel Notification Template

> **HealthPoint PR #2 — independent approval required**
>
> PR #2 remains open at the current reviewed head SHA. All required automated checks are green, but GitHub requires one **independent approving review** after the latest push before the protected `main` branch can accept the merge.
>
> Please assign a reviewer other than PR author `munisp` to inspect the current diff and select **Review changes → Approve** on the pull request. A comment, a personal access token, or a bot acting as the PR author does not satisfy this control.
>
> The daily regression-report fixture’s historical `FAIL` entry is synthetic test data used to verify that the report formats failures honestly. It is not a live security-gate failure and contains no job log or root-cause evidence. Use the linked GitHub Actions run and artifact to investigate any real future failed run.
>
> PR: https://github.com/munisp/healthpoint/pull/2

## No-Message Conditions

The reminder report is still generated as an artifact, but an external Mattermost message is not sent when the pull request is merged, closed, approved, or when its review decision no longer equals `REVIEW_REQUIRED`. This prevents routine notification noise and does not affect the underlying protected-merge requirement.
