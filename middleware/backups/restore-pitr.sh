#!/usr/bin/env bash
# restore-pitr.sh — point-in-time recovery (PITR) of a base backup to a
# scratch data directory, replaying archived WAL up to a target time.
#
# What it does (PG16 mechanics):
#   1. Copies the chosen base backup into RESTORE_DIR (never restores in
#      place — the original backup stays pristine for forensic re-runs).
#   2. Writes recovery.signal and appends restore_command /
#      recovery_target_time / recovery_target_action=promote to
#      postgresql.auto.conf.
#   3. Optionally starts the restored cluster on RESTORE_PORT and waits for
#      recovery to reach the target and promote.
#
# Usage:
#   ./restore-pitr.sh --backup /backups/base_20260905T120000Z \
#                     --archive-dir /wal-archive \
#                     --restore-dir /scratch/pitr-restore \
#                     --target-time "2026-09-05 12:34:56 UTC" \
#                     [--port 55442] [--start]
#
# Env:
#   PGBIN   dir containing pg_ctl/pg_controldata (needed only with --start)
#
# Exit: 0 restore configured (and promoted, if --start) | 1 failure | 2 usage
set -euo pipefail

log() { printf '[restore-pitr %s] %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }
die() { log "ERROR: $*"; exit "${2:-1}"; }

BACKUP="" ARCHIVE_DIR="" RESTORE_DIR="" TARGET_TIME="" PORT="" START=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --backup)       BACKUP="$2"; shift 2;;
    --archive-dir)  ARCHIVE_DIR="$2"; shift 2;;
    --restore-dir)  RESTORE_DIR="$2"; shift 2;;
    --target-time)  TARGET_TIME="$2"; shift 2;;
    --port)         PORT="$2"; shift 2;;
    --start)        START=1; shift;;
    *) die "unknown argument: $1" 2;;
  esac
done

[ -n "$BACKUP" ]      || die "--backup is required" 2
[ -n "$ARCHIVE_DIR" ] || die "--archive-dir is required" 2
[ -n "$RESTORE_DIR" ] || die "--restore-dir is required" 2
[ -n "$TARGET_TIME" ] || die "--target-time is required" 2
[ -d "$BACKUP" ]      || die "backup dir not found: $BACKUP"
[ -d "$ARCHIVE_DIR" ] || die "WAL archive dir not found: $ARCHIVE_DIR"
[ -f "$BACKUP/.verified" ] || log "WARNING: $BACKUP has no .verified marker (not checked by pg_verifybackup)"

PGBIN="${PGBIN:-}"
PATH="${PGBIN:+$PGBIN:}$PATH"

if [ -e "$RESTORE_DIR" ]; then
  die "restore dir already exists: $RESTORE_DIR (refusing to clobber; remove it yourself)" 2
fi

# ── 1. Stage the backup into the scratch restore dir ─────────────────────────
log "staging $BACKUP -> $RESTORE_DIR"
mkdir -p "$(dirname "$RESTORE_DIR")"
cp -a -- "$BACKUP" "$RESTORE_DIR"
rm -f "$RESTORE_DIR"/postmaster.pid "$RESTORE_DIR"/postmaster.opts
chmod 0700 "$RESTORE_DIR"

# A base backup may contain WAL streamed at backup time under pg_wal; keep it
# (it is replayed first), restore_command supplies everything after that.
# ── 2. Configure PITR (PG16: recovery.signal + postgresql.auto.conf) ─────────
: > "$RESTORE_DIR/recovery.signal"
cat >> "$RESTORE_DIR/postgresql.auto.conf" <<EOF

# ── PITR settings written by restore-pitr.sh ($(date -u +%FT%TZ)) ──
restore_command = 'cp "$ARCHIVE_DIR/%f" "%p"'
recovery_target_time = '$TARGET_TIME'
recovery_target_action = 'promote'
recovery_target_timeline = 'latest'
EOF
log "configured recovery_target_time='$TARGET_TIME' restore_command from $ARCHIVE_DIR"

# ── 3. Optionally start and wait for promotion ───────────────────────────────
if [ "$START" -eq 1 ]; then
  [ -n "$PORT" ] || die "--port is required with --start" 2
  command -v pg_ctl >/dev/null || die "pg_ctl not found (set PGBIN)" 2
  # Pin the scratch instance to its own port/socket and UTC so the target
  # time is interpreted unambiguously.
  cat >> "$RESTORE_DIR/postgresql.auto.conf" <<EOF
port = $PORT
listen_addresses = '127.0.0.1'
unix_socket_directories = '$RESTORE_DIR'
timezone = 'UTC'
log_timezone = 'UTC'
EOF
  log "starting restored cluster on port $PORT"
  pg_ctl -D "$RESTORE_DIR" -l "$RESTORE_DIR/restore.log" -w -t 300 start >&2
  log "waiting for recovery to reach target and promote"
  for _ in $(seq 1 300); do
    if pg_controldata "$RESTORE_DIR" 2>/dev/null | grep -q "Database cluster state:.*in production"; then
      break
    fi
    sleep 1
  done
  STATE="$(pg_controldata "$RESTORE_DIR" | awk -F: '/Database cluster state/{gsub(/^[ \t]+|[ \t]+$/,"",$2); print $2}')"
  [ "$STATE" = "in production" ] || die "cluster did not promote (state: ${STATE:-unknown}); see $RESTORE_DIR/restore.log"
  log "promoted; PITR complete (state: $STATE)"
fi

printf 'RESTORE_DIR=%s\n' "$RESTORE_DIR"
exit 0
