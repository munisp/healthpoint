#!/usr/bin/env bash
# archive-command.sh — Postgres WAL archive_command wrapper (PG16).
#
# Invoked by Postgres as: archive-command.sh <source-path-%p> <filename-%f>
#
# Behaviour:
#   1. Copies the WAL segment into ARCHIVE_DIR (fsync-safe: copy to a temp
#      file, fsync the file, atomic rename, fsync the directory).
#   2. If BACKUP_OFFSITE_DIR is set, writes a second copy there the same way
#      (simulates an S3 Object Lock / immutable bucket from the database's
#      point of view — wire BACKUP_OFFSITE_DIR to an rclone/aws-sync mount
#      or an off-host NFS export in real deployments).
#   3. NEVER exits 0 unless every copy succeeded. A non-zero exit makes
#      Postgres keep the segment in pg_wal and retry — WAL is never dropped
#      on transient archive failures.
#   4. Refuses to clobber an existing archive entry whose size differs
#      (guards against corruption); an identical re-archive is a no-op
#      success because Postgres may retry after a crash.
#
# Env:
#   ARCHIVE_DIR          (required) local WAL archive directory
#   BACKUP_OFFSITE_DIR   (optional) second, offsite/immutable copy directory
#
# Exit codes: 0 archived everywhere | 1 usage/env error | 2 copy/verify failed
set -euo pipefail

log() { printf '[archive-command %s] %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }
die() { log "ERROR: $*"; exit 2; }

if [ "$#" -ne 2 ]; then
  log "usage: archive-command.sh <wal-source-path> <wal-filename> (from archive_command %p %f)"
  exit 1
fi

SRC="$1"          # e.g. pg_wal/000000010000000000000001
FNAME="$2"        # e.g. 000000010000000000000001

: "${ARCHIVE_DIR:?ARCHIVE_DIR must be set to the local WAL archive directory}"

# fsync a file (portable: `sync -f` where supported, else full sync)
fsync_file() { sync -f "$1" 2>/dev/null || sync; }
fsync_dir()  { sync -f "$1" 2>/dev/null || sync; }

# archive_one <destdir> — fsync-safe copy with clobber guard.
archive_one() {
  local destdir="$1"
  local dest="$destdir/$FNAME"
  local tmp="$destdir/.$FNAME.tmp.$$"

  mkdir -p "$destdir"

  if [ -f "$dest" ]; then
    local src_size dest_size
    src_size="$(stat -c %s "$SRC")"
    dest_size="$(stat -c %s "$dest")"
    if [ "$src_size" = "$dest_size" ] && cmp -s "$SRC" "$dest"; then
      log "already archived identically: $dest (retry-after-crash no-op)"
      return 0
    fi
    die "refusing to overwrite differing archive entry $dest (src=${src_size}B dest=${dest_size}B)"
  fi

  cp -- "$SRC" "$tmp" || { rm -f "$tmp"; die "cp $SRC -> $tmp failed"; }
  fsync_file "$tmp"
  mv -n -- "$tmp" "$dest" || { rm -f "$tmp"; die "rename into $dest failed"; }
  fsync_dir "$destdir"

  # Post-copy verification: sizes must match exactly.
  local src_size dest_size
  src_size="$(stat -c %s "$SRC")"
  dest_size="$(stat -c %s "$dest")"
  [ "$src_size" = "$dest_size" ] || die "size mismatch after archive: $dest (src=${src_size}B dest=${dest_size}B)"
}

archive_one "$ARCHIVE_DIR"
log "archived $FNAME -> $ARCHIVE_DIR"

if [ -n "${BACKUP_OFFSITE_DIR:-}" ]; then
  archive_one "$BACKUP_OFFSITE_DIR"
  log "offsite copy $FNAME -> $BACKUP_OFFSITE_DIR"
fi

exit 0
