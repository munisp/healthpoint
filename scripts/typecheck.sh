#!/usr/bin/env bash
# ==============================================================================
# typecheck.sh — install deps and run the TypeScript type gate locally/CI.
# Audit P1-10 (2026-09-05): the GitHub Actions workflow that runs this
# (ci/typecheck-and-test.yml) cannot be installed by the remediation token
# (no `workflow` scope — pushes to .github/workflows/ return 403), so this
# script is the portable entry point: run it locally, in any CI system, or
# from the workflow once a maintainer moves the yaml into .github/workflows/.
# ==============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> npm ci (legacy peer deps — pinned lockfile)"
npm ci --legacy-peer-deps

echo "==> npx tsc --noEmit"
# KNOWN PRE-EXISTING ERRORS (predate this gate; warn-only in CI until fixed):
#   - server/idr/portal-rpa (portal RPA pages): TS2802 — Map/iterator spread
#     requires --downlevelIteration or target/lib ES2015+.
#   - server/idr portal-rpa / dispute registry mapping: TS2322 — registry
#     types assigned to portal-rpa view models with mismatched optional/
#     nullable fields.
# Both live under server/**, owned outside the infra-remediation scope, so
# they are DOCUMENTED here, not fixed in this commit.
# TODO(type-gate): fix the portal-rpa TS2802/TS2322 errors, then remove the
# `continue-on-error: true` from ci/typecheck-and-test.yml so the gate blocks.
npx tsc --noEmit
echo "==> typecheck clean"
