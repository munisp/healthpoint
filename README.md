# HealthPoint IDR Platform

Health-fintech platform for the No Surprises Act (NSA) Independent Dispute
Resolution (IDR) workflow: dispute intake, eligibility, negotiation, payment
integrity, and audit.

## Stack

| Layer | Technology | Location |
|---|---|---|
| Web client | React 19 + Vite + Tailwind/shadcn | `client/` |
| API server | Node 22, Express 5, tRPC, Drizzle ORM | `server/`, `drizzle/` |
| AI service | Python, FastAPI, LangGraph agents | `ai-service/` |
| Temporal worker | Python | `services/temporal-worker/` |
| Lakehouse pipeline | Python, PySpark | `services/lakehouse/` |
| Ledger sidecar | Go (TigerBeetle + Permify + Mojaloop facade) | `services/go/` |
| Stream processor | Rust (rdkafka) | `services/rust/` |
| Datastores | PostgreSQL 16, Redis 7, Kafka 3.7, OpenSearch 2.14, MinIO, Temporal, TigerBeetle | compose / external operators |
| Platform | Keycloak 26 (OIDC), Permify (ReBAC), APISIX + etcd, OpenAppsec, Caddy (edge) | `infra/` |

The event backbone is Kafka. (Dapr and Fluvio were removed in Sept 2026 as
orphan infrastructure.)

## Quickstart (local)

Prerequisites: Docker (Compose v2), Node 22+, pnpm 10+.

```bash
cp .env.example .env                 # fill in values (comments explain each)
bash infra/caddy/gen-internal-certs.sh
docker compose up -d                 # full stack incl. DB migrations (migrate job)
docker compose ps                    # wait until healthy
open http://localhost:3000
```

Host-side development of the app without Docker for the app itself:

```bash
pnpm install
pnpm db:push          # drizzle schema → PostgreSQL
pnpm dev              # vite dev server + tsx server with HMR
pnpm test             # vitest
pnpm build            # production build (client + server)
```

## Deployment

See **[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)**. Summary:

- **Dev/integration**: `docker compose up -d`
- **Production (single node)**: `docker compose -f docker-compose.yml -f docker-compose.production.yml up -d`
- **Production (Kubernetes)**: `helm upgrade --install healthpoint deploy/helm/healthpoint`
- **Secrets**: `docs/SECRETS.md` (sealed-secrets / external-secrets; nothing real in git)
- **Image pinning & upgrades**: `docs/UPGRADES.md`
- **Self-hosting details**: `SELF_HOSTING.md`

## Repository layout (active code)

```
client/                 React SPA (Vite)
server/                 Express 5 + tRPC API (server/_core is framework plumbing)
shared/                 shared types/constants
drizzle/                schema + migrations (PostgreSQL)
ai-service/             FastAPI AI microservice
services/go|rust|lakehouse|temporal-worker/
infra/                  caddy, apisix, keycloak, permify, temporal, postgres config
keycloak/               realm import
deploy/helm/healthpoint Helm chart (application tier)
deploy/k8s/             secrets template
scripts/                utility scripts (incl. cleanup-orphans.sh)
```

Legacy trees kept for reference only: `helm/idr-platform/` (superseded chart),
`kubernetes/` (legacy kustomize), `middleware/` + `backend/` (superseded python
middleware). Orphaned template dashboards and the `idr-workflow-demo/`
duplicate app are removed via `scripts/cleanup-orphans.sh`.

## Contributing

- TypeScript: `pnpm check` (typecheck), `pnpm test`, `pnpm format`
- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, ...)
- Never commit secrets; manifests reference k8s Secrets by name only
