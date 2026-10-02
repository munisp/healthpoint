# Production Deployment Runbook — RETIRED

This runbook described infrastructure that does not exist in this repository:
a `scripts/build_and_push_images.sh` for "52 service images", Vault/Medplum
StatefulSets under `infrastructure/`, a Dapr Helm install, and dozens of
microservice deployments (`nsa-idr-dispute-service`, etc.) that are not part
of this codebase. It has been retired to avoid operators following fictional
steps.

**Use [`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md)** for the real flows:

- `docker compose -f docker-compose.yml -f docker-compose.production.yml up -d`
  (production compose overlay; all secrets mandatory, fail-closed)
- `helm upgrade --install healthpoint deploy/helm/healthpoint` (Kubernetes,
  application tier; datastores via operators/charts per `values.yaml`)
- `docs/SECRETS.md` — secret creation (sealed-secrets / external-secrets)
- `docs/UPGRADES.md` — image digest pinning workflow

The compliance checklist (HIPAA BAA, SOC 2, HITRUST) from the old runbook is
restated in `DEPLOYMENT_GUIDE.md` where relevant; organizational/legal
requirements are unchanged by this edit.
