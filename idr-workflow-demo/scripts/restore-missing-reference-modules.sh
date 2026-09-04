#!/usr/bin/env bash
# Restore only absent source files from a trusted selected-repository reference.
# This never overwrites remediation work in the authoritative workspace.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REFERENCE_ROOT="${HEALTHPOINT_REFERENCE_ROOT:-$ROOT/../healthpoint-reference}"
[[ -d "$REFERENCE_ROOT" ]] || { echo "reference checkout is required: $REFERENCE_ROOT" >&2; exit 2; }

copy_missing_tree() {
  local source_root="$1"
  local destination_root="$2"
  shift 2
  cd "$source_root"
  while IFS= read -r -d '' source; do
    local relative="${source#./}"
    local skip=false
    for pattern in "$@"; do
      [[ "$relative" == $pattern ]] && { skip=true; break; }
    done
    "$skip" && continue
    local destination="$destination_root/$relative"
    if [[ ! -e "$destination" ]]; then
      mkdir -p "$(dirname "$destination")"
      cp "$source" "$destination"
      printf 'restored %s\n' "$relative"
    fi
  done < <(find . -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.d.ts' -o -name '*.css' \) -print0)
}

# Server modules required by the active TypeScript composition root. Do not
# reintroduce provider-specific SDK, automatic CMS transport, or simulators.
copy_missing_tree "$REFERENCE_ROOT/server" "$ROOT/server" \
  '_core/sdk.ts' \
  '_core/oauth.ts' \
  '_core/types/manusTypes.ts' \
  '*cms*api*' \
  '*simulator*' \
  '*simulation*'

# Restore the client application and shared types needed for strict compilation,
# excluding legacy named UI and backup artifacts.
copy_missing_tree "$REFERENCE_ROOT/client/src" "$ROOT/client/src" \
  'components/ManusDialog.tsx' \
  '*.bak'
copy_missing_tree "$REFERENCE_ROOT/shared" "$ROOT/shared"
