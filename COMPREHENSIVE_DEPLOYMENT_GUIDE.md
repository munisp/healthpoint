# Comprehensive Deployment Guide — RETIRED

This document described tarball "unified artifact" deployments
(`unified_deployment_script.sh`, prebuilt venvs, MLflow services) that never
existed in this repository. It was retained by mistake and is now retired.

**Use [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md)** — it documents the real
flows:

- `docker compose up -d` (development/integration stack)
- `docker compose -f docker-compose.yml -f docker-compose.production.yml` (production overlay)
- `helm upgrade --install healthpoint deploy/helm/healthpoint` (Kubernetes)
- `docs/SECRETS.md` (secrets), `docs/UPGRADES.md` (image pinning)
