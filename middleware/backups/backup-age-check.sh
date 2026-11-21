#!/usr/bin/env bash
# backup-age-check.sh — monitoring hook: exit non-zero when the latest
# verified base backup or the WAL archive is older than its threshold.
#
# Wire into cron / Alertmanager / Nagios-style checks:
#   */5 * * * *  /opt/healthpoint/middleware/backups/backup-age-check.sh \
#     || /opt/healthpoint/scripts/alert.sh "Postgres backup freshness breached"
#
# Output (one line, scrape-friendly):
#   backup_age_check status=ok|stale backup_age_min=<n|-1> wal_age_min=<n|-1> ...
#
# Env:
#   BACKUP_DIR              (required) base backup root (base-backup.sh output)
#   ARCHIVE_DIR             (required) WAL archive dir (archive-command.sh target)
#   BACKUP_LABEL            label prefix (default: base)
#   BACKUP_MAX_AGE_MINUTES  max age of newest VERIFIED base backup (default 1440 = 24h)
#   WAL_MAX_AGE_MINUTES     max age of newest archived WAL segment (default 10)
#
# Exit: 0 both fresh | 1 stale or missing | 2 usage/env error
set -euo pipefail

: "${BACKUP_DIR:?BACKUP_DIR must be set}"
: "${ARCHIVE_DIR:?ARCHIVE_DIR must be set}"
BACKUP_LABEL="${BACKUP_LABEL:-base}"
BACKUP_MAX_AGE_MINUTES="${BACKUP_MAX_AGE_MINUTES:-1440}"
WAL_MAX_AGE_MINUTES="${WAL_MAX_AGE_MINUTES:-10}"
for v in BACKUP_MAX_AGE_MINUTES WAL_MAX_AGE_MINUTES; do
  case "${!v}" in ''|*[!0-9]*) echo "backup_age_check status=error reason=$v-not-an-integer"; exit 2;; esac
done

now="$(date +%s)"

# Newest verified base backup: .verified marker mtime = verification time.
newest_backup=""
newest_ts=0
if [ -d "$BACKUP_DIR" ]; then
  while IFS= read -r marker; do
    ts="$(stat -c %Y "$marker")"
    if [ "$ts" -gt "$newest_ts" ]; then newest_ts="$ts"; newest_backup="$(dirname "$marker")"; fi
  done < <(find "$BACKUP_DIR" -mindepth 2 -maxdepth 2 -name .verified -path "*${BACKUP_LABEL}_*" 2>/dev/null)
fi

# Newest archived WAL segment (16M files, 24-hex-char names; also .backup
# history files are ignored on purpose — segments are the heartbeat).
newest_wal=""
newest_wal_ts=0
if [ -d "$ARCHIVE_DIR" ]; then
  newest_wal="$(find "$ARCHIVE_DIR" -maxdepth 1 -type f -regextype posix-extended \
                -regex '.*/[0-9A-F]{24}' -printf '%T@ %p\n' 2>/dev/null \
                | sort -rn | head -n1 | cut -d' ' -f2- || true)"
  if [ -n "$newest_wal" ]; then newest_wal_ts="$(stat -c %Y "$newest_wal")"; fi
fi

backup_age=-1; wal_age=-1
[ "$newest_ts" -gt 0 ]     && backup_age=$(( (now - newest_ts) / 60 ))
[ "$newest_wal_ts" -gt 0 ] && wal_age=$(( (now - newest_wal_ts) / 60 ))

reasons=""
[ "$backup_age" -ge 0 ] || reasons="$reasons no-verified-base-backup"
[ "$backup_age" -ge 0 ] && [ "$backup_age" -gt "$BACKUP_MAX_AGE_MINUTES" ] \
  && reasons="$reasons base-backup-stale(>${BACKUP_MAX_AGE_MINUTES}m)"
[ "$wal_age" -ge 0 ] || reasons="$reasons no-archived-wal"
[ "$wal_age" -ge 0 ] && [ "$wal_age" -gt "$WAL_MAX_AGE_MINUTES" ] \
  && reasons="$reasons wal-archive-stale(>${WAL_MAX_AGE_MINUTES}m)"

if [ -n "$reasons" ]; then
  printf 'backup_age_check status=stale backup_age_min=%s wal_age_min=%s backup=%s wal=%s reasons="%s"\n' \
    "$backup_age" "$wal_age" "${newest_backup:-none}" "${newest_wal:-none}" "${reasons# }"
  exit 1
fi

printf 'backup_age_check status=ok backup_age_min=%s wal_age_min=%s backup=%s wal=%s\n' \
  "$backup_age" "$wal_age" "$newest_backup" "$newest_wal"
exit 0
