#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point to the source PostgreSQL database}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL must point to a pre-provisioned isolated restore database}"

if [[ "$DATABASE_URL" == "$RESTORE_DATABASE_URL" ]]; then
  echo "Refusing recovery drill: source and target database URLs are identical" >&2
  exit 2
fi

drill_dir="${RECOVERY_DRILL_DIR:-./var/recovery-drills/$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$drill_dir"
export BACKUP_OUTPUT_DIR="$drill_dir"

backup_result="$(./scripts/db-backup.sh)"
backup_file="$(printf '%s\n' "$backup_result" | awk -F= '/^BACKUP_FILE=/{print $2}')"
if [[ -z "$backup_file" ]]; then
  echo "Backup automation did not return a backup artifact" >&2
  exit 1
fi

export ALLOW_DESTRUCTIVE_RESTORE=true
restore_result="$(./scripts/db-restore-verify.sh "$backup_file")"

source_counts="$(psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM disputes UNION ALL SELECT count(*) FROM ledger_entries UNION ALL SELECT count(*) FROM settlement_callbacks UNION ALL SELECT count(*) FROM event_log")"
target_counts="$(psql "$RESTORE_DATABASE_URL" -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM disputes UNION ALL SELECT count(*) FROM ledger_entries UNION ALL SELECT count(*) FROM settlement_callbacks UNION ALL SELECT count(*) FROM event_log")"
if [[ "$source_counts" != "$target_counts" ]]; then
  echo "Recovery drill failed: critical table counts differ" >&2
  exit 1
fi

printf '%s\n' "$restore_result" > "$drill_dir/restore-verification.txt"
printf '{"completedAt":"%s","backupFile":"%s","criticalTableCountsMatch":true}\n' "$(date -u +%FT%TZ)" "$backup_file" > "$drill_dir/result.json"
printf 'RECOVERY_DRILL_RESULT=%s\n' "$drill_dir/result.json"
