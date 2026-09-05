# Middleware Deployment Guide — RETIRED

This guide referenced a Dapr-based middleware stack (`middleware/dapr/`,
`docker-compose.full.yml`, absolute paths under
`/home/ubuntu/enhanced-healthcare-platform/`) and standalone dashboard apps
that do not exist in this repository. Dapr and Fluvio were removed from the
platform on 2026-09-05 (orphan infrastructure, zero application adoption).

The middleware components that actually exist — Keycloak, Permify, Temporal,
Kafka, APISIX, Redis, PostgreSQL, OpenSearch, TigerBeetle, MinIO — are
deployed through the documented flows:

- Development: `docker compose up -d` (root `docker-compose.yml`)
- Production: `docker-compose.yml` + `docker-compose.production.yml` overlay,
  or the Helm chart at `deploy/helm/healthpoint/`
- Details: [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md),
  `docs/SECRETS.md`, `docs/UPGRADES.md`
