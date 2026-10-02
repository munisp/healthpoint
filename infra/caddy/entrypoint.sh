#!/bin/sh
# Caddy entrypoint: start with the Caddyfile (L7 HTTP/HTTPS apps), then load
# the Layer 4 (TCP/mTLS) config through the admin API once it is up.
#
# Audit P0-2: previously the CMD only ran `caddy run --config Caddyfile`, so
# layer4.json was never loaded and every L4 listener (Kafka 9093, Temporal
# 7234, TigerBeetle 3001, Redis 6380, OpenSearch 9201) was dead config.
#
# We POST the layer4 app to /config/apps/layer4 instead of POSTing the whole
# file to /load: /load would REPLACE the entire running config and clobber
# the HTTP/TLS apps adapted from the Caddyfile.
set -eu

CADDY_ADMIN_API="${CADDY_ADMIN_API:-http://127.0.0.1:2019}"
LAYER4_CONFIG="${LAYER4_CONFIG:-/etc/caddy/layer4.json}"

echo "[entrypoint] starting caddy with /etc/caddy/Caddyfile"
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
CADDY_PID=$!

echo "[entrypoint] waiting for caddy admin API on ${CADDY_ADMIN_API}"
TRIES=0
until wget -qO- "${CADDY_ADMIN_API}/config/" >/dev/null 2>&1; do
  TRIES=$((TRIES + 1))
  if [ "$TRIES" -ge 60 ]; then
    echo "[entrypoint] ERROR: caddy admin API did not come up after 30s" >&2
    kill "$CADDY_PID" 2>/dev/null || true
    exit 1
  fi
  sleep 0.5
done

if [ -f "$LAYER4_CONFIG" ]; then
  echo "[entrypoint] loading layer4 config from ${LAYER4_CONFIG}"
  if wget -q --post-file="$LAYER4_CONFIG" \
      --header="Content-Type: application/json" \
      -O /dev/null "${CADDY_ADMIN_API}/config/apps/layer4"; then
    echo "[entrypoint] layer4 config loaded"
  else
    echo "[entrypoint] ERROR: failed to load layer4 config" >&2
    kill "$CADDY_PID" 2>/dev/null || true
    exit 1
  fi
else
  echo "[entrypoint] WARNING: ${LAYER4_CONFIG} not found; layer4 listeners disabled" >&2
fi

wait "$CADDY_PID"
