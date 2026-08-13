#!/usr/bin/env bash
set -euo pipefail

: "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE is required}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL must point to an isolated PostgreSQL restore target}"

backup_file="${1:?usage: db-restore-verify.sh /path/to/backup.dump.gpg}"
if [[ ! -f "$backup_file" ]]; then
  echo "Backup file does not exist: $backup_file" >&2
  exit 2
fi
if [[ "${ALLOW_DESTRUCTIVE_RESTORE:-}" != "true" ]]; then
  echo "Refusing restore: set ALLOW_DESTRUCTIVE_RESTORE=true only for an isolated target" >&2
  exit 2
fi
if [[ -n "${DATABASE_URL:-}" && "$RESTORE_DATABASE_URL" == "$DATABASE_URL" ]]; then
  echo "Refusing restore: source and restore database URLs are identical" >&2
  exit 2
fi

restore_dir="$(mktemp -d)"
plain_dump="$restore_dir/restore.dump"
cleanup() { rm -rf "$restore_dir"; }
trap cleanup EXIT

gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_ENCRYPTION_PASSPHRASE" \
  --decrypt --output "$plain_dump" "$backup_file"
pg_restore --list "$plain_dump" >/dev/null
pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname "$RESTORE_DATABASE_URL" "$plain_dump"

psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -At <<'SQL'
SELECT 'integrity:tables=' || count(*) FROM pg_tables WHERE schemaname = 'public';
SELECT 'integrity:disputes=' || count(*) FROM disputes;
SELECT 'integrity:ledger_entries=' || count(*) FROM ledger_entries;
SELECT 'integrity:settlement_callbacks=' || count(*) FROM settlement_callbacks;
SELECT 'integrity:event_log=' || count(*) FROM event_log;
SQL
