# HealthPoint IDR — Deployment Guide

This guide reflects what actually exists in this repository on branch
`assurance/remediation-2026-09-05`. The previous version of this document
described supervisor/python scripts and MLflow services that do not exist in
this repo; it has been replaced.

## Architecture (as deployed)

```
Internet → Caddy (TLS, HTTP/3, Coraza WAF) → OpenAppsec → APISIX → app (Express 5 + tRPC, port 3000)
```

| Tier | Components | How they run |
|---|---|---|
| App | `app` (Node 22, serves the built React SPA), `ai-service`, `lakehouse-worker`, `temporal-worker` (Python), `go-services` (Go), `rust-services` (Rust) | built from in-repo Dockerfiles |
| Datastores | PostgreSQL 16, Redis 7, Kafka 3.7 (+ Zookeeper), OpenSearch 2.14, MinIO, Temporal, TigerBeetle | pinned upstream images |
| Platform | Keycloak 26, Permify, APISIX + etcd, OpenAppsec, Caddy | pinned upstream / local build |
| Optional | Mojaloop simulator (`--profile simulation`, dev only) | upstream image |

Dapr and Fluvio were removed (orphan infrastructure with zero application
adoption). Kafka is the only event backbone; services talk to Redis/Temporal/
PostgreSQL directly.

## 1. Local development / integration stack

Prerequisites: Docker with Compose v2, Node 22 + pnpm (only for host-side dev).

```bash
cp .env.example .env        # fill in values; see comments in the file
bash infra/caddy/gen-internal-certs.sh   # internal mTLS certs for Caddy L4
docker compose up -d
```

Startup order is enforced by healthchecks (`postgres` → `migrate` job runs
`pnpm drizzle-kit migrate` → `app` starts). Verify:

```bash
docker compose ps                     # all services healthy
curl -sf http://localhost:3000/api/health   # app health (checks DB)
```

Useful endpoints (dev):

| URL | What |
|---|---|
| http://localhost:3000 | app (direct) |
| https://localhost | app via Caddy → OpenAppsec → APISIX (self-signed cert) |
| http://localhost:8080/admin | Keycloak (bootstrap admin from `.env`) |
| http://localhost:8088 | Temporal UI |
| http://localhost:5601 | OpenSearch Dashboards |
| http://localhost:9001 | MinIO console |

Dev-only port mappings are marked `DEV ONLY` in `docker-compose.yml`; the
production overlay does not publish them.

## 2. Production with Docker Compose (single-node / small deployments)

```bash
# Validate the merged configuration first
docker compose -f docker-compose.yml -f docker-compose.production.yml config

# Deploy (all secrets below are MANDATORY — startup fails closed without them)
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d
```

`docker-compose.production.yml` requires (non-exhaustive): `DATABASE_URL`
(SSL-enabled), `JWT_SECRET`, `SETTLEMENT_CALLBACK_SECRET`,
`SETTLEMENT_CALLBACK_KEYRING`, `SETTLEMENT_MTLS_CLIENT_CA_PEM`,
`SETTLEMENT_MTLS_CLIENT_FINGERPRINTS`, `SETTLEMENT_MTLS_INGRESS_TOKEN`,
`INTERNAL_SERVICE_TOKEN`, `BACKUP_ENCRYPTION_PASSPHRASE`,
`EMR_CREDENTIALS_ENCRYPTION_KEY`, `MOJALOOP_URL`. Generate random values with
`openssl rand -hex 32`.

For externally managed datastores (RDS, MSK, etc.) use
`docker-compose.deploy.yml`, which contains only the app + go-services
contracts against external endpoints.

`PAYMENT_EXECUTION_MODE` stays `disabled` or `sandbox`; live payment
initiation is not implemented.

## 3. Production with Kubernetes (Helm)

Chart: `deploy/helm/healthpoint/` — **application tier only**. Datastores are
provisioned separately via their operators/charts (bitnami patterns are listed
in `values.yaml` under `datastores:` and in the chart's install notes).

```bash
# 1. Install datastores (example: bitnami charts; see values.yaml comments)
helm install postgresql oci://registry-1.docker.io/bitnamicharts/postgresql --set auth.database=idr_demo
# ... redis, kafka, opensearch, minio, keycloak, temporal, apisix (+etcd)

# 2. Create application secrets (never commit real values)
#    See docs/SECRETS.md — sealed-secrets or external-secrets recommended.
kubectl create namespace healthpoint
#    ... create secret healthpoint-secrets per docs/SECRETS.md ...

# 3. Install the app tier (pin digests in a production values file — see
#    docs/UPGRADES.md)
helm upgrade --install healthpoint deploy/helm/healthpoint \
  -n healthpoint \
  --set global.imageRegistry=ghcr.io/munisp \
  -f my-prod-values.yaml

# 4. Verify
kubectl get pods -n healthpoint
kubectl port-forward svc/healthpoint-healthpoint-server 3000:3000 -n healthpoint
curl -sf http://localhost:3000/healthz
curl -sf http://localhost:3000/readyz
```

The legacy chart at `helm/idr-platform/` is superseded and kept for reference
only. The `kubernetes/` kustomize tree is legacy (it references fictional
`healthpoint/*` microservice images) — do not use it for new deployments.

## 4. Repository cleanup (one-time owner step)

The audit-approved orphan trees (26 template dashboards + the
`idr-workflow-demo/` duplicate app) are removed with:

```bash
./scripts/cleanup-orphans.sh          # dry run
./scripts/cleanup-orphans.sh --apply  # git rm -r the enumerated paths
git commit -m "chore(cleanup): remove orphan template dashboards and idr-workflow-demo"
```

## 5. Supply chain / upgrades

- All first-party images in the Helm chart default to the chart `appVersion`
  and support digest pinning via `<component>.image.digest`.
- Third-party `:latest` tags remaining in `docker-compose.yml` are
  release-blocking; see the inventory and the digest-pinning workflow in
  `docs/UPGRADES.md`.

## Troubleshooting

| Symptom | Check |
|---|---|
| `app` container keeps restarting | `docker compose logs migrate` — migrations must succeed first; verify `DATABASE_URL` |
| `validateEnv` startup failure | missing mandatory env var — the error message names it |
| Keycloak login loop | realm import: `docker compose logs keycloak`; redirect URIs in `keycloak/` realm JSON vs `VITE_APP_URL` |
| Kafka consumers lag/no messages | `docker compose logs kafka-init` — topics are created there |
| Caddy L4 mTLS failures | rerun `infra/caddy/gen-internal-certs.sh`; check `infra/caddy/layer4.json` |
| Helm pods ImagePullBackOff | image tag/digest not set — chart fails fast if both are empty; see `docs/UPGRADES.md` |
