# python-legacy — archived root-level `*_service.py` files (Phase 15 FB / audit B8)

These 32 FastAPI/Flask-era service modules were moved here from the repository
root. Verification before the move (head 7770508):

- **No `docker-compose*.yml`, Makefile, helm, kubernetes, or deploy manifest
  references any of them** (grep over compose/infra/helm/k8s/deploy).
- The live Python services are `ml/serving/inference.py`,
  `services/temporal-worker/worker.py`, `services/lakehouse/*.py`, and
  `lakehouse/spark-jobs/*.py` — none import these files.
- The only reference is `scripts/generate_dockerfiles.py`, a stale one-shot
  generator whose output is not used by any current compose/infra manifest.

They are retained (not deleted) for archaeological value only. Nothing here is
imported, built, or deployed. Do not add new code in this directory.
