# HealthPoint Mission-Critical Code Assurance Report

**Decision:** **NOT RELEASEABLE for production or real-money operation.**  
**Audited revision:** `3cc827f6d3e3ad46387092306835a5d58e0dec50`, plus the uncommitted assurance remediation described below.  
**Audit environment:** Ubuntu sandbox; PostgreSQL 16.14; isolated database `idr_demo`; generated non-production credentials only.

> A passing build or unit suite does not override a release blocker. The release gate intentionally returns `RELEASE_DECISION=NOT_RELEASEABLE` while any material claim is blocked or incomplete.[1]

## Scope and Method

The audit examined the active Node/React application, PostgreSQL schema and migrations, settlement lifecycle, Go payment sidecar, Python AI service, scheduled balance proof, backup/recovery tooling, load drill, compose topology, and repository claim/configuration files. The assessment used direct source inspection and non-production execution. It did **not** exercise a bank, regulated FSP, production identity provider, production FHIR tenant, deployed scheduler, or managed project database, because none was available in the isolated environment.

| Verification gate | Result | Evidence |
|---|---|---|
| Frozen Node dependency installation | Pass, with build-script approval warning | `pnpm install --frozen-lockfile` completed; dependency build scripts remain subject to explicit approval. |
| TypeScript compile | Pass | `npx tsc --noEmit` returned zero errors. |
| Unit suite | Pass | 6 files, 161 assertions, including PostgreSQL configuration, ledger, settlement authentication, lifecycle, proof, and backup tests.[2] |
| Settlement E2E suite | Pass | 8 Playwright scenarios against a real isolated PostgreSQL instance; covers callback rejection, idempotency, failure, reconciliation, exception, reversal, and daily proof behavior.[2] |
| Go sidecar | Pass, limited | `go test ./...` completed for `services/go`; this is not provider interoperability evidence. |
| Python AI service | Syntax pass only | `py_compile` passed; no authenticated provider integration or Python behavior suite was available. |
| Build | Pass with performance warning | Production build completed; main JavaScript asset is 4.47 MB uncompressed / 802 KB gzip. |
| Recovery drill | Pass, local only | Encrypted `pg_dump`/restore drill reproduced critical-table counts in an isolated PostgreSQL restore target.[3] |
| Load drill | Pass, local only | 250 requests at concurrency 25 to `/api/health`; 0 failures; p95 31.30 ms.[4] |
| Release gate | Expected fail | 4 material blockers prevent a releaseable result.[1] |

## Claim and Coverage Inventory

The version-controlled manifest is the authoritative machine-readable inventory for material claims reviewed during this audit.[1]

| Claim ID | Claim | Direct evidence | Status | Limitation |
|---|---|---|---|---|
| MC-POSTGRES-RUNTIME | Workflow and settlement state persist in PostgreSQL. | Local migrations and runtime health check passed. | **Blocked** | The managed preview injects a non-PostgreSQL database URL; deployed persistence was not observed. |
| MC-SETTLEMENT-EVIDENCE | Settlement evidence is signed, idempotent, atomic, auditable, and reversible. | Local PostgreSQL unit/E2E coverage and lifecycle implementation. | **Verified locally** | No regulated provider or bank transfer was performed. |
| MC-TRANSFER-RAIL | Real funds can be initiated and settled. | Internal token is fail-closed. | **Blocked** | Compose config points to a Mojaloop simulator; no FSP/bank sandbox certificate or acceptance evidence exists. |
| MC-AI-EMR-EXTRACTION | EMR extraction returns real FHIR data. | Synthetic implementation removed during audit. | **Retired** | Endpoint now returns `503` until an authenticated FHIR connector is implemented and tested. |
| MC-DAILY-BALANCE-PROOF | Daily proof and exception review execute durably. | PostgreSQL proof, immutable review, and task-UID configuration are implemented and locally tested. | **Blocked** | No production PostgreSQL binding or deployed Heartbeat execution exists. |
| MC-COMPOSE-PRODUCTION | Compose configuration is a production-safe baseline. | Static composition audit. | **Blocked** | Development defaults, disabled security, plaintext internal links, and simulator configuration remain. |
| MC-BACKUP-RECOVERY | Backup and restore are automated and integrity checked. | Encrypted local recovery drill passed. | **Verified locally** | Production destination, retention policy, and deployed restore drill remain unobserved. |

## Findings and Remediation

| ID | Severity | Finding | Audit action | Residual release condition |
|---|---|---|---|---|
| MC-001 | Critical | `docker-compose.yml` has default credentials; Keycloak development mode/in-memory storage; disabled OpenSearch security; unauthenticated etcd; plaintext service links. | Recorded as an explicit deployment blocker; release gate enforces it. | A separate production topology must require secret injection, durable identity storage, encrypted/authenticated internal links, and service-specific hardening verification. |
| MC-002 | Critical | Compose uses `mojaloop-simulator` for Node and Go payment paths. | Real-money release remains blocked; transfer flow is treated only as an internal evidence workflow. | Contracted provider/FSP sandbox, mTLS interoperability, report feed, reconciliation acceptance, and regulated-rail operational approval. |
| MC-003 | High | Go sidecar uses insecure gRPC credentials and fallback localhost endpoints. | Included in blocked production topology assessment; Go unit test executed. | Replace with mandatory mTLS endpoint configuration and prove provider-side transport verification. |
| MC-004 | High | Managed preview database setting is incompatible with PostgreSQL-only application runtime. | Application already fail-closes on missing/non-PostgreSQL URLs; local PostgreSQL behavior was revalidated. | Set the managed production URL to SSL-enabled PostgreSQL; deploy, migrate, and observe health/readiness. |
| MC-005 | High | Python EMR extraction fabricated clinical/financial content with random values. | **Fixed:** removed generated response and changed endpoint to explicit `503` fail-closed behavior. | Implement an authenticated FHIR connector with sandbox contract/E2E evidence before re-enabling. |
| MC-006 | High | Daily proof handler lacked platform cron identity/task ownership support. | **Fixed:** added Heartbeat SDK bootstrap, cron identity handling, persistent task UID configuration, and guarded handler. | Deploy PostgreSQL-backed app and create/observe the project-level Heartbeat job. |
| MC-007 | Medium | Browser bundle size exceeds Vite’s performance warning threshold. | Recorded; build remains reproducible. | Establish a performance budget and code-splitting plan; not a financial-integrity blocker. |

## Remediation Implemented During This Audit

The following changes were made and re-tested within the audited workspace:

| Change | Evidence of completion |
|---|---|
| Replaced synthetic Python EMR extraction with fail-closed `503` response | Python syntax gate passed; Node proxy returns a non-success response rather than fabricated source data. |
| Added material claim manifest and assurance gate | `pnpm assurance:check` validates the inventory; `pnpm assurance:release` fails with the active blockers. |
| Added daily balance-proof, exception review, scheduled handler, task ownership, and test coverage | PostgreSQL migrations through `0025`; settlement E2E and unit gates passed. |
| Added provider callback/keyring/mTLS boundary, transfer lifecycle, maker-checker approval, reconciliation, reversals, and recovery tooling | Local PostgreSQL tests and recovery/load evidence passed; external provider assurance remains blocked. |

## Mandatory Release Blockers

1. Configure the platform-managed `DATABASE_URL` as an SSL-enabled PostgreSQL endpoint, deploy the application, apply migrations, and capture production health/readiness evidence.
2. Replace the development compose topology with a separately hardened production deployment specification. The current file must not be presented as a production deployment baseline.
3. Onboard a regulated payment provider/FSP sandbox with provider-issued mTLS material, real callback/report contracts, test accounts, settlement/reversal scenarios, and independent operational approval. Do not enable transfer initiation before this gate passes.
4. Implement and test a real authenticated FHIR connector before re-enabling EMR extraction. Do not substitute synthetic records for clinical or financial decisions.
5. Deploy and observe the daily Heartbeat balance-proof job, including retry behavior, task-UID authorization, alert delivery, and an operator exception-review runbook.

## Release Decision

The application contains useful and locally validated workflow and settlement-evidence controls. It is **not** a releaseable real-money platform and must not be represented as one. The current score is intentionally not elevated above the blockers: local settlement-control implementation is stronger than the deployed assurance posture, but it cannot establish the safety or irreversibility of an external funds transfer.

## Reproducible Commands

```bash
cd /home/ubuntu/idr-workflow-demo
pnpm install --frozen-lockfile
npx tsc --noEmit
DATABASE_URL='postgresql://idr_user:idr_pass123@127.0.0.1:5432/idr_demo' pnpm test
DATABASE_URL='postgresql://idr_user:idr_pass123@127.0.0.1:5432/idr_demo' pnpm test:e2e
(cd services/go && go test ./...)
python3 -m py_compile ai-service/main.py ai-service/cms_validator.py ai-service/agents.py
pnpm build
pnpm assurance:check
pnpm assurance:release # expected nonzero exit while blockers exist
```

## References

[1]: ../assurance/claim-manifest.json "Material claim manifest and release gate input"
[2]: ../terminal_full_output/2026-08-13_10-50-47_517453_736.txt "Assurance gate execution output"
[3]: ../scripts/db-recovery-drill.sh "Encrypted PostgreSQL recovery drill"
[4]: ../scripts/load-drill.mjs "Controlled API resilience load drill"
