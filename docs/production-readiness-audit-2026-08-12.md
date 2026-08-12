# HealthPoint Production-Readiness and Funds-Flow Control Audit

**Assessment date:** 2026-08-12  
**Assessment basis:** Source snapshot at commit `ccbcad5`, local build/test execution, static review of service and deployment configuration, and GitHub repository inspection.  
**Scope limitation:** This is an engineering assurance assessment, not a financial, legal, regulatory, PCI DSS, SOC 2, HIPAA, or penetration-testing certification.

> **Verdict:** HealthPoint is a feature-rich **IDR workflow demonstration and operational tracking application**, but it is **not 100% production-ready** and it is **not safe to represent as a production payment-execution platform**. The current platform records IDR payment obligations and payment evidence; it does not yet have a verified end-to-end settlement rail, bank/FSP onboarding, callback authentication, durable reconciliation workflow, or an independently deployed PostgreSQL migration target.

## 1. Evidence Collected

| Verification area | Result | Evidence |
| --- | --- | --- |
| TypeScript compilation | Passed | `npx tsc --noEmit` exited successfully. |
| Node test suite | Passed | `pnpm test --run`: **150/150** tests passed. |
| Node production build | Passed with performance warning | `pnpm build` completed; the JavaScript bundle is 4.47 MB uncompressed / 803.96 KB gzip, above Vite’s 500 KB warning threshold. |
| Go payment-sidecar tests | Passed | `go test ./...` in `services/go`: passed. |
| Migration generation | Passed | `drizzle/migrations/0020_living_human_cannonball.sql` generated. |
| Migration application | Blocked | The managed `DATABASE_URL` resolves to **TiDB/MySQL**, while the source schema and generated migration use PostgreSQL syntax. The local PostgreSQL service is unavailable in this sandbox. |
| Live-site verification | Blocked | `https://healthpoint.upi.dev` rendered a blank page during this review; the hardened code has not been verified as deployed there. |
| GitHub PR/branch review | Completed | `munisp/healthpoint` had no open PRs and initially only `main`; its history has no merge base with the validated workspace branch. |

## 2. Production-Readiness Scores

Scores reflect **verified behavior in this snapshot**, not intended architecture, diagrams, Docker service declarations, or roadmap claims. A score of 100 requires deployed configuration, migration validation, operational evidence, and end-to-end tests for the stated function.

| Capability | Score | Assessment |
| --- | ---: | --- |
| React/tRPC user interface and primary dispute CRUD | 65/100 | A substantial React, tRPC, Drizzle, and PostgreSQL-oriented implementation exists. Compilation/build pass, but there is no browser E2E suite and some pages contain simulation/local-storage behavior. |
| IDR workflow and business-rule enforcement | 55/100 | The 19-step model, deadlines, status values, and tests exist. However, `disputes.advance` calls `advanceDisputeStep` directly (`server/routers.ts`) rather than the stricter `advanceWorkflow` engine; server-side transition and required-field enforcement are therefore incomplete. |
| Authentication, authorization, and HTTP middleware | 65/100 | Helmet, CORS, HPP, compression, request IDs, rate limiting, slow-down, logging, and readiness endpoints are registered in `server/_core/index.ts`. Resource authorization is inconsistent: some mutations use `assertDisputeAccess`, while `disputes.getById` does not show an equivalent access check. |
| Documents, search, reports, and export | 60/100 | DB-backed procedures and export paths are present. OpenSearch and external services remain optional/fallback configurations; no end-to-end production dependency validation was available. |
| AI, EMR, and FHIR integration | 30/100 | There are live procedure paths, but explicit demo/simulation implementations remain, including hard-coded FHIR resources in `LastEHRIntegration.tsx` and simulation content in `SmartFormVisualization.tsx`. These cannot be described as uniformly live integrations. |
| Eventing, workflows, and streaming | 30/100 | KafkaJS and Redis clients are present; Compose provisions Kafka, Temporal, Fluvio, and Dapr. The active event bus is primarily in-process and accepts Kafka/Redis failures. `server/events/kafka-consumer.ts` logs payment events with a future-work comment instead of reconciling them. Temporal is queried/fallback-only rather than the authoritative workflow executor. |
| PostgreSQL evidence ledger | 55/100 | The hardened source now uses PostgreSQL transactions, transaction-scoped advisory locks, payment evidence idempotency, positive-cent validation, external-reference requirements, and determined-amount limits. The migration is generated but not applied to a reachable PostgreSQL production target, so this score cannot be higher. |
| External funds transfer / settlement rail | 15/100 | The Go sidecar can call a Mojaloop-compatible endpoint and TigerBeetle client, but the configured compose target is a **Mojaloop simulator**. There is no verified regulated FSP/bank integration, callback signature verification, transfer-state machine, approval policy, reconciliation worker, or live settlement test. |
| Observability, deployment, and recovery | 40/100 | Logging, request IDs, readiness, Docker Compose, and some health checks are present. The live site was blank during review, the database deployment target is dialect-incompatible with the code, and no backup/restore, disaster recovery, load, or incident drills were evidenced. |
| Overall production readiness for an IDR workflow tracker | **48/100** | Suitable for continued controlled development and demo/training use, not for an unrestricted external production launch. |
| Overall production readiness for handling or initiating real funds | **15/100** | **Not approved**. No engineering review can honestly guarantee that funds-flow scenarios are uncompromisable on this implementation. |

## 3. Verified Non-Production or Simulated Areas

The audit found explicit simulation, local-only persistence, and unsupported production claims. These are not necessarily defects in a demo, but they prevent a blanket “no mocks, no stubs, 100% production-ready” assertion.

| Area | Evidence | Consequence |
| --- | --- | --- |
| Negotiation messages | `client/src/pages/OfferNegotiationThread.tsx` identifies a localStorage-backed simulated thread. | Negotiation history is not shared, durable, or audit-grade. |
| FHIR experience | `client/src/pages/LastEHRIntegration.tsx` contains simulated FHIR resources and simulated agent responses. | UI may appear to have EMR data even without a live EMR connection. |
| Smart-form visualization | `client/src/pages/SmartFormVisualization.tsx` includes `SIMULATED_FIELDS` and a simulation tab. | Demonstration data must not be presented as patient/document extraction results. |
| Benchmarks | `client/src/pages/PerformanceBenchmarks.tsx` states that provider win rate is simulated for demo purposes. | Benchmarks cannot support operational or financial decisions without source validation. |
| System integration status | `client/src/pages/GlobalSettings.tsx` labels OpenSearch, Kafka, Temporal, and TigerBeetle as simulated/swap-for-production. | Provisioning a service in Compose does not prove it is the active control plane. |
| Payment reconciliation | `client/src/pages/PaymentReconciliation.tsx` derives matching/variance in the client from dispute values. | It is analytical UI, not an authoritative settlement-control or reconciliation process. |

## 4. Funds-Flow Boundary and Remediation Applied

### What HealthPoint does today

The application currently manages **IDR dispute financial information**: billed amounts, offers, determination amounts, deadlines, and payment evidence. The React financial-ledger form now explicitly says that it writes an auditable record of an **externally completed payment** and does not initiate, route, or release funds.

It does **not** currently prove that a payer’s bank/FSP transferred money to a payee. A user-entered “Record Payment Evidence” action therefore must be treated as an operator attestation supported by an external payment reference, not as settlement confirmation from a payment rail.

### Controls added in commit `ccbcad5`

| Control | Implementation |
| --- | --- |
| Atomic ledger write | `server/ledger.ts` now inserts the journal entry, updates both balances, and updates cumulative `disputes.paidAmount` within one PostgreSQL transaction. |
| Concurrency control independent of Redis | Each ledger transaction obtains `pg_advisory_xact_lock(hashtext(disputeId))`. This serializes same-dispute ledger writes even when optional Redis/Redlock is unavailable. |
| Idempotency | `ledger_entries.idempotencyKey` plus unique index `ledger_entries_dispute_idempotency_idx`; retries return the original entry instead of duplicating payment evidence. |
| Evidence requirement | Payment records require a nonblank external reference and an idempotency key. The UI requires an ACH trace, bank confirmation, or remittance ID. |
| Amount guard | Payment evidence is rejected unless a determination amount exists, the dispute is in/after the payment-determination stage, and the cumulative evidence does not exceed the remaining determination amount. |
| Correct event semantics | The event changed from a misleading `dispute.offer_submitted` event to `payment.recorded`. |
| Payment sidecar fail-closed behavior | `services/go/main.go` disables execution endpoints unless `INTERNAL_SERVICE_TOKEN` is configured and supplied as `X-Internal-Auth`; unavailable TigerBeetle also returns 503. |
| Mojaloop request correction | The sidecar now validates USD/amount fields and sends the marshalled JSON payload instead of an empty request body. |
| Sidecar tests | `services/go/main_test.go` validates payment input and fail-closed internal authorization. |

### Remaining blockers before any real-money use

The following are **mandatory** before enabling real transfer initiation:

1. Deploy one authoritative PostgreSQL environment and apply migration `0020`; do not run the PostgreSQL Drizzle schema against the current TiDB/MySQL-managed URL.
2. Replace the Mojaloop simulator with a contracted, production FSP/payment provider; implement mutually authenticated APIs, signed callback verification, key rotation, and provider-specific idempotency semantics.
3. Implement a durable payment state machine with explicit states such as `requested`, `authorized`, `submitted`, `accepted`, `settled`, `failed`, `reversed`, and `reconciled`. Only provider-authenticated settlement callbacks may mark a payment settled.
4. Add a transactional outbox in the same transaction as the financial write and a retrying consumer. Current `eventBus.publish` and Kafka/Redis publication can fail without blocking the primary write.
5. Make Redis/Redlock fail closed for non-ledger critical state transitions or use PostgreSQL transaction/advisory locks consistently; `withDisputeLock` presently executes unlocked when Redis is absent or lock acquisition fails.
6. Move the 19-step state machine into the authoritative transaction path, enforce required-field guards, and reject arbitrary `newStatus`/step jumps at the API layer.
7. Add independent reconciliation against provider settlement reports, maker-checker approval for transfers, role separation, immutable audit exports, daily balance proof, and controlled reversal/correction entries rather than mutable state edits.
8. Complete threat modeling, penetration testing, secrets management, backup/restore tests, disaster recovery exercises, operational alerting, load tests, and compliance assessment appropriate to the regulated parties and payment rail.

## 5. Middleware and Infrastructure Reality Check

| Component | Verified status | Required interpretation |
| --- | --- | --- |
| PostgreSQL | Source uses `drizzle-orm/postgres-js`; Docker Compose provisions PostgreSQL. | Correct target for the source design, but unavailable in this sandbox and not aligned with the managed TiDB URL. |
| Redis / Redlock | Client and lock helper exist. | Not a guaranteed lock because the helper falls back to unlocked execution. Ledger writes now use PostgreSQL advisory locks instead. |
| Kafka | KafkaJS producer/consumer code exists and Compose provisions topics. | Payment consumer is logging-only; it is not a settlement/reconciliation worker. |
| Temporal | Compose provisions Temporal and UI; tRPC has status lookup/fallback. | Not the authoritative executor for the main dispute workflow. |
| TigerBeetle | Compose and Go client exist. | Not the active Node ledger; deployment and account provisioning have not been verified. |
| Fluvio | Compose and Rust-service configuration exist. | No verified business-critical funds-flow consumer was found. |
| Mojaloop | Go connector and simulator config exist. | Simulator/incomplete connector is not a real payment network integration. |
| Dapr | Subscription endpoints are registered. | Payment events are acknowledged/logged; no authoritative settlement update is performed. |

## 6. GitHub Reconciliation Result

| Item | Result |
| --- | --- |
| Repository | [munisp/healthpoint](https://github.com/munisp/healthpoint) |
| Open pull requests | None at inspection time. |
| Initial remote branches | Only `main`. |
| Validated workspace commit | `ccbcad5a4168af0e947006cd1661d03453d8d70a` — `feat: harden payment evidence and internal funds controls`. |
| Safe pushed branch | [`audit/funds-flow-hardening-20260812`](https://github.com/munisp/healthpoint/tree/audit/funds-flow-hardening-20260812) |
| GitHub main | `b529f2a` |
| Merge status | **Not merged automatically.** `main` and the workspace have no merge base; GitHub main contains 4,359 tracked files versus 368 in the validated workspace, with 4,057 files differing. A force push would risk deleting unrelated remote work, so it was not performed. |

The safe branch preserves all validated local changes on GitHub. A human repository owner should decide whether GitHub `main` or the current workspace is authoritative before approving an explicit merge, repository migration, or force-replacement plan.

## 7. Required Go/No-Go Decision

**Go for controlled development/demo:** Yes, with clear labeling of simulated features and no payment-execution claims.

**Go for an IDR workflow production pilot:** Not yet. First resolve PostgreSQL deployment, workflow authorization/guard enforcement, E2E tests, live deployment health, and simulated feature boundaries.

**Go for real funds initiation, custody, or settlement:** **No.** The current system must remain fail-closed for payment execution until the mandatory controls in Section 4 are implemented, deployed, independently tested, and reviewed by qualified security, payments, compliance, and legal stakeholders.
