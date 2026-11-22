#!/usr/bin/env bash
# base-backup.sh — labeled, verified Postgres base backup (pg_basebackup + pg_verifybackup).
#
# Takes a physical base backup over the replication protocol, verifies it
# with pg_verifybackup against the server-generated backup_manifest, stamps
# a success marker consumed by backup-age-check.sh, mirrors to
# BACKUP_OFFSITE_DIR when set, and prunes backups older than
# BACKUP_RETENTION_DAYS (only backups that have passed verification are ever
# pruned; failed/partial backups are kept for forensics).
#
# Usage:
#   PGHOST=postgres PGUSER=replicator PGPASSWORD=... bash ./base-backup.sh
#
# Env:
#   PGHOST PGPORT PGUSER PGPASSWORD   standard libpq vars (PGHOST may be a
#                                     socket dir; PGPORT default 5432)
#   BACKUP_DIR             (required) base backup root
#   BACKUP_LABEL           backup label prefix (default: base)
#   BACKUP_RETENTION_DAYS  keep verified backups this many days (default: 7)
#   BACKUP_OFFSITE_DIR     optional second-copy root (rsync -a --delete of
#                          the new backup only; never pruned by this script)
#   PGBIN                  dir containing pg_basebackup/pg_verifybackup
#                          (default: PATH lookup)
#
# Output line on success:  BACKUP_PATH=<dir>
# Exit: 0 ok | 1 backup/verify failed | 2 usage/env error
set -euo pipefail

log() { printf '[base-backup %s] %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }
die() { log "ERROR: $1"; exit "${2:-1}"; }

: "${BACKUP_DIR:?BACKUP_DIR must be set to the base backup root}"
PGPORT="${PGPORT:-5432}"
BACKUP_LABEL="${BACKUP_LABEL:-base}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
PGBIN="${PGBIN:-}"
PATH="${PGBIN:+$PGBIN:}$PATH"

command -v pg_basebackup   >/dev/null || die "pg_basebackup not found (set PGBIN)" 2
command -v pg_verifybackup >/dev/null || die "pg_verifybackup not found (set PGBIN)" 2
case "$BACKUP_RETENTION_DAYS" in ''|*[!0-9]*) die "BACKUP_RETENTION_DAYS must be an integer" 2;; esac

TS="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_DIR/${BACKUP_LABEL}_${TS}"
mkdir -p "$BACKUP_DIR"

# ── Take the backup ──────────────────────────────────────────────────────────
# --wal-method=stream bundles the WAL needed for consistency into the backup;
# -c fast forces an immediate checkpoint so the backup starts promptly;
# --checkpoint=fast + progress for operability. Plain format so
# pg_verifybackup can validate every file against backup_manifest.
log "pg_basebackup -> $DEST (host=${PGHOST:-local-socket} port=$PGPORT)"
bb_args=(
  --pgdata="$DEST"
  --format=plain
  --wal-method=stream
  --checkpoint=fast
  --progress
  --label="${BACKUP_LABEL}_${TS}"
  --port="$PGPORT"
)
[ -n "${PGHOST:-}" ] && bb_args+=(--host="$PGHOST")
[ -n "${PGUSER:-}" ] && bb_args+=(--username="$PGUSER")
if ! pg_basebackup "${bb_args[@]}"; then
  die "pg_basebackup failed; leaving partial dir $DEST for forensics"
fi

# ── Verify against the server manifest ───────────────────────────────────────
if pg_verifybackup "$DEST" >&2; then
  date -u +%FT%TZ > "$DEST/.verified"
  log "pg_verifybackup OK: $DEST"
else
  die "pg_verifybackup FAILED: $DEST is not restorable"
fi

# ── Optional offsite second copy ─────────────────────────────────────────────
if [ -n "${BACKUP_OFFSITE_DIR:-}" ]; then
  mkdir -p "$BACKUP_OFFSITE_DIR"
  rsync -a --delete "$DEST/" "$BACKUP_OFFSITE_DIR/$(basename "$DEST")/" \
    || die "offsite copy to $BACKUP_OFFSITE_DIR failed"
  log "offsite copy -> $BACKUP_OFFSITE_DIR/$(basename "$DEST")"
fi

# ── Retention pruning (verified backups only) ────────────────────────────────
if [ "$BACKUP_RETENTION_DAYS" -gt 0 ]; then
  pruned=0
  while IFS= read -r old; do
    if [ -f "$old/.verified" ]; then
      rm -rf -- "$old"
      log "pruned expired backup: $old"
      pruned=$((pruned + 1))
    else
      log "keeping unverified backup past retention (forensics): $old"
    fi
  done < <(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d \
             -name "${BACKUP_LABEL}_*" -mtime "+$BACKUP_RETENTION_DAYS" | sort)
  log "retention: pruned $pruned backup(s) older than ${BACKUP_RETENTION_DAYS}d"
fi

printf 'BACKUP_PATH=%s\n' "$DEST"
exit 0
