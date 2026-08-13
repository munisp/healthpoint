#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point to PostgreSQL}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE is required}"

BACKUP_OUTPUT_DIR="${BACKUP_OUTPUT_DIR:-./var/backups/postgres}"
mkdir -p "$BACKUP_OUTPUT_DIR"
chmod 700 "$BACKUP_OUTPUT_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
base="$BACKUP_OUTPUT_DIR/healthpoint_${timestamp}"
plain_dump="${base}.dump"
encrypted_dump="${base}.dump.gpg"
manifest="${base}.manifest.json"

cleanup() { rm -f "$plain_dump"; }
trap cleanup EXIT

pg_dump --format=custom --compress=9 --no-owner --no-privileges --file "$plain_dump" "$DATABASE_URL"
plain_sha256="$(sha256sum "$plain_dump" | awk '{print $1}')"

gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_ENCRYPTION_PASSPHRASE" \
  --symmetric --cipher-algo AES256 --output "$encrypted_dump" "$plain_dump"
chmod 600 "$encrypted_dump"
encrypted_sha256="$(sha256sum "$encrypted_dump" | awk '{print $1}')"

cat > "$manifest" <<EOF
{"createdAt":"$(date -u +%FT%TZ)","format":"pg_dump_custom","encryption":"gpg-aes256","plainSha256":"${plain_sha256}","encryptedSha256":"${encrypted_sha256}","file":"$(basename "$encrypted_dump")"}
EOF
chmod 600 "$manifest"
printf 'BACKUP_FILE=%s\nMANIFEST_FILE=%s\n' "$encrypted_dump" "$manifest"
