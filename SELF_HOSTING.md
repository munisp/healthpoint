# HealthPoint IDR — Self-Hosting Guide

This document covers everything needed to run HealthPoint IDR outside the Manus environment. The platform has **zero Manus dependencies** — all authentication, storage, LLM, and analytics components are self-hostable open-source alternatives.

---

## Architecture Overview

| Component | Technology | Default |
|---|---|---|
| **Web app** | Node.js 22 + Express + React | Port 3000 |
| **Database** | PostgreSQL 16 | Port 5432 |
| **Authentication** | Keycloak 26 (OIDC) | Port 8080 |
| **LLM / AI** | Ollama (local) or any OpenAI-compatible API | Port 11434 |
| **File storage** | MinIO (S3-compatible) | Port 9000 |
| **Analytics** | Umami (optional) | Port 3001 |

---

## Quick Start (Docker Compose)

### 1. Clone the repository

```bash
git clone https://github.com/munisp/healthpoint.git
cd healthpoint
```

### 2. Create your environment file

Copy the example and fill in your values:

```bash
cp env.example .env
# Edit .env — at minimum set JWT_SECRET, DATABASE_URL, and KEYCLOAK_CLIENT_SECRET
```

### 3. Start all services

```bash
docker compose up -d
```

### 4. Import the Keycloak realm

On first run, Keycloak automatically imports the `healthpoint` realm from `keycloak/healthpoint-realm.json`. No manual steps required.

### 5. Open the app

Navigate to `http://localhost:3000`. Click **Sign In** or **Get Started** — you will be redirected to Keycloak's login page.

---

## Docker Compose Configuration

Save this as `docker-compose.yml` in the project root:

```yaml
version: "3.9"

services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: idr_user
      POSTGRES_PASSWORD: idr_pass123
      POSTGRES_DB: idr_demo
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  keycloak:
    image: quay.io/keycloak/keycloak:26.2.5
    restart: unless-stopped
    command: start-dev --import-realm
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: admin
      KC_BOOTSTRAP_ADMIN_PASSWORD: admin
      KC_DB: dev-mem
    volumes:
      - ./keycloak:/opt/keycloak/data/import
    ports:
      - "8080:8080"

  app:
    build: .
    restart: unless-stopped
    depends_on:
      - postgres
      - keycloak
    env_file: .env
    environment:
      DATABASE_URL: postgresql://idr_user:idr_pass123@postgres:5432/idr_demo
      KEYCLOAK_URL: http://keycloak:8080
    ports:
      - "3000:3000"

volumes:
  postgres_data:
```

---

## Environment Variables

Copy `env.example` to `.env` and configure:

### Required

| Variable | Description | Example |
|---|---|---|
| `NODE_ENV` | Runtime environment | `production` |
| `JWT_SECRET` | Signs session cookies (min 32 chars) | `openssl rand -hex 32` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `KEYCLOAK_URL` | Keycloak base URL | `http://localhost:8080` |
| `KEYCLOAK_REALM` | Keycloak realm name | `healthpoint` |
| `KEYCLOAK_CLIENT_ID` | Keycloak client ID | `healthpoint-app` |
| `KEYCLOAK_CLIENT_SECRET` | Keycloak client secret | from Keycloak admin console |

### LLM / AI (at least one required for AI features)

| Variable | Description |
|---|---|
| `LLM_API_URL` | OpenAI-compatible API base URL (e.g. `https://api.openai.com/v1`) |
| `LLM_API_KEY` | API key for the LLM endpoint |
| `LLM_DEFAULT_MODEL` | Default model name (default: `gpt-4o-mini`) |
| `OLLAMA_BASE_URL` | Ollama server URL (default: `http://localhost:11434`) |
| `OLLAMA_DEFAULT_MODEL` | Default Ollama model (default: `gemma3:8b`) |

### Optional

| Variable | Description |
|---|---|
| `S3_ENDPOINT` | MinIO/S3 endpoint URL |
| `S3_ACCESS_KEY` | S3 access key |
| `S3_SECRET_KEY` | S3 secret key |
| `S3_BUCKET` | S3 bucket name (default: `healthpoint`) |
| `RESEND_API_KEY` | Resend API key for email notifications |
| `VITE_UMAMI_URL` | Umami analytics server URL |
| `VITE_UMAMI_WEBSITE_ID` | Umami website ID |
| `VITE_APP_URL` | Public URL of the app (default: `http://localhost:3000`) |
| `VITE_APP_TITLE` | App title in browser (default: `HealthPoint`) |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins (production only) |
| `SCHEDULED_SECRET` | Bearer token for scheduled/heartbeat endpoints |

---

## Keycloak Setup

The `healthpoint` realm is pre-configured and imported automatically on first start. It includes:

- **Realm:** `healthpoint`
- **Client:** `healthpoint-app` (confidential, Authorization Code + PKCE)
- **Default admin user:** `admin@healthpoint.local` / `Admin1234!`
- **Roles:** `admin`, `provider`, `payer`

### Changing the client secret

1. Open `http://localhost:8080/admin` → log in as `admin`/`admin`
2. Navigate to **Clients** → **healthpoint-app** → **Credentials**
3. Click **Regenerate** and copy the new secret
4. Update `KEYCLOAK_CLIENT_SECRET` in your `.env`

### Adding redirect URIs for production

1. Open **Clients** → **healthpoint-app** → **Settings**
2. Add your production domain to **Valid redirect URIs** (e.g. `https://app.yourdomain.com/*`)
3. Add it to **Web origins** as well

### Promoting a user to admin

```bash
# Via Keycloak admin console:
# Users → select user → Role Mappings → Assign "admin" realm role

# Or via the app database:
psql $DATABASE_URL -c "UPDATE users SET role='admin' WHERE email='user@example.com';"
```

---

## Running Without Docker

### Prerequisites

- Node.js 22+
- PostgreSQL 16+
- Java 21+ (for Keycloak)

### 1. Start PostgreSQL

```bash
createdb idr_demo
createuser idr_user --pwprompt
psql -c "GRANT ALL ON DATABASE idr_demo TO idr_user;"
```

### 2. Start Keycloak

```bash
# Download Keycloak 26.2.5
wget https://github.com/keycloak/keycloak/releases/download/26.2.5/keycloak-26.2.5.tar.gz
tar -xzf keycloak-26.2.5.tar.gz

# Copy realm import file
mkdir -p keycloak-26.2.5/data/import
cp keycloak/healthpoint-realm.json keycloak-26.2.5/data/import/

# Start Keycloak
KC_BOOTSTRAP_ADMIN_USERNAME=admin KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
  ./keycloak-26.2.5/bin/kc.sh start-dev --http-port=8080 --import-realm --db=dev-mem
```

### 3. Install dependencies and run migrations

```bash
npm install
pnpm db:push
```

### 4. Start the app

```bash
cp env.example .env   # fill in your values
npm run dev
```

---

## Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Use a strong `JWT_SECRET` (`openssl rand -hex 32`)
- [ ] Use a strong `KEYCLOAK_CLIENT_SECRET`
- [ ] Set `KEYCLOAK_URL` to your production Keycloak URL
- [ ] Add your domain to Keycloak's **Valid redirect URIs** and **Web origins**
- [ ] Set `ALLOWED_ORIGINS` to your production domain
- [ ] Use `sslRequired: external` in Keycloak realm settings (not `none`)
- [ ] Configure a production PostgreSQL instance (not `dev-mem` for Keycloak)
- [ ] Set up TLS/HTTPS (reverse proxy: nginx, Caddy, or Traefik)
- [ ] Configure `S3_*` vars for file storage (MinIO or AWS S3)

---

## Auth Flow

```
Browser → GET /api/auth/login?redirectTo=/dashboard
       → Express generates PKCE code_verifier + state
       → Redirect to Keycloak authorization endpoint
       → User logs in at Keycloak
       → Keycloak redirects to GET /api/auth/callback?code=...&state=...
       → Express exchanges code for tokens (PKCE)
       → Express upserts user in PostgreSQL
       → Express sets httpOnly session cookie (JWT signed with JWT_SECRET)
       → Redirect to /dashboard
```

Sign Out:
```
Browser → trpc.auth.logout (clears session cookie)
       → Redirect to GET /api/auth/logout
       → Express redirects to Keycloak end-session endpoint
       → Keycloak clears SSO session
       → Redirect to /
```

---

## Caddy Edge Layer

Caddy acts as the **outermost edge** of the HealthPoint platform. It is the only component directly internet-facing. All other services (OpenAppsec, APISIX, the Node.js app) are internal and reachable only through Caddy.

### Traffic Architecture

```
Internet
   │
   ▼
Caddy :443  (TLS termination, HTTP/3, Coraza WAF, Keycloak forward_auth)
   │
   ▼
OpenAppsec :80  (ML-based WAF, OWASP CRS behavioural analysis)
   │
   ▼
APISIX :9080  (API gateway — JWT validation, rate limiting, routing)
   │
   ▼
Node.js App :3000  (tRPC + Express)
```

For non-HTTP protocols, Caddy routes TCP/UDP directly via the Layer 4 module:

```
Kafka clients  → Caddy :9093 (mTLS) → Kafka :9092
Temporal gRPC  → Caddy :7234 (mTLS) → Temporal :7233
TigerBeetle    → Caddy :3001 (mTLS) → Go services :8001
Redis          → Caddy :6380 (mTLS) → Redis :6379
OpenSearch     → Caddy :9201 (mTLS) → OpenSearch :9200
Fluvio         → Caddy :9004 (mTLS) → Fluvio SC :9003
```

### What Caddy Provides

| Feature | Detail |
|---|---|
| **Automatic TLS** | Let's Encrypt / ZeroSSL via ACME HTTP or DNS challenge. Zero manual certificate management. |
| **HTTP/3 + QUIC** | Enabled by default in Caddy 2.9. Reduces latency 20–40% on mobile/lossy connections. |
| **Coraza WAF** | Embedded Go WAF using OWASP Core Rule Set. Runs in-process — no nginx dependency. |
| **Keycloak forward_auth** | Every request validated against the Keycloak userinfo endpoint before reaching the app. |
| **Layer 4 TCP/UDP routing** | Routes Kafka, Temporal gRPC, TigerBeetle, Redis, OpenSearch, and Fluvio over mTLS. |
| **mTLS for internal services** | Internal CA certificates (from `gen-internal-certs.sh`) used for all Layer 4 routes. |
| **Rate limiting** | Per-IP and per-user rate limiting via the `caddy-ratelimit` module. |
| **Security headers** | HSTS, X-Frame-Options, CSP, Referrer-Policy injected on all responses. |

### Building the Custom Caddy Image

The `infra/caddy/Dockerfile` builds Caddy with these additional modules:

```
caddy-coraza-waf      — OWASP Coraza WAF (Go-native, replaces ModSecurity)
caddy-l4              — Layer 4 TCP/UDP routing
caddy-dns/cloudflare  — DNS challenge for wildcard certificates
caddy-ratelimit       — Per-IP and per-user rate limiting
```

Build and push:

```bash
cd infra/caddy
docker build -t healthpoint/caddy:2.9 .
docker push healthpoint/caddy:2.9
```

### Local Development (Docker Compose)

For local development, Caddy uses a self-signed certificate for `localhost`. No DNS challenge is needed.

```bash
# Generate internal CA and mTLS certificates
bash infra/caddy/gen-internal-certs.sh

# Start all services including Caddy
docker compose up -d

# Caddy Admin API (inspect loaded config)
curl http://localhost:2019/config/ | jq .
```

Caddy is available at:

| Endpoint | Service |
|---|---|
| `https://localhost` | Main app (self-signed cert — accept browser warning in dev) |
| `http://localhost:2019` | Caddy Admin API |
| `localhost:9093` | Kafka (mTLS) |
| `localhost:7234` | Temporal gRPC (mTLS) |
| `localhost:6380` | Redis (mTLS) |
| `localhost:9201` | OpenSearch (mTLS) |

### Production (Kubernetes / Helm)

```bash
# Create Cloudflare API token secret (for DNS challenge)
kubectl create secret generic caddy-cloudflare \
  --from-literal=CLOUDFLARE_API_TOKEN=<your-token> \
  -n idr-platform

# Create internal CA secret
kubectl create secret generic caddy-internal-ca \
  --from-file=ca.crt=infra/caddy/certs/ca.crt \
  --from-file=tls.crt=infra/caddy/certs/server.crt \
  --from-file=tls.key=infra/caddy/certs/server.key \
  -n idr-platform

# Deploy with Helm
helm upgrade --install idr-platform ./helm/idr-platform \
  --set caddy.domain=idr.healthpoint.io \
  --set caddy.adminEmail=admin@healthpoint.io \
  -n idr-platform
```

### Disabling Caddy

If you prefer a different edge proxy (Traefik, nginx), set `caddy.enabled: false` in `values.yaml` and re-enable `ingress.enabled: true`. You will need to handle TLS, WAF, and Layer 4 routing separately.

```yaml
# values.yaml
caddy:
  enabled: false
ingress:
  enabled: true
  className: nginx
```
