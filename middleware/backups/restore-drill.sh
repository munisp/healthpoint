#!/usr/bin/env bash
# restore-drill.sh — fully automated backup → destroy → PITR-restore drill.
#
# THE money script. Proves, end to end and from scratch, that a HealthPoint
# Postgres cluster can be recovered to a chosen second after a total loss of
# its data directory (ransomware scenario), using nothing but a verified base
# backup plus the WAL archive.
#
# Sequence (all inside DRILL_ROOT; nothing outside it is touched):
#   1. initdb a throwaway source cluster on DRILL_SOURCE_PORT with WAL
#      archiving through archive-command.sh
#   2. take a labeled base backup via base-backup.sh (pg_verifybackup gate)
#   3. insert "canary-before" rows, force WAL switch, capture TARGET_TIME
#   4. insert "canary-after" rows (the data a ransom detonation would lose),
#      force WAL switch, wait for archive
#   5. DISASTER: kill the source hard (immediate) and wipe its data dir
#   6. restore-pitr.sh to TARGET_TIME on DRILL_RESTORE_PORT; promote
#   7. VERIFY: canary-before rows present, canary-after rows absent
#   8. print PASS/FAIL report, teardown
#
# Idempotent: a previous drill's scratch dirs/servers under DRILL_ROOT are
# stopped and removed first. Safe: never touches anything outside DRILL_ROOT.
#
# Env:
#   DRILL_ROOT          scratch root (default /tmp/hp-pitr-drill)
#   DRILL_SOURCE_PORT   source cluster port   (default 55441)
#   DRILL_RESTORE_PORT  restored cluster port (default 55442)
#   PGBIN               dir with PG16 binaries; if unset, common pgserver
#                       locations and PATH are searched
#   DRILL_KEEP=1        keep scratch dirs and the report after the run
#
# Exit: 0 PASS | 1 FAIL | 2 usage/environment error
set -euo pipefail

DRILL_ROOT="${DRILL_ROOT:-/tmp/hp-pitr-drill}"
SRC_PORT="${DRILL_SOURCE_PORT:-55441}"
DST_PORT="${DRILL_RESTORE_PORT:-55442}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORT="$DRILL_ROOT/drill-report.txt"

log() {
  if [ -f "$REPORT" ]; then
    printf '[restore-drill %s] %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$REPORT" >&2
  else
    printf '[restore-drill %s] %s\n' "$(date -u +%FT%TZ)" "$*" >&2
  fi
}
fail() { log "FAIL: $*"; drill_fail; }

drill_fail() {
  log "═══ DRILL RESULT: FAIL ═══"
  exit 1
}

# ── Locate PG16 binaries ─────────────────────────────────────────────────────
if [ -z "${PGBIN:-}" ]; then
  for cand in \
    /home/kimi/.local/lib/python3.12/site-packages/pgserver/pginstall/bin \
    /tmp/pgwheel/pgserver/pginstall/bin \
    /usr/lib/postgresql/*/bin \
    /usr/pgsql-16/bin; do
    if [ -x "$cand/initdb" ]; then PGBIN="$cand"; break; fi
  done
fi
if [ -n "${PGBIN:-}" ]; then
  PATH="$PGBIN:$PATH"
fi
for tool in initdb pg_ctl psql pg_basebackup pg_verifybackup pg_controldata pg_isready; do
  command -v "$tool" >/dev/null || { echo "ERROR: $tool not found; set PGBIN to a PG16 bin dir" >&2; exit 2; }
done
log "using PG binaries: $(command -v postgres) ($(postgres --version))"

# ── Refuse to collide with anything already listening on our ports ──────────
for p in "$SRC_PORT" "$DST_PORT"; do
  if pg_isready -h 127.0.0.1 -p "$p" >/dev/null 2>&1; then
    echo "ERROR: port $p already serves Postgres; set DRILL_SOURCE_PORT/DRILL_RESTORE_PORT" >&2
    exit 2
  fi
done

SRC_DIR="$DRILL_ROOT/source"
DST_DIR="$DRILL_ROOT/restored"
ARCHIVE_DIR="$DRILL_ROOT/wal-archive"
OFFSITE_DIR="$DRILL_ROOT/offsite"
BACKUP_DIR="$DRILL_ROOT/backups"
SOCK_DIR="$DRILL_ROOT/socket"
export ARCHIVE_DIR BACKUP_DIR BACKUP_OFFSITE_DIR="$OFFSITE_DIR"

# ── Idempotent cleanup of a previous drill (only inside DRILL_ROOT) ─────────
cleanup() {
  [ -d "$DST_DIR" ] && pg_ctl -D "$DST_DIR" -m fast -w stop >/dev/null 2>&1 || true
  [ -d "$SRC_DIR" ] && pg_ctl -D "$SRC_DIR" -m fast -w stop >/dev/null 2>&1 || true
}
trap cleanup EXIT
if [ -d "$DRILL_ROOT" ]; then
  cleanup
  rm -rf "$DRILL_ROOT"
fi
mkdir -p "$DRILL_ROOT" "$ARCHIVE_DIR" "$OFFSITE_DIR" "$BACKUP_DIR" "$SOCK_DIR"
: > "$REPORT"
log "drill root: $DRILL_ROOT (source port $SRC_PORT, restore port $DST_PORT)"

psql_src() { psql -h 127.0.0.1 -p "$SRC_PORT" -U postgres -At -v ON_ERROR_STOP=1 "$@"; }
psql_dst() { psql -h 127.0.0.1 -p "$DST_PORT" -U postgres -At -v ON_ERROR_STOP=1 "$@"; }

# ── 1. Source cluster with WAL archiving ─────────────────────────────────────
log "step 1: initdb source cluster"
initdb -D "$SRC_DIR" -U postgres --auth=trust --encoding=UTF8 >>"$REPORT" 2>&1
cat >> "$SRC_DIR/postgresql.auto.conf" <<EOF
port = $SRC_PORT
listen_addresses = '127.0.0.1'
unix_socket_directories = '$SOCK_DIR'
timezone = 'UTC'
log_timezone = 'UTC'
wal_level = replica
archive_mode = on
archive_timeout = 60
archive_command = '$SCRIPT_DIR/archive-command.sh %p %f'
max_wal_senders = 4
EOF
pg_ctl -D "$SRC_DIR" -l "$SRC_DIR/server.log" -w -t 60 start >>"$REPORT" 2>&1 \
  || { tail -20 "$SRC_DIR/server.log" >&2; fail "source cluster failed to start"; }
log "source cluster up on port $SRC_PORT; archive_command -> $ARCHIVE_DIR (+ offsite $OFFSITE_DIR)"

archived_count() { psql_src -d postgres -c "SELECT archived_count FROM pg_stat_archiver"; }
wait_archive() {  # wait_archive <min-count>
  local want="$1" n=0
  for _ in $(seq 1 60); do
    n="$(archived_count)"
    [ "$n" -ge "$want" ] && { log "WAL archived_count=$n (>= $want)"; return 0; }
    sleep 1
  done
  fail "WAL archiving stalled (archived_count=$n < $want)"
}

# ── 2. Verified base backup ──────────────────────────────────────────────────
log "step 2: base backup via base-backup.sh (pg_verifybackup gate)"
BB_OUT="$(PGHOST=127.0.0.1 PGPORT="$SRC_PORT" PGUSER=postgres BACKUP_RETENTION_DAYS=7 \
          "$SCRIPT_DIR/base-backup.sh" 2>>"$REPORT")" || fail "base-backup.sh failed"
BASE_BACKUP="$(printf '%s\n' "$BB_OUT" | awk -F= '/^BACKUP_PATH=/{print $2}')"
[ -n "$BASE_BACKUP" ] && [ -f "$BASE_BACKUP/.verified" ] || fail "base backup missing or unverified"
log "base backup verified: $BASE_BACKUP"

# ── 3. Canary BEFORE the recovery target ─────────────────────────────────────
log "step 3: write canary-before rows"
psql_src -d postgres -c "CREATE DATABASE pitr_drill" >/dev/null
psql_src -d pitr_drill <<'SQL' >/dev/null
CREATE TABLE canary (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phase      text NOT NULL,
  written_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
SQL
psql_src -d pitr_drill -c "INSERT INTO canary(phase) SELECT 'before' FROM generate_series(1,3)" >/dev/null
BEFORE_WAL="$(archived_count)"
psql_src -d pitr_drill -c "SELECT pg_switch_wal()" >/dev/null
wait_archive "$((BEFORE_WAL + 1))"

# Target = now (UTC, second precision), safely after the before-rows commit.
TARGET_TIME="$(psql_src -d pitr_drill -c "SELECT to_char(clock_timestamp(), 'YYYY-MM-DD HH24:MI:SS')")"
log "recovery TARGET_TIME = $TARGET_TIME UTC"
sleep 2

# ── 4. Canary AFTER the target (must NOT survive PITR) ───────────────────────
log "step 4: write canary-after rows (post-target; must be absent after PITR)"
psql_src -d pitr_drill -c "INSERT INTO canary(phase) SELECT 'after' FROM generate_series(1,3)" >/dev/null
AFTER_WAL="$(archived_count)"
psql_src -d pitr_drill -c "SELECT pg_switch_wal()" >/dev/null
wait_archive "$((AFTER_WAL + 1))"
count_segments() {  # count archived 24-hex-char WAL segments in $1
  local n=0 f
  for f in "$1"/*; do
    case "$(basename "$f")" in
      ????????????????????????) [ -f "$f" ] && n=$((n + 1));;
    esac
  done
  echo "$n"
}
log "WAL segments in local archive: $(count_segments "$ARCHIVE_DIR")"
log "WAL segments in offsite copy: $(count_segments "$OFFSITE_DIR")"

# ── 5. DISASTER: kill + wipe ─────────────────────────────────────────────────
log "step 5: DISASTER — kill source (immediate) and wipe its data directory"
pg_ctl -D "$SRC_DIR" -m immediate stop >>"$REPORT" 2>&1 || true
rm -rf "$SRC_DIR"
[ ! -e "$SRC_DIR" ] || fail "failed to wipe $SRC_DIR"
log "source data dir destroyed; only base backup + WAL archive remain"

# ── 6. PITR restore to TARGET_TIME ───────────────────────────────────────────
log "step 6: restore-pitr.sh to '$TARGET_TIME' on port $DST_PORT"
"$SCRIPT_DIR/restore-pitr.sh" \
  --backup "$BASE_BACKUP" \
  --archive-dir "$ARCHIVE_DIR" \
  --restore-dir "$DST_DIR" \
  --target-time "$TARGET_TIME" \
  --port "$DST_PORT" --start >>"$REPORT" 2>&1 || fail "restore-pitr.sh failed"
log "restored cluster promoted on port $DST_PORT"

# ── 7. Verify canaries ───────────────────────────────────────────────────────
log "step 7: verify canary rows"
N_BEFORE="$(psql_dst -d pitr_drill -c "SELECT count(*) FROM canary WHERE phase='before'")"
N_AFTER="$(psql_dst -d pitr_drill -c "SELECT count(*) FROM canary WHERE phase='after'")"
log "recovered rows: before=$N_BEFORE (expect 3)  after=$N_AFTER (expect 0)"
[ "$N_BEFORE" = "3" ] || fail "canary-before rows lost: got $N_BEFORE, want 3"
[ "$N_AFTER" = "0" ]  || fail "canary-after rows leaked past target: got $N_AFTER, want 0"

# ── 8. Report ────────────────────────────────────────────────────────────────
log "verify: pg_verifybackup passed earlier; base backup + WAL archive sufficed for PITR"
log "═══ DRILL RESULT: PASS ═══"

cleanup
if [ "${DRILL_KEEP:-0}" != "1" ]; then
  rm -rf "$SRC_DIR" "$DST_DIR"
fi
log "report: $REPORT"
exit 0
