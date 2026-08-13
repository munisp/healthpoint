# HealthPoint Production Deployment Runbook

## 1. Purpose and Hard Stop

This runbook deploys a reviewed HealthPoint release to a **managed PostgreSQL-backed environment**. It does **not** authorize real-money transfer initiation. Do not proceed if any stop condition below is unmet.

> **Hard stop:** `PAYMENT_EXECUTION_MODE` must be `disabled` or `sandbox`. The current repository deliberately does not implement live payment initiation.

## 2. Required Approvals and Evidence

| Gate owner | Required evidence | Stop condition |
|---|---|---|
| Release manager | Immutable Git commit and image digest; approved change record | Branch-only or mutable image tag |
| Security | Completed CI security workflow, 0 critical/high Node findings, Go scan, Python audit, image scan, and approved residual-risk record | Missing or failing security gate |
| Database owner | Managed PostgreSQL endpoint, TLS CA, least-privilege role, backup/restore evidence, approved migration | Local, compose, non-PostgreSQL, or non-TLS database URL |
| Provider/FSP owner | Sandbox contract, mTLS client certs, callback/report schemas, acceptance evidence | No provider artifacts or unverified callback identity |
| Operations | Monitoring, on-call, incident channel, deployed schedule, tested rollback | Missing alerting, ownership, or rollback plan |

## 3. Never Deploy the Development Topology

Do **not** deploy `docker-compose.yml`. It is explicitly a development/integration stack and contains local data stores, local defaults, and simulator services.

Use `docker-compose.deploy.yml` for the application and Go sidecar only, with externally managed PostgreSQL, Kafka, Permify, TigerBeetle, secrets, ingress, and observability. The deployment network named `healthpoint-internal` must be created and isolated by the platform team.

## 4. Prepare the Release

```bash
git fetch origin --tags
git checkout --detach <approved-main-commit>
corepack enable
pnpm install --frozen-lockfile
pnpm audit:dependencies
pnpm check
pnpm test
pnpm build
```

Run the Python and Go gates in CI or a staging runner with their real toolchains:

```bash
pip-audit --requirement ai-service/requirements.txt --strict
(cd services/go && go vet ./... && go test ./... && govulncheck ./...)
```

Build and scan immutable images. Replace the examples with a registry digest produced by the approved CI pipeline:

```bash
docker build --pull --no-cache -t registry.example/healthpoint:<release> .
docker push registry.example/healthpoint:<release>
# Record the resulting sha256 digest in the change record.
```

## 5. Provision Managed PostgreSQL

1. Create a PostgreSQL 16+ managed instance in a private network; require TLS and use `sslmode=verify-full`.
2. Create separate least-privilege roles for migration, application runtime, backup/recovery, and read-only operations. Never use a cluster superuser for the application.
3. Configure the application URL as `postgresql://<runtime-role>:<secret>@<dns-name>:5432/<database>?sslmode=verify-full` and validate the certificate hostname.
4. Take and verify an encrypted pre-migration backup. Store the encryption passphrase in the approved secret manager, not in a repository or shell history.
5. Run the repository’s exact migration command once in the release job:

```bash
export DATABASE_URL='postgresql://...?...sslmode=verify-full'
pnpm validate:production-config
pnpm db:push
```

6. Query migration metadata and key tables; verify settlement, outbox, proof, transfer, and exception-review tables exist. Run an application health check and confirm it reports `db=connected`.
7. If migration validation fails, stop application rollout. Prefer restoring the verified pre-migration backup over improvised destructive changes.

## 6. Configure Secrets and External Contracts

Inject secrets only through the organization-approved secret manager. Required values are enforced by `scripts/validate-production-config.sh` and `docker-compose.deploy.yml`.

| Configuration | Production requirement |
|---|---|
| `DATABASE_URL` | Managed PostgreSQL, TLS hostname verification, non-local host |
| `JWT_SECRET` | 32+ high-entropy characters; rotation plan documented |
| `SETTLEMENT_CALLBACK_KEYRING` | Versioned JSON keyring; overlap and retirement dates approved |
| `SETTLEMENT_MTLS_CLIENT_CA_PEM`, `...FINGERPRINTS`, `...INGRESS_TOKEN` | Provider-issued trust evidence and protected ingress assertion |
| `BACKUP_ENCRYPTION_PASSPHRASE` | High entropy; accessible to controlled recovery procedure only |
| `EMR_CREDENTIALS_ENCRYPTION_KEY` | 64 hexadecimal characters; rotate via explicit re-encryption plan |
| `INTERNAL_SERVICE_TOKEN` | Unique service-to-service secret; rotate without sharing with browser clients |
| `PAYMENT_EXECUTION_MODE` | `disabled` or `sandbox` only |
| `MOJALOOP_URL` | HTTPS provider/FSP sandbox endpoint only when sandbox execution is enabled |

Set `AI_ALLOWED_ORIGINS` to the exact HTTPS browser origins. The AI service fails closed in production if it is absent or contains `*`.

## 7. Validate the Deployment Contract

Use short-lived injected environment variables or a secure platform secret reference; do not commit a production `.env` file.

```bash
docker compose -f docker-compose.deploy.yml config
```

The command must render without missing-variable errors. Confirm the output has no host `ports:` for application data services, uses `read_only`, `no-new-privileges`, dropped Linux capabilities, non-root users, and immutable image digests.

## 8. Deploy in Stages

1. Deploy database and external managed dependencies first; verify TLS connectivity and alert routing.
2. Deploy one application canary and one Go sidecar with `PAYMENT_EXECUTION_MODE=disabled`.
3. Verify `/api/health`, authenticated login, protected tRPC calls, and PostgreSQL connectivity.
4. Exercise a signed settlement callback in the provider sandbox. Confirm invalid signature, stale timestamp, duplicate idempotency key, missing mTLS assertion, and invalid state transition are rejected.
5. Verify transactional outbox delivery, provider-report reconciliation, maker-checker separation, exception review, reversal evidence, and daily proof handler.
6. Expand deployment only after application error rate, latency, database saturation, callback rejection rate, and outbox retry age remain within approved SLOs.

## 9. Post-Deployment Verification

| Check | Evidence |
|---|---|
| Health | Application reports PostgreSQL connected; no incompatible database fallback |
| Security | CI security workflow green; secret scan green; no critical/high Node findings |
| Data | Migration metadata, expected indexes, encrypted backup, and restore sample verified |
| Funds controls | Live initiation still disabled; callback and reconciliation audit events immutable |
| Scheduler | Deployed Heartbeat identity and daily balance-proof execution shown in operations console |
| Monitoring | Alerts reach staffed on-call route; dashboards show application/database/outbox/callback metrics |

## 10. Rollback and Incident Rules

1. Stop rollout immediately for authentication bypass, callback verification failure, unexpected settlement state change, migration error, high database error rate, or failed backup/restore verification.
2. Set `PAYMENT_EXECUTION_MODE=disabled`; do not attempt manual live transfer remediation through the application.
3. Roll back application images to the prior approved digest. Do not reverse database schema changes manually unless the database owner has a tested migration rollback.
4. For data integrity risk, preserve logs and audit evidence, open an incident, and restore only through the approved encrypted recovery procedure.
5. Re-open release only after root cause, impact, reconciliation, and approval records are complete.
