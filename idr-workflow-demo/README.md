# HealthPoint NSA/IDR Platform

HealthPoint is a React, Express, and tRPC platform for managing NSA/IDR dispute work. The authoritative application uses **PostgreSQL**, **Keycloak OIDC**, **Permify**, Redis, Kafka, Temporal, S3-compatible storage, and evidence-gated release controls. The primary application surface is `server/`, `client/`, and `drizzle/`.

> HealthPoint does **not** provide automated CMS portal submission. CMS work is an authorized **human portal handoff**: the platform prepares and audits the package, and a trained operator records the resulting portal receipt and verified feedback. No source, deployment, or product claim may characterize this as an API submission.

## Authoritative implementation boundaries

| Concern | Authoritative location | Required control |
|---|---|---|
| PostgreSQL schema and migrations | `drizzle/schema.ts`, `drizzle/migrations/` | Every schema change requires a checked-in migration and canonical-journal validation. |
| HTTP/tRPC procedures | `server/routers.ts`, `server/routers/` | Use protected procedures and dispute-level authorization before reading or modifying dispute data. |
| Authentication | `server/_core/keycloak.ts`, `server/_core/context.ts` | Keycloak OIDC establishes the request identity; browser code must not manipulate session cookies. |
| Authorization | `server/authz.ts`, `server/permify-schema.ts` | Permify policy checks fail closed in production when the required store is unavailable. |
| Model governance | `server/services/model-governance.ts`, `server/services/governed-outcome.ts` | Live Georgetown decision support requires a pinned approved artifact, valid data-use approval, approved validation, document evidence, and an HTTPS runtime. |
| CMS handoff | `server/services/cms-adapter.ts`, `server/services/cms-outbox.ts` | Preparation is idempotent and durable; a human records an integrity-bound receipt. There is no automated portal HTTP transport or worker. |
| Document analysis | `server/services/document-analysis.ts`, `server/services/document-validation-evidence.ts` | Uploaded materials remain quarantined and must complete the canonical evidence path before governed decision support. |
| Release evidence | `scripts/preflight-production-deploy.sh`, `scripts/validate-external-release-blockers.mjs` | Protected release validation fails closed without real data-use, model, CMS, payment, operations, and compliance evidence. |

## Development and release loop

1. Update TypeScript/React source only in the authoritative application surface. Do not revive the retired legacy CMS API clients or generated template services.
2. Add or update PostgreSQL schema in `drizzle/schema.ts`, create a numbered migration, and register it in `drizzle/migrations/meta/_journal.json`.
3. Add an authorization-first tRPC procedure and corresponding regression tests for every sensitive data path.
4. Run type, build, migration-journal, fixture-isolation, platform-independence, manifest-policy, claim-copy, and applicable integration checks.
5. For production, run the protected preflight only with an approved environment file and a real, protected external-evidence bundle. Local or hermetic evidence cannot satisfy production evidence gates.

## Required production configuration

Secrets must be supplied through the deployment platform’s secret manager. Do not commit `.env` files, raw portal material, provider keys, private certificates, or data-use evidence.

| Variable group | Purpose | Production expectation |
|---|---|---|
| `DATABASE_URL`, `JWT_SECRET` | PostgreSQL and session integrity | PostgreSQL with approved TLS; unique secret-manager values. |
| `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET` | OIDC identity | HTTPS issuer and confidential-client credentials. |
| `PERMIFY_URL`, `PERMIFY_AUTH_TOKEN` | Fine-grained authorization | Authenticated production service; failures deny access. |
| `REDIS_URL`, `KAFKA_BROKERS`, Temporal settings | Runtime infrastructure | Approved TLS/mTLS configuration and monitored recovery behavior. |
| `GEORGETOWN_*`, `GOVERNED_OUTCOME_PREDICTIONS_ENABLED` | Decision support | Disabled until the governed model and data-use gates are approved and verified. |
| `CMS_AUTOMATION_ENABLED` | CMS policy guard | Must remain `false`. Human portal handoff is the only supported workflow. |
| `PAYMENT_EXECUTION_MODE` | Payment control | Disabled until provider, mTLS, reconciliation, and finance evidence are approved. |

## Verification commands

| Intent | Command | Evidence class |
|---|---|---|
| Typecheck | `pnpm run check` | Source validation. |
| Production build | `pnpm run build` | Source build validation. |
| Migration metadata | `pnpm run validate:migration-journal` | Canonical migration-journal validation. |
| Policy checks | `pnpm run check:platform-independence && pnpm run check:test-fixture-isolation && pnpm run validate:production-manifests && pnpm run check:stakeholder-claim-copy` | Source policy controls. |
| Hermetic tests | `NODE_ENV=test TEST_INFRA_FALLBACK_MOCKS=true ALLOW_MOCK_FIXTURES=true PAYMENT_EXECUTION_MODE=disabled pnpm test` | Test-only regression coverage; not external evidence. |
| Live disposable integrations | `bash scripts/run-integration-stack.sh` | Local container/service compatibility; not staging or production evidence. |
| Clean migration proof | `MIGRATION_TEST_DATABASE_URL=<disposable-postgres-url> HEALTHPOINT_ALLOW_CLEAN_MIGRATION_TEST=true bash scripts/verify-clean-postgresql-migrations.sh` | Destructive disposable database proof. |
| Protected production preflight | `PRODUCTION_ENV_FILE=<protected-env> RELEASE_EVIDENCE_DIR=<protected-real-evidence> bash scripts/preflight-production-deploy.sh` | Release boundary; fails closed without real external evidence. |

## Current evidence boundary

The repository contains controls for validating external evidence; it does not contain real production evidence by default. In particular, HealthPoint must not claim live CMS submission, calibrated Georgetown probabilities, provider payment finality, HIPAA/BAA/SOC 2 status, or quantified performance/ROI until the corresponding independently reviewable evidence package passes the protected release gates.

See [`docs/operations/cms-pilot-and-data-use-stop-escalation.md`](docs/operations/cms-pilot-and-data-use-stop-escalation.md) for the CMS pilot and data-use stop/escalation rules.
