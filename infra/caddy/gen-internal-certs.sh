#!/usr/bin/env bash
# gen-internal-certs.sh
# Generates a self-signed internal CA and per-service mTLS certificates
# for Kafka, TigerBeetle, Temporal, Redis, OpenSearch, and Fluvio.
# Run once before starting the stack: ./infra/caddy/gen-internal-certs.sh
set -euo pipefail

CERTS_DIR="$(dirname "$0")/certs"
mkdir -p "$CERTS_DIR"

DAYS=3650
COUNTRY="US"
ORG="HealthPoint IDR"
CA_CN="HealthPoint Internal CA"

echo "==> Generating Internal CA..."
openssl genrsa -out "$CERTS_DIR/internal-ca.key" 4096
openssl req -new -x509 -days $DAYS \
  -key "$CERTS_DIR/internal-ca.key" \
  -out "$CERTS_DIR/internal-ca.pem" \
  -subj "/C=$COUNTRY/O=$ORG/CN=$CA_CN"

generate_cert() {
  local NAME=$1
  local CN=$2
  local SANS=$3

  echo "==> Generating cert for $NAME ($CN)..."

  openssl genrsa -out "$CERTS_DIR/$NAME.key" 2048

  openssl req -new \
    -key "$CERTS_DIR/$NAME.key" \
    -out "$CERTS_DIR/$NAME.csr" \
    -subj "/C=$COUNTRY/O=$ORG/CN=$CN"

  # SAN extension config
  cat > /tmp/${NAME}_ext.cnf <<EOF
[req]
req_extensions = v3_req
[v3_req]
subjectAltName = $SANS
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth, clientAuth
EOF

  openssl x509 -req -days $DAYS \
    -in "$CERTS_DIR/$NAME.csr" \
    -CA "$CERTS_DIR/internal-ca.pem" \
    -CAkey "$CERTS_DIR/internal-ca.key" \
    -CAcreateserial \
    -out "$CERTS_DIR/$NAME.pem" \
    -extfile /tmp/${NAME}_ext.cnf \
    -extensions v3_req

  rm -f "$CERTS_DIR/$NAME.csr" /tmp/${NAME}_ext.cnf
  echo "    -> $CERTS_DIR/$NAME.pem"
}

# Generate per-service certificates
generate_cert "kafka"       "kafka.healthpoint.internal"       "DNS:kafka,DNS:kafka.healthpoint.internal,IP:127.0.0.1"
generate_cert "tigerbeetle" "tigerbeetle.healthpoint.internal" "DNS:go-services,DNS:tigerbeetle.healthpoint.internal,IP:127.0.0.1"
generate_cert "temporal"    "temporal.healthpoint.internal"    "DNS:temporal,DNS:temporal.healthpoint.internal,IP:127.0.0.1"
generate_cert "redis"       "redis.healthpoint.internal"       "DNS:redis,DNS:redis.healthpoint.internal,IP:127.0.0.1"
generate_cert "opensearch"  "opensearch.healthpoint.internal"  "DNS:opensearch,DNS:opensearch.healthpoint.internal,IP:127.0.0.1"
generate_cert "fluvio"      "fluvio.healthpoint.internal"      "DNS:fluvio-sc,DNS:fluvio.healthpoint.internal,IP:127.0.0.1"
generate_cert "caddy-client" "caddy-client.healthpoint.internal" "DNS:caddy,DNS:caddy.healthpoint.internal,IP:127.0.0.1"

echo ""
echo "==> All certificates generated in $CERTS_DIR"
echo "    CA: $CERTS_DIR/internal-ca.pem"
echo ""
echo "    Mount $CERTS_DIR into the Caddy container at /etc/caddy/certs/"
echo "    Mount service certs into each service container."
