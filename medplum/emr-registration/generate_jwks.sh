#!/bin/bash
# HealthPoint SMART on FHIR — JWKS Key Generation Script
# ========================================================
# Generates RSA-2048 key pair for Epic private_key_jwt authentication.
# Run this ONCE and store the private key in Vault.
# The public JWKS is served at https://fhir.healthpoint.io/.well-known/jwks.json

set -euo pipefail

KEYS_DIR="$(dirname "$0")/keys"
mkdir -p "$KEYS_DIR"

echo "=== Generating RSA-2048 private key ==="
openssl genrsa -out "$KEYS_DIR/healthpoint-epic-private.pem" 2048

echo "=== Extracting public key ==="
openssl rsa -in "$KEYS_DIR/healthpoint-epic-private.pem" \
  -pubout -out "$KEYS_DIR/healthpoint-epic-public.pem"

echo "=== Generating JWKS from public key ==="
python3 - <<'PYEOF'
import json
import base64
import hashlib
from cryptography.hazmat.primitives.serialization import load_pem_public_key
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey

with open("keys/healthpoint-epic-public.pem", "rb") as f:
    pub_key = load_pem_public_key(f.read())

pub_numbers = pub_key.public_key().public_numbers() if hasattr(pub_key, 'public_key') else pub_key.public_numbers()

def int_to_base64url(n):
    length = (n.bit_length() + 7) // 8
    return base64.urlsafe_b64encode(n.to_bytes(length, 'big')).rstrip(b'=').decode()

# Compute key ID (SHA-256 thumbprint)
n_bytes = pub_numbers.n.to_bytes((pub_numbers.n.bit_length() + 7) // 8, 'big')
e_bytes = pub_numbers.e.to_bytes((pub_numbers.e.bit_length() + 7) // 8, 'big')
thumbprint_input = json.dumps(
    {"e": base64.urlsafe_b64encode(e_bytes).rstrip(b'=').decode(),
     "kty": "RSA",
     "n": base64.urlsafe_b64encode(n_bytes).rstrip(b'=').decode()},
    separators=(',', ':'), sort_keys=True
).encode()
kid = base64.urlsafe_b64encode(hashlib.sha256(thumbprint_input).digest()).rstrip(b'=').decode()

jwks = {
    "keys": [{
        "kty": "RSA",
        "use": "sig",
        "alg": "RS384",
        "kid": kid,
        "n": int_to_base64url(pub_numbers.n),
        "e": int_to_base64url(pub_numbers.e),
    }]
}

with open("keys/jwks.json", "w") as f:
    json.dump(jwks, f, indent=2)

print(f"JWKS written to keys/jwks.json")
print(f"Key ID (kid): {kid}")
print()
print("Next steps:")
print("1. Store private key in Vault: vault kv put secret/healthpoint/epic-private-key @keys/healthpoint-epic-private.pem")
print("2. Serve keys/jwks.json at https://fhir.healthpoint.io/.well-known/jwks.json")
print("3. Register the kid in Epic App Orchard under 'Public Keys'")
PYEOF

echo ""
echo "=== DONE ==="
echo "Private key: $KEYS_DIR/healthpoint-epic-private.pem (STORE IN VAULT, DELETE LOCALLY)"
echo "Public JWKS: $KEYS_DIR/jwks.json (SERVE AT /.well-known/jwks.json)"
