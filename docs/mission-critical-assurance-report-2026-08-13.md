# HealthPoint Mission-Critical Code Assurance Report

**Decision:** **NOT RELEASEABLE for production or real-money operation.**  
**Audited revision:** `3cc827f6d3e3ad46387092306835a5d58e0dec50`, plus the subsequent repository-controlled remediation described below.  
**Audit environment:** Ubuntu sandbox; PostgreSQL 16.14; isolated database `idr_demo`; generated non-production credentials only.

> A passing build or unit suite does not override a release blocker. The release gate intentionally returns `RELEASE_DECISION=NOT_RELEASEABLE` while any material claim is blocked or incomplete.[1]

## Scope and Method

The audit examined the active Node/React application, PostgreSQL schema and migrations, settlement lifecycle, Go payment sidecar, Python AI service, scheduled balance proof, backup/recovery tooling, load drill, compose topology, and repository claim/configuration files. The assessment used direct source inspection and non-production execution. It did **not** exercise a bank, regulated FSP, production identity provider, production FHIR tenant, deployed scheduler, or managed project database, because none was available in the isolated environment.

| Verification gate | Result | Evidence |
|---|---|---|
| Frozen Node dependency installation | Pass, with build-script approval warning | `pnpm install --frozen-lockfile` completed; dependency build scripts remain subject to explicit approval. |
| TypeScript compile | Pass | `npx tsc --noEmit` returned zero errors. |
| Unit suite | Pass | 12 files, 170 assertions, including PostgreSQL configuration, ledger, settlement authentication, lifecycle, proof, backup, credential encryption, and TigerBeetle mTLS transport tests.[2] |
| Settlement E2E suite | Pass | 8 Playwright scenarios against a real isolated PostgreSQL instance; covers callback rejection, idempotency, failure, reconciliation, exception, reversal, and daily proof behavior.[2] |
| TigerBeetle mTLS connectivity | Pass, non-mutating | The Node client connected only to `127.0.0.1:16001`; stunnel performed CA-chain and hostname validation for `tigerbeetle.newfire.app` and authenticated with the client certificate. The probe used only `lookupAccounts` and created no account, transfer, or settlement instruction.[2] |
| Go sidecar | Pass, limited | `go test ./...` completed for `services/go`; this is not provider interoperability evidence. |
| Python AI service | Syntax pass only | `py_compile` passed; no authenticated provider integration or Python behavior suite was available. |
| Build | Pass with performance warning | Production build completed; main JavaScript asset is 4.47 MB uncompressed / 802 KB gzip. |
| Recovery drill | Pass, local only | Encrypted `pg_dump`/restore drill reproduced 63 public tables and the critical-table counts in an isolated PostgreSQL restore target.[3] |
| Load drill | Pass, local only | 250 requests at concurrency 25 to `/api/health`; 0 failures; p95 31.25 ms.[4] |
| Release gate | Expected fail | 4 material blockers prevent a releaseable result.[1] |

## Claim and Coverage Inventory

The version-controlled manifest is the authoritative machine-readable inventory for material claims reviewed during this audit.[1]

| Claim ID | Claim | Direct evidence | Status | Limitation |
|---|---|---|---|---|
| MC-POSTGRES-RUNTIME | Workflow and settlement state persist in PostgreSQL. | Local migrations and runtime health check passed. | **Blocked** | The managed preview injects a non-PostgreSQL database URL; deployed persistence was not observed. |
| MC-SETTLEMENT-EVIDENCE | Settlement evidence is signed, idempotent, atomic, auditable, and reversible. | Local PostgreSQL unit/E2E coverage and lifecycle implementation. | **Verified locally** | No regulated provider or bank transfer was performed. |
| MC-TRANSFER-RAIL | Real funds can be initiated and settled. | Go sidecar rejects live initiation and uses explicit disabled/sandbox modes only. | **Blocked** | Provider/FSP onboarding and evidence do not exist; live initiation is intentionally unavailable. |
| MC-AI-EMR-EXTRACTION | EMR extraction returns real FHIR data. | Synthetic implementation removed during audit. | **Retired** | Endpoint now returns `503` until an authenticated FHIR connector is implemented and tested. |
| MC-DAILY-BALANCE-PROOF | Daily proof and exception review execute durably. | PostgreSQL proof, immutable review, and task-UID configuration are implemented and locally tested. | **Blocked** | No production PostgreSQL binding or deployed Heartbeat execution exists. |
| MC-COMPOSE-PRODUCTION | Development compose is separate from a fail-closed production overlay. | Production overlay requires secrets/endpoints; simulator is profiled for development only. | **Blocked** | The overlay has not been deployed against hardened external dependencies. |
| MC-EMR-CREDENTIALS | EMR credentials are encrypted at rest before persistence. | AES-256-GCM versioned envelope and tamper-rejection test. | **Verified locally** | A managed KMS/HSM and rotation service are not configured. |
| MC-TIGERBEETLE-TRANSPORT | TigerBeetle client connectivity is constrained by mTLS. | CA/client certificate validation, loopback-only stunnel transport, protected runtime key, and read-only `lookupAccounts` probe. | **Verified locally** | No account or transfer mutation was exercised; the control is not regulated-rail or provider interoperability evidence. |
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
| MC-008 | High | EMR connection credentials were reversibly base64-encoded before persistence. | **Fixed:** replaced with versioned AES-256-GCM encryption, authenticated decryption, tamper detection, and production key validation. | Configure managed KMS/HSM-backed key custody and rotation before production EMR onboarding. |
| MC-009 | Critical | Go sidecar allowed a configurable live provider mode and ignored Kafka publish failures. | **Fixed:** live initiation is rejected, sandbox mode is explicit, internal auth is required, and event-publisher unavailability fails the request. | Implement a provider-specific durable, idempotent execution adapter only after sandbox certification. |

## Remediation Implemented During This Audit

The following changes were made and re-tested within the audited workspace:

| Change | Evidence of completion |
|---|---|
| Replaced synthetic Python EMR extraction with fail-closed `503` response | Python syntax gate passed; Node proxy returns a non-success response rather than fabricated source data. |
| Added material claim manifest and assurance gate | `pnpm assurance:check` validates the inventory; `pnpm assurance:release` fails with the active blockers. |
| Added daily balance-proof, exception review, scheduled handler, task ownership, and test coverage | PostgreSQL migrations through `0025`; settlement E2E and unit gates passed. |
| Added provider callback/keyring/mTLS boundary, transfer lifecycle, maker-checker approval, reconciliation, reversals, and recovery tooling | Local PostgreSQL tests and recovery/load evidence passed; external provider assurance remains blocked. |
| Split development compose from a fail-closed production overlay; hardened Go sidecar configuration and transport rules | Production configuration validation passes only with an explicit managed PostgreSQL-style endpoint and required secrets; live transfer initiation is disabled. |
| Replaced reversible EMR credential encoding with AES-256-GCM | New encryption/tamper-rejection unit tests pass; production startup rejects absent or malformed encryption keys. |
| Added TigerBeetle mutual-TLS transport | Public CA/client certificate material is packaged without the private key; the private key is protected runtime configuration. The client is loopback-only, stunnel enforces CA-chain and hostname validation, and a live read-only `lookupAccounts` probe passes. |

## Mandatory Release Blockers

1. Configure the platform-managed `DATABASE_URL` as an SSL-enabled PostgreSQL endpoint, deploy the application, apply migrations, and capture production health/readiness evidence.
2. Deploy the repository's production compose overlay against independently hardened identity, search, etcd, Kafka, TigerBeetle, and provider services; capture interoperability evidence.
3. Onboard a regulated payment provider/FSP sandbox with provider-issued mTLS material, real callback/report contracts, test accounts, settlement/reversal scenarios, and independent operational approval. Do not enable transfer initiation before this gate passes; live initiation is currently disabled in code.
4. Implement and test a real authenticated FHIR connector before re-enabling EMR extraction. Do not substitute synthetic records for clinical or financial decisions.
5. Deploy and observe the daily Heartbeat balance-proof job, including retry behavior, task-UID authorization, alert delivery, and an operator exception-review runbook.

The newly verified TigerBeetle transport narrows the local integration gap but does **not** remove any mandatory release blocker. In particular, it does not provide a contracted bank/FSP rail, provider acceptance, production deployment evidence, or permission to enable real-money execution.

## Release Decision

The application contains useful and locally validated workflow and settlement-evidence controls. It is **not** a releaseable real-money platform and must not be represented as one. The current score is intentionally not elevated above the blockers: local settlement-control implementation is stronger than the deployed assurance posture, but it cannot establish the safety or irreversibility of an external funds transfer.

## Approved Operating Boundary Without Production Dependencies

The approved operating mode is **local development and controlled testing only**. Local PostgreSQL, encrypted backup/restore drills, the settlement-evidence workflow, and disabled payment execution may be used to develop and demonstrate the platform. They must not be represented as a production deployment or as evidence that a provider, bank, FSP, or government endpoint has accepted a transaction.

| Capability | Permitted now | Explicitly not permitted without external evidence |
|---|---|---|
| PostgreSQL | Local development database and isolated recovery drills | Managed production deployment, production migration, or production backup claim |
| Settlement workflow | Evidence recording, approval, reversal, provider-report reconciliation tests | Real-money initiation, real settlement, or provider acceptance claim |
| Provider callback path | Local signed/mTLS assertion test coverage | Provider mTLS interoperability or live callback acceptance claim |
| Scheduled proof | Local task/handler validation | Deployed Heartbeat schedule or operator-alert execution claim |

> **Fail-closed rule:** The release gate must remain `NOT RELEASEABLE`, and `PAYMENT_EXECUTION_MODE` must remain `disabled`, until all release blockers have independently verifiable evidence.

## Reproducible Commands

```bash
cd /home/ubuntu/idr-workflow-demo
pnpm install --frozen-lockfile
npx tsc --noEmit
DATABASE_URL='postgresql://idr_user:idr_pass123@127.0.0.1:5432/idr_demo' TIGERBEETLE_ASSURANCE=true pnpm test
DATABASE_URL='postgresql://idr_user:idr_pass123@127.0.0.1:5432/idr_demo' pnpm test:e2e
(cd services/go && go test ./...)
python3 -m py_compile ai-service/main.py ai-service/cms_validator.py ai-service/agents.py
pnpm build
pnpm assurance:check
pnpm assurance:release # expected nonzero exit while blockers exist
```

## Comprehensive Scenario Assurance Update — 2026-08-15

The available executable platform surface was re-run after TigerBeetle mutual-TLS integration. This does not substitute a provider, bank, regulated FSP, production scheduler, managed deployment, penetration test, or compliance certification. It demonstrates the repository-controlled controls that can be exercised safely in the isolated environment.[1]

| Scenario family | Result | Direct evidence |
|---|---|---|
| Business rules, CRUD contracts, authorization, ledger guards, encryption, callback authentication, reconciliation, and proof logic | Pass | All 12 Vitest suites passed: **170 assertions**. The suite includes negative cases for incompatible database configuration, direct TigerBeetle addressing, ambiguous mTLS key configuration, stale or unsigned settlement callbacks, overpayment, duplicate posting, invalid lifecycle transitions, reversal, and unresolved-exception proof behavior. |
| Settlement callbacks and provider reports | Pass, isolated PostgreSQL | All **8 Playwright** scenarios passed: unauthenticated/stale/mismatched callback rejection, failed settlement handling, legacy route retirement, exactly-once settlement evidence, independent reconciliation, exception behavior, immutable reversal, and balance proof. |
| Authenticated infrastructure controls | Pass, non-mutating | Redis PING, Kafka SASL_SSL metadata, Permify CA-verified bearer health, TigerBeetle CA/hostname-verified mTLS `lookupAccounts`, managed PostgreSQL `verify-ca` read, and Temporal TLS-chain validation all passed. |
| Go and Python services | Pass within available coverage | Go sidecar `go test ./...` and `go vet ./...` passed. Every Python source under `ai-service` and `services` passed syntax compilation. This is not an authenticated AI, FHIR, Temporal worker, or payment-provider behavioral certification. |
| Recovery and resilience | Pass, isolated environment | An AES-256 encrypted backup restored into a separate PostgreSQL target, reproducing **63 public tables** and critical-table counts. A 250-request / 25-concurrency health drill returned 250 successful responses, 0 failures, and **33.69 ms p95** latency. |
| Secure build and release controls | Pass with documented limits | TypeScript, production build, and dependency gate passed. The dependency gate reports 0 critical, 0 high, 1 moderate, and 0 low findings. The release manifest remains structurally valid and deliberately blocks release. |
| Production-deployment preflight | Expected fail-closed result | The production configuration and release gates reject the unavailable production contract rather than substituting local defaults. `assurance:release` reports four active blockers. |

### Readiness Score Method and Result

The implementation-assurance score is a transparent weighted measure of evidence currently available: functional platform behavior 25%, IDR workflow/business rules 25%, security and recovery controls 20%, authenticated integration coverage 15%, and deployment/operations evidence 15%. The tested dimension values were 78, 82, 75, 70, and 45 respectively, yielding **72.25/100**. This number measures the testable implementation and must not be read as launch approval.

| Readiness decision | Score | Interpretation |
|---|---:|---|
| Available implementation assurance | **72.25/100** | Strong local and sandbox evidence for the tested application, settlement-evidence, recovery, and authenticated-infrastructure controls. It is appropriate for controlled development, demonstrations, and further staging work. |
| Production launch readiness for an IDR workflow tracker | **45/100** | **No-go.** The technical evidence is higher than the launch score, but deployed PostgreSQL, production scheduler observation, hardened production-overlay validation, and operator acceptance evidence are still missing. The hard blockers cap launch readiness. |
| Real-money settlement readiness | **15/100** | **No-go; payment execution must remain disabled.** A regulated FSP/bank rail, contract, mTLS interoperability acceptance, real provider-report feed, key-rotation operation, independent review, and regulated operational certification have not been evidenced. No assertion of uncompromisable funds flow is supportable. |

> **Hard-gate rule:** A weighted score never overrides a material release blocker. The platform is not releaseable for production or real funds until all four active claims in the manifest are independently evidenced and `assurance:release` succeeds.[1]

## Production Hardening Update — 2026-08-15

Two repository-controlled gaps identified during the remediation pass were corrected and regression-tested. Production dispute state transitions now fail closed when Redis/Redlock protection is unavailable or a lease cannot be acquired; isolated development and test execution retain the explicitly non-production PostgreSQL-backed path. The standard advance and arbitrator-selection routes now require dispute-level write authorization, validate an allowed state transition, validate the current step's required fields, and derive the status from the canonical workflow definition rather than accepting a caller-supplied status. Direct dispute reads, offer submission and acceptance, document upload, timeline reads, and PDF export now enforce dispute-level authorization.[1]

The complete regression run passed with **174 Vitest assertions** across 14 test files, including the real read-only TigerBeetle mutual-TLS probe, 8 PostgreSQL-backed Playwright settlement scenarios, TypeScript, production build, and the dependency-security gate. The release manifest remains valid with four material blockers. These changes improve local implementation assurance, but they do not supply the independent production, provider, scheduler, or deployment evidence required for a 100/100 release claim.

## References

[1]: ../assurance/claim-manifest.json "Material claim manifest and release gate input"
[2]: ../terminal_full_output/2026-08-13_10-50-47_517453_736.txt "Assurance gate execution output"
[3]: ../scripts/db-recovery-drill.sh "Encrypted PostgreSQL recovery drill"
[4]: ../scripts/load-drill.mjs "Controlled API resilience load drill"
[5]: ../server/tigerbeetle-connectivity.test.ts "Non-mutating mutual-TLS TigerBeetle connectivity assurance"
