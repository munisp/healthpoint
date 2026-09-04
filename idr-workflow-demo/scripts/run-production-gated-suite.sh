#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PRODUCTION_ENV_FILE:-}"
EVIDENCE_DIR="${RELEASE_EVIDENCE_DIR:-}"
OUT_DIR="${ARTIFACT_DIR:-$ROOT/../healthpoint/artifacts/production-gated-suite}"
mkdir -p "$OUT_DIR"
if [[ -z "$ENV_FILE" || ! -f "$ENV_FILE" ]]; then
  echo "PRODUCTION_ENV_FILE must point to a protected production-shaped environment file" >&2
  exit 2
fi
if [[ -z "$EVIDENCE_DIR" || ! -d "$EVIDENCE_DIR" ]]; then
  echo "RELEASE_EVIDENCE_DIR must point to a protected real-evidence directory" >&2
  exit 2
fi
set -a
source "$ENV_FILE"
set +a
node "$ROOT/scripts/validate-production-env.mjs" >"$OUT_DIR/environment-validation.json"
EVIDENCE_EXECUTION=protected RELEASE_EVIDENCE_DIR="$EVIDENCE_DIR" \
  node "$ROOT/scripts/validate-external-release-blockers.mjs" --evidence-dir "$EVIDENCE_DIR" >"$OUT_DIR/external-blockers.json" 2>&1
node "$ROOT/scripts/assurance-gate.mjs" >"$OUT_DIR/assurance-gate.log" 2>&1
pnpm run check >"$OUT_DIR/typecheck.log" 2>&1
pnpm run build >"$OUT_DIR/build.log" 2>&1
# Tests must run with test semantics, but fallback mocks remain disabled. The production
# file is validated above; live service URLs and credentials remain available to tests.
export NODE_ENV=test
unset ALLOW_MOCK_FIXTURES TEST_INFRA_FALLBACK_MOCKS EMR_SIMULATION_MODE TEMPORAL_CONTROLLED_DRILL AUTHZ_ALLOW_POSTGRES_FALLBACK
set +e
pnpm test >"$OUT_DIR/full-test-suite.log" 2>&1
TEST_RC=$?
set -e
git -C "$ROOT" diff --check >"$OUT_DIR/diff-check.log" 2>&1
node -e '
const fs=require("node:fs");
const [exitCode,outPath]=process.argv.slice(1);
const result={generatedAt:new Date().toISOString(),testExitCode:Number(exitCode),testsPassed:Number(exitCode)===0};
fs.writeFileSync(outPath, JSON.stringify(result,null,2)+"\n");
process.exitCode=result.testsPassed?0:2;
' "$TEST_RC" "$OUT_DIR/summary.json"
