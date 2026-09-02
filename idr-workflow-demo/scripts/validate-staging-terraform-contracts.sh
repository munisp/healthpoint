#!/usr/bin/env bash
# Validates Terraform syntax and initialization only. It never plans, applies,
# imports, refreshes state, or contacts a cloud provider.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TERRAFORM_BIN="${TERRAFORM_BIN:-terraform}"
ARTIFACT_DIR="${TERRAFORM_VALIDATION_ARTIFACT_DIR:-$ROOT/../healthpoint/artifacts/staging-terraform-validation}"
mkdir -p "$ARTIFACT_DIR"

if ! command -v "$TERRAFORM_BIN" >/dev/null 2>&1; then
  echo "REFUSED: verified Terraform binary not found; set TERRAFORM_BIN to an approved Terraform 1.6+ executable" >&2
  exit 64
fi
version="$($TERRAFORM_BIN version -json 2>/dev/null | sed -n 's/.*"terraform_version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
[[ -n "$version" ]] || { echo "REFUSED: unable to identify Terraform version" >&2; exit 64; }

for module in \
  "$ROOT/infrastructure/tigerbeetle-staging/terraform" \
  "$ROOT/infrastructure/external-gates-staging/terraform"; do
  name="$(basename "$(dirname "$module")")-$(basename "$module")"
  log="$ARTIFACT_DIR/$name.log"
  {
    echo "module=$module"
    echo "terraform_version=$version"
    "$TERRAFORM_BIN" -chdir="$module" fmt -check -recursive
    "$TERRAFORM_BIN" -chdir="$module" init -backend=false -input=false -no-color
    "$TERRAFORM_BIN" -chdir="$module" validate -no-color
    echo "VALIDATION_PASS: format, backend-free init, and validate completed; no provider operation was performed."
  } >"$log" 2>&1
  cat "$log"
done
