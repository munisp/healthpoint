# Audit Platform-Hardening Reconciliation Manifest

## Scope and Baseline

| Field | Value |
|---|---|
| Remote repository | `munisp/healthpoint` |
| Baseline commit | `642b193bb131f1af7835426425a41c87088fb012` |
| Reconciliation branch | `reconcile/audit-platform-hardening` |
| Authoritative audited source | `/home/ubuntu/healthpoint-git-audit` |
| Correct application target | `idr-workflow-demo/` |
| Root repository policy | Preserve root Python, Go, and other remote-only assets; do not overwrite the repository root with the audited application. |

## Lineage Decision

The audited migration chain and the nested application share the checked-in migrations `0000` through `0006` unchanged. The audited source adds forward-only migrations `0007` through `0047` and a 44-entry journal. This supports integrating the audited migration lineage into `idr-workflow-demo/drizzle/` without rebasing, renumbering, or deleting the remote baseline migrations.

| Inventory category | Count | Treatment |
|---|---:|---|
| Audited-only paths | 286 | Add under `idr-workflow-demo/`, subject to the exclusions below. |
| Differing paths | 55 | Replace with the audited implementation after local validation. |
| Remote-nested-only paths | 34 | Preserve unless separately reviewed. |
| Common migration files | 7 | Retain unchanged (`0000`–`0006`). |
| Forward audited migrations | 37 | Add unchanged (`0007`–`0047`). |

## Controlled Overlay Rules

The overlay copies the audited source tree into `idr-workflow-demo/` while preserving target-only paths. It excludes generated or environment-specific material: `.git`, `node_modules`, `dist`, `artifacts`, `coverage`, `playwright-report`, `.env`, `.env.test`, and `.github`.

The nested application's remote-only source and reference material, including `ai-service/`, `references/`, `scripts/seed.mjs`, local editor configuration, and documentation not present in the audited source remain in place. Root-level repository assets remain untouched.

## Package-Manager Reconciliation

The remote repository root is a separate application workspace and legitimately declares a patch for `wouter@3.7.1`; this root configuration and its patch file are preserved. The audited nested application's package manifest and lockfile resolve unpatched `wouter@3.10.0`, so its former nested patch directory and declaration are removed with the audited manifest replacement. Nested application dependency commands must use `--ignore-workspace` so that pnpm uses `idr-workflow-demo/pnpm-lock.yaml` rather than inheriting the root application's independent patch configuration.

## Validation Required Before Push

1. Confirm the migration journal contains 44 checked-in entries and matches migrations `0000`–`0047`.
2. Install dependencies with `pnpm install --ignore-workspace --frozen-lockfile` from `idr-workflow-demo/`.
3. Run static type checks, production build, focused finality/evidence tests, and the migration-journal validator.
4. Run a disposable PostgreSQL migration verification only; do not target staging or production.
5. Update the root workflow to execute Node commands in `idr-workflow-demo/` and preserve root Python/Go security jobs.
6. Perform diff, secret, and workflow review before pushing a branch and opening a pull request. No merge to `main` occurs without explicitly requested confirmation after review and remote checks.
