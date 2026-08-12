# HealthPoint Production-Readiness and Funds-Flow Control Audit

**Assessment date:** 2026-08-12  
**Assessment basis:** Source snapshot after authenticated-settlement and transactional-outbox implementation, local PostgreSQL migration execution, TypeScript/build/test execution, Playwright end-to-end evidence, static deployment review, and GitHub repository inspection.  
**Scope limitation:** This is an engineering assurance assessment, not a financial, legal, regulatory, PCI DSS, SOC 2, HIPAA, or penetration-testing certification.

> **Verdict:** HealthPoint is a feature-rich **IDR workflow demonstration and operational tracking application**, but it is **not 100% production-ready** and it is **not safe to represent as a production payment-execution platform**. It now accepts signed, timestamp-bounded, idempotent settlement evidence and reconciles it through a PostgreSQL transactional outbox. It still lacks a verified production FSP/bank rail, regulated onboarding, and independently operated production controls.

## 1. Evidence Collected

| Verification area | Result | Evidence |
| --- | --- | --- |
| TypeScript compilation | Passed | `npx tsc --noEmit` exited successfully. |
| Node test suite | Passed | `pnpm test`: **152/152** tests passed. |
| Playwright settlement E2E suite | Passed | 4 scenarios validated rejected unsigned/stale/mismatched callbacks, exactly-once settlement evidence, outbox delivery, overpayment rollback, failed settlement handling, and legacy-route retirement. |
| Node production build | Passed with performance warning | `pnpm build` completed; the JavaScript bundle is 4.47 MB uncompressed / 803.96 KB gzip, above Vite’s 500 KB warning threshold. |
| Go payment-sidecar tests | Passed | `go test ./...` in `services/go`: passed. |
| Migration generation | Passed | Settlement callback/outbox migrations `0021` and `0022` generated and reviewed. |
| Migration application | Passed locally | The full PostgreSQL migration chain, including `settlement_callbacks`, outbox retry metadata, and `event_status=processing`, was applied and queried on PostgreSQL 16. The incompatible managed TiDB/MySQL target was not modified. |
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
| Eventing, workflows, and streaming | 45/100 | Payment evidence and callback events now use a transactional PostgreSQL outbox with `pending`/`processing`/`delivered`/`failed` states, stale-worker recovery, bounded retries, and dispatch after commit. Temporal remains non-authoritative and Kafka/Redis are not independently deployed in this assessment. |
| PostgreSQL evidence ledger | 70/100 | PostgreSQL transactions, transaction-scoped advisory locks, payment-evidence idempotency, positive-cent validation, external-reference requirements, determined-amount limits, and local migration validation are now evidenced. A separately managed production database, backup/restore test, and access review remain required. |
| External funds transfer / settlement rail | 30/100 | Signed HMAC-SHA256 callbacks, a five-minute replay window, provider/event idempotency, atomic settlement evidence, immutable callback rows, outbox delivery, and Playwright coverage exist. The Go sidecar still targets a simulator; no verified regulated FSP/bank integration, maker-checker approval, key rotation, or live settlement certification exists. |
| Observability, deployment, and recovery | 50/100 | Logging, request IDs, readiness, PostgreSQL-only startup validation, a compose migration gate, and local migration validation are evidenced. The live site was not revalidated, and backup/restore, disaster recovery, load, and incident drills remain unevidenced. |
| Overall production readiness for an IDR workflow tracker | **55/100** | Suitable for continued controlled development and more realistic staging validation, not for an unrestricted external production launch. |
| Overall production readiness for handling or initiating real funds | **30/100** | **Not approved for real funds.** Controls improved settlement-evidence integrity but do not establish an independently verified payment rail or guarantee against compromise. |

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

### Controls added in the payment-evidence and settlement hardening work

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
| Signed callback boundary | `/api/settlement/callbacks` verifies the exact raw JSON body with an HMAC-SHA256 signature, signed timestamp, matching event identifier, provider allowlist, payload schema, and five-minute replay window before any database transaction starts. |
| Callback idempotency | `settlement_callbacks(provider, providerEventId)` is unique. Duplicate signed delivery returns the originally reconciled record without a second ledger entry. |
| Transactional outbox | Callback and manual payment-evidence writes add a pending `event_log` row inside the same PostgreSQL transaction as the ledger mutation. The worker claims, retries, and records explicit delivery state after commit. |
| E2E evidence | Playwright provisions an isolated Step 14 fixture and verifies rejection, rollback, exactly-once posting, Step 15 transition, callback persistence, and outbox delivery. |

### Remaining blockers before any real-money use

The following are **mandatory** before enabling real transfer initiation:

1. Deploy one authoritative PostgreSQL environment using the compose migration gate; do not run the PostgreSQL Drizzle schema against the current TiDB/MySQL-managed URL.
2. Replace the Mojaloop simulator with a contracted, production FSP/payment provider; implement mutual TLS or an equivalent provider-authentication scheme, key rotation, provider-specific idempotency semantics, and formal operational acceptance.
3. Extend the settlement model to a durable transfer lifecycle such as `requested`, `authorized`, `submitted`, `accepted`, `settled`, `failed`, `reversed`, and `reconciled`; this implementation intentionally records only externally reported settlement evidence.
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
