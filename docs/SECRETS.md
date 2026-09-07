# Secrets Management

HealthPoint **never** stores real secret values in git. Manifests and the Helm
chart reference Secrets **by name and key only** (`secretKeyRef`). This document
lists every required secret and three supported ways to create it.

## Required Secrets

| Secret | Key | Used by | Notes |
|---|---|---|---|
| `healthpoint-secrets` | `database-url` | server, python-worker | PostgreSQL DSN; `sslmode=verify-ca` in prod |
| `healthpoint-secrets` | `jwt-secret` | server | `openssl rand -hex 32` |
| `healthpoint-secrets` | `redis-url` | server | includes password |
| `healthpoint-secrets` | `scheduled-secret` | server | protects `/api/scheduled/*` |
| `healthpoint-secrets` | `keycloak-client-secret` | server | from Keycloak client credentials |
| `healthpoint-secrets` | `settlement-callback-secret` | server | HMAC for provider callbacks |
| `healthpoint-secrets` | `settlement-callback-keyring` | server | versioned keyring |
| `healthpoint-secrets` | `settlement-mtls-client-ca-pem` | server | provider CA PEM |
| `healthpoint-secrets` | `settlement-mtls-client-fingerprints` | server | SHA-256 allow-list |
| `healthpoint-secrets` | `settlement-mtls-ingress-token` | server | >= 32 random chars |
| `healthpoint-secrets` | `internal-service-token` | server, go-ledger | service-to-service bearer |
| `healthpoint-secrets` | `s3-access-key` / `s3-secret-key` | server | MinIO/S3 credentials |
| `healthpoint-secrets` | `temporal-auth-token` (optional) | server, python-worker | Temporal Cloud/mTLS only |
| `healthpoint-secrets` | `llm-api-key` (optional) | server, ai-service | AI features only |
| `healthpoint-secrets` | `backup-encryption-passphrase` (optional) | backup jobs | |
| `healthpoint-secrets` | `emr-credentials-encryption-key` (optional) | server | 64-char hex AES-256 key |
| `healthpoint-tls` | `tls.crt` / `tls.key` | ingress | prefer cert-manager |

The full key list with placeholders lives in `deploy/k8s/secrets.example.yaml`.

## Option A — kubectl (dev / break-glass only)

```bash
kubectl create namespace healthpoint
kubectl create secret generic healthpoint-secrets -n healthpoint \
  --from-literal=database-url="$DATABASE_URL" \
  --from-literal=jwt-secret="$(openssl rand -hex 32)" \
  --from-literal=redis-url="$REDIS_URL" \
  --from-literal=scheduled-secret="$(openssl rand -hex 32)" \
  --from-literal=keycloak-client-secret="$KEYCLOAK_CLIENT_SECRET" \
  --from-literal=settlement-callback-secret="$SETTLEMENT_CALLBACK_SECRET" \
  --from-literal=settlement-callback-keyring="$SETTLEMENT_CALLBACK_KEYRING" \
  --from-literal=settlement-mtls-client-ca-pem="$SETTLEMENT_MTLS_CLIENT_CA_PEM" \
  --from-literal=settlement-mtls-client-fingerprints="$SETTLEMENT_MTLS_CLIENT_FINGERPRINTS" \
  --from-literal=settlement-mtls-ingress-token="$SETTLEMENT_MTLS_INGRESS_TOKEN" \
  --from-literal=internal-service-token="$(openssl rand -hex 32)" \
  --from-literal=s3-access-key="$S3_ACCESS_KEY" \
  --from-literal=s3-secret-key="$S3_SECRET_KEY"
```

Values come from your shell environment or a password manager — never from a
file committed to the repo. Shell history warning: prefer `--from-env-file`
with a `0600` scratch file deleted afterwards.

## Option B — Sealed Secrets (recommended for GitOps)

```bash
# 1. Fill a copy of the template locally (outside the repo)
cp deploy/k8s/secrets.example.yaml /tmp/healthpoint-secrets.yaml
$EDITOR /tmp/healthpoint-secrets.yaml

# 2. Seal it against the cluster's public key
kubeseal --controller-namespace sealed-secrets \
  < /tmp/healthpoint-secrets.yaml \
  > deploy/k8s/sealed/healthpoint-secrets.sealed.yaml

# 3. The SealedSecret is safe to commit; the plaintext scratch file is not
shred -u /tmp/healthpoint-secrets.yaml
```

## Option C — External Secrets Operator (recommended with a cloud KMS/Vault)

Keep values in AWS Secrets Manager / GCP Secret Manager / Vault and sync:

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: healthpoint-secrets
  namespace: healthpoint
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: cluster-secret-store   # your ClusterSecretStore
    kind: ClusterSecretStore
  target:
    name: healthpoint-secrets
  data:
    - secretKey: database-url
      remoteRef: { key: healthpoint/prod, property: database-url }
    # ... one entry per key in the table above
```

## Rotation

1. Create the new value in your secret store (or re-seal).
2. `kubectl rollout restart deploy/<release>-healthpoint-server` (and
   `go-ledger`, `python-worker`, `rust-processor`) — env-var secrets are only
   read at pod start.
3. For `settlement-callback-keyring`, add the new key version alongside the
   old one, wait for in-flight callbacks, then remove the old version.

## What NOT to do

- Do not commit real values (CI blocks obvious patterns; reviewers must too).
- Do not put secrets in Helm `values.yaml` — the chart has no value that
  accepts a secret value by design.
- Do not reuse dev defaults from `docker-compose.yml` in production.
