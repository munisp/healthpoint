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
#   3. Sanity-checks the target time: it must be later than the base
#      backup's START TIME (parsed from backup_label) and not in the future
#      (beyond a 60s clock-skew margin) — a typo'd target fails loudly
#      instead of silently restoring the wrong point.
#   4. Optionally starts the restored cluster on RESTORE_PORT and waits for
#      recovery to reach the target and promote; fails fast if the
#      postmaster dies mid-recovery. The restored cluster gets
#      archive_mode=off so it never archives into the source archive.
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
die() { log "ERROR: $1"; exit "${2:-1}"; }

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

# ── Target-time sanity check (guards against typos silently "succeeding") ────
# The chosen base backup can only roll FORWARD from its own start time, and a
# target in the future makes recovery wait/FATAL forever. Enforce:
#   backup_start < target_time <= now + 60s margin
BACKUP_LABEL_FILE="$BACKUP/backup_label"
[ -f "$BACKUP_LABEL_FILE" ] || die "backup_label missing in $BACKUP (not a plain-format pg_basebackup?)"
START_LINE="$(grep -m1 '^START TIME:' "$BACKUP_LABEL_FILE" || true)"
[ -n "$START_LINE" ] || die "no START TIME line in $BACKUP_LABEL_FILE"
BACKUP_START_RAW="${START_LINE#START TIME: }"
BACKUP_START_TS="$(date -u -d "$BACKUP_START_RAW" +%s 2>/dev/null)" \
  || die "could not parse backup START TIME: '$BACKUP_START_RAW'"
TARGET_TS="$(date -u -d "$TARGET_TIME" +%s 2>/dev/null)" \
  || die "could not parse --target-time '$TARGET_TIME' (use e.g. '2026-09-05 12:34:56 UTC')"
NOW_TS="$(date -u +%s)"
if [ "$TARGET_TS" -le "$BACKUP_START_TS" ]; then
  die "target time '$TARGET_TIME' is at/before the base backup start ($BACKUP_START_RAW) — nothing to replay; pick a later target or an earlier backup" 2
fi
if [ "$TARGET_TS" -gt $((NOW_TS + 60)) ]; then
  die "target time '$TARGET_TIME' is in the future (now + 60s margin exceeded) — refusing a recovery that can never complete" 2
fi
log "target-time sanity OK: backup start $BACKUP_START_RAW < target '$TARGET_TIME' <= now+60s"

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
# A restored cluster must NOT archive its new-timeline WAL back into the
# source archive it is recovering from (corruption/collision risk).
archive_mode = off
EOF
  log "starting restored cluster on port $PORT"
  pg_ctl -D "$RESTORE_DIR" -l "$RESTORE_DIR/restore.log" -w -t 300 start >&2
  log "waiting for recovery to reach target and promote"
  for _ in $(seq 1 300); do
    # Fail fast if the postmaster died (e.g. unreachable recovery target
    # FATALs) instead of burning the whole 300s poll budget.
    if ! pg_ctl -D "$RESTORE_DIR" status >/dev/null 2>&1; then
      log "postmaster exited during recovery; last log lines:"
      tail -30 "$RESTORE_DIR/restore.log" >&2 || true
      die "recovery failed (postmaster died); see $RESTORE_DIR/restore.log"
    fi
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
