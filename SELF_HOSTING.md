# HealthPoint IDR — Self-Hosting Guide

This document covers running HealthPoint IDR on your own infrastructure. For
production deployments, also read [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md),
`docs/SECRETS.md`, and `docs/UPGRADES.md`.

---

## Architecture Overview

| Component | Technology | Default Port |
|---|---|---|
| **Web app** | Node.js 22 + Express 5 + tRPC + React 19 | 3000 |
| **Database** | PostgreSQL 16 | 5432 |
| **Authentication** | Keycloak 26 (OIDC) | 8080 |
| **File storage** | MinIO (S3-compatible) | 9000 (API), 9001 (console) |
| **Event backbone** | Kafka 3.7 | 9092 |
| **Workflows** | Temporal | 7233 |
| **Search** | OpenSearch 2.14 | 9200 |
| **Edge** | Caddy → OpenAppsec → APISIX | 443/80 |
| **AI features (optional)** | any OpenAI-compatible API | — |

---

## Quick Start (Docker Compose)

### 1. Clone the repository

```bash
git clone https://github.com/munisp/healthpoint.git
cd healthpoint
```

### 2. Create your environment file

```bash
cp .env.example .env
# Edit .env — at minimum set JWT_SECRET and the POSTGRES/REDIS passwords
```

### 3. Generate internal mTLS certificates (for the Caddy layer-4 routes)

```bash
bash infra/caddy/gen-internal-certs.sh
```

### 4. Start the stack

```bash
docker compose up -d
```

The compose file in the repo root is the real, maintained definition —
PostgreSQL 16, Redis 7, Kafka 3.7, Temporal, Keycloak, Permify, OpenSearch,
MinIO, TigerBeetle, APISIX + etcd, OpenAppsec, Caddy, plus the application
services built from in-repo Dockerfiles. Do not replace it with hand-written
compose snippets.

### 5. Keycloak realm

On first run, Keycloak automatically imports the `healthpoint` realm from
`keycloak/`. No manual steps required.

### 6. Open the app

Navigate to `http://localhost:3000`, or `https://localhost` through the Caddy
edge (self-signed certificate in dev — accept the browser warning).

---

## Environment Variables

Copy `.env.example` to `.env` and configure. The authoritative, commented list
lives in `.env.example`; the most important entries:

### Required

| Variable | Description | Example |
|---|---|---|
| `NODE_ENV` | Runtime environment | `production` |
| `JWT_SECRET` | Signs session cookies (min 32 chars) | `openssl rand -hex 32` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `KEYCLOAK_URL` | Keycloak base URL | `http://localhost:8080` |
| `KEYCLOAK_REALM` | Keycloak realm name | `healthpoint` |
| `KEYCLOAK_CLIENT_ID` | Keycloak client ID | `healthpoint-app` |

### Required in production (startup fails closed without them)

| Variable | Description |
|---|---|
| `SETTLEMENT_CALLBACK_SECRET` | HMAC secret for provider settlement callbacks |
| `SETTLEMENT_CALLBACK_KEYRING` | Versioned callback keyring |
| `SETTLEMENT_MTLS_CLIENT_CA_PEM` | CA PEM verifying provider mTLS client certs |
| `SETTLEMENT_MTLS_CLIENT_FINGERPRINTS` | Allowed provider cert SHA-256 fingerprints |
| `SETTLEMENT_MTLS_INGRESS_TOKEN` | High-entropy ingress token (>= 32 chars) |
| `SCHEDULED_SECRET` | Bearer token for `/api/scheduled/*` |

### Optional

| Variable | Description |
|---|---|
| `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` | MinIO/S3 object storage |
| `LLM_API_URL`, `LLM_API_KEY` | OpenAI-compatible endpoint for AI features |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins (production only) |
| `VITE_APP_URL`, `VITE_APP_TITLE`, `VITE_APP_LOGO` | Client build-time branding |
| `PERMIFY_URL`, `PERMIFY_TENANT` | Permify ReBAC (unset = PostgreSQL fallback) |
| `TEMPORAL_*` | Temporal execution (opt-in) |

---

## Keycloak Setup

The `healthpoint` realm is pre-configured and imported automatically on first start.

### Changing the client secret

1. Open `http://localhost:8080/admin` → log in with the bootstrap admin credentials
2. Navigate to **Clients** → **healthpoint-app** → **Credentials**
3. Click **Regenerate** and copy the new secret
4. Update `KEYCLOAK_CLIENT_SECRET` in your `.env`

### Adding redirect URIs for production

1. Open **Clients** → **healthpoint-app** → **Settings**
2. Add your production domain to **Valid redirect URIs** (e.g. `https://app.yourdomain.com/*`)
3. Add it to **Web origins** as well

---

## Production

Two supported paths — see [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md) for the
full procedure:

1. **Compose overlay** (single node):
   `docker compose -f docker-compose.yml -f docker-compose.production.yml up -d`
2. **Kubernetes**: `helm upgrade --install healthpoint deploy/helm/healthpoint`
   (secrets via `docs/SECRETS.md`; pin image digests per `docs/UPGRADES.md`).

### Production Checklist

- [ ] `NODE_ENV=production`
- [ ] Strong `JWT_SECRET` (`openssl rand -hex 32`)
- [ ] All settlement/mTLS secrets set (see table above)
- [ ] Keycloak redirect URIs and web origins set to your domain
- [ ] `ALLOWED_ORIGINS` set to your production domain
- [ ] TLS terminated at Caddy (or your equivalent edge) — no plaintext HTTP exposure
- [ ] Production PostgreSQL for Keycloak (not `dev-mem`)
- [ ] Image tags pinned (no `latest`) — see `docs/UPGRADES.md`
- [ ] Dev-only port mappings removed (handled by the production overlay)

---

## Caddy Edge Layer

Caddy is the outermost edge: `Internet → Caddy → OpenAppsec → APISIX → App`.

Non-HTTP protocols are routed via Caddy's layer-4 app with mTLS:

```
Kafka clients  → Caddy :9093 (mTLS) → Kafka :9092
Temporal gRPC  → Caddy :7234 (mTLS) → Temporal :7233
TigerBeetle    → Caddy :3001 (mTLS) → Go services
Redis          → Caddy :6380 (mTLS) → Redis :6379
OpenSearch     → Caddy :9201 (mTLS) → OpenSearch :9200
```

(Fluvio was removed from the stack; there is no layer-4 route for it.)

Build the custom Caddy image (Coraza WAF, layer-4, Cloudflare DNS, ratelimit):

```bash
docker build -t healthpoint/caddy:2.9 infra/caddy
```

In Kubernetes, the Caddy layer is managed outside the application Helm chart;
the legacy `helm/idr-platform` chart contains a reference implementation but is
superseded by `deploy/helm/healthpoint/` for the application tier.
