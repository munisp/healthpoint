# HealthPoint Production-Readiness and Funds-Flow Control Audit

**Assessment date:** 2026-08-12  
**Assessment basis:** Source snapshot after authenticated-settlement, provider mTLS/key-rotation, transactional-outbox, encrypted PostgreSQL recovery, and load-drill implementation; local PostgreSQL migration and recovery execution; TypeScript/build/test execution; Playwright end-to-end evidence; static deployment review; and GitHub repository inspection.  
**Scope limitation:** This is an engineering assurance assessment, not a financial, legal, regulatory, PCI DSS, SOC 2, HIPAA, or penetration-testing certification.

> **Verdict:** HealthPoint is a feature-rich **IDR workflow demonstration and operational tracking application**, but it is **not 100% production-ready** and it is **not safe to represent as a production payment-execution platform**. It now accepts versioned-HMAC, timestamp-bounded, trusted-mTLS-ingress settlement evidence and reconciles it through a PostgreSQL transactional outbox. It still lacks a verified production FSP/bank rail, regulated onboarding, and independently operated production controls.

## 1. Evidence Collected

| Verification area | Result | Evidence |
| --- | --- | --- |
| TypeScript compilation | Passed | `npx tsc --noEmit` exited successfully. |
| Node test suite | Passed | `pnpm test`: **155/155** tests passed, including versioned-key, mTLS ingress-token, and backup encryption configuration checks. |
| Playwright settlement E2E suite | Passed | 4 scenarios validated trusted mTLS headers plus versioned callback-key authentication, rejected unsigned/stale/mismatched callbacks, exactly-once settlement evidence, outbox delivery, overpayment rollback, failed settlement handling, and legacy-route retirement. |
| Node production build | Passed with performance warning | `pnpm build` completed; the JavaScript bundle is 4.47 MB uncompressed / 803.96 KB gzip, above Vite’s 500 KB warning threshold. |
| Go payment-sidecar tests | Passed | `go test ./...` in `services/go`: passed. |
| Migration generation | Passed | Settlement callback/outbox migrations `0021` and `0022` generated and reviewed. |
| Migration application | Passed locally | The full PostgreSQL migration chain, including `settlement_callbacks`, outbox retry metadata, and `event_status=processing`, was applied and queried on PostgreSQL 16. The incompatible managed TiDB/MySQL target was not modified. |
| Encrypted PostgreSQL recovery drill | Passed locally | Custom-format `pg_dump`, AES-256 GPG encryption, pre-restore archive validation, guarded `pg_restore`, and critical-table integrity comparison restored an isolated PostgreSQL target successfully. |
| API/database resilience drill | Passed locally | 250 concurrent `/api/health` requests against an isolated PostgreSQL-backed process completed with 0% errors and 44.6 ms p95 latency. |
| Production configuration contract | Passed locally; deployment action pending | `validate:production-config` rejects non-PostgreSQL URLs and missing mTLS/keyring/backup configuration. The managed built-in database URL cannot be edited through this workspace and remains an external deployment prerequisite. |
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
| PostgreSQL evidence ledger | 75/100 | PostgreSQL transactions, transaction-scoped advisory locks, payment-evidence idempotency, positive-cent validation, determined-amount limits, local migration validation, and an encrypted restore drill are evidenced. A separately managed production database, access review, and scheduled recovery exercise remain required. |
| External funds transfer / settlement rail | 48/100 | Versioned HMAC callbacks, trusted mTLS ingress, provider fingerprint allowlisting, immutable transfer lifecycle states, maker-checker approvals, independent signed provider-report reconciliation, daily balance proofs, exception evidence, immutable reversals, atomic ledger changes, and Playwright coverage exist. The Go sidecar still targets a simulator; no verified regulated FSP/bank integration or live settlement certification exists. |
| Observability, deployment, and recovery | 65/100 | Logging, request IDs, readiness, PostgreSQL-only startup validation, a compose migration gate, encrypted backup/restore automation, and a successful local load drill are evidenced. The live site and a managed PostgreSQL endpoint remain unvalidated. |
| Overall production readiness for an IDR workflow tracker | **60/100** | Suitable for controlled development and staging validation, not for an unrestricted external production launch. |
| Overall production readiness for handling or initiating real funds | **45/100** | **Not approved for real funds.** The new controls materially improve intent, approval, reconciliation, daily proof, exception handling, and reversal integrity but do not establish an independently verified payment rail or guarantee against compromise. |

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
| Provider mTLS ingress | Caddy requires and verifies a provider client certificate against a configured CA, then supplies a certificate fingerprint and internal ingress token to the application. The application rejects unverified, spoofed, or non-allowlisted ingress evidence before parsing a callback. |
| Callback key rotation | `SETTLEMENT_CALLBACK_KEYRING` maps versioned key IDs to HMAC secrets. The callback declares `x-settlement-key-id`; current and prior provider keys can overlap safely, while unknown keys fail closed. |
| Recovery automation | `db-backup.sh`, `db-restore-verify.sh`, and `db-recovery-drill.sh` use encrypted custom PostgreSQL dumps, explicit destructive-restore guards, `pg_restore --list` validation, and critical-table count comparison. |
| Load drill | `load:drill` records request count, errors, p50/p95/max latency, thresholds, and a JSON evidence artifact; the verified local drill completed 250 concurrent API/database health checks without error. |
| Transfer lifecycle | `settlement_transfers` persists the fail-closed progression `requested → authorized → submitted → accepted → settled/reconciled`, plus failed and reversal paths. Invalid jumps are rejected in the service transaction. Transfer requests record intent only and never invoke a payment rail. |
| Maker-checker approval | `settlement_approvals` permits exactly one immutable approval or rejection per transfer. The requesting actor cannot approve their own transfer; approved decisions expire; only a current distinct-party approval permits a submission record. |
| Independent provider-report reconciliation | `/api/settlement/reports` requires the same raw-body signature, versioned key, replay window, provider allowlist, mTLS ingress assertion, certificate fingerprint, and ingress token as callbacks. It records immutable provider reports, matched or exception reconciliation rows, and durable outbox events. |
| Exception and reversal handling | Amount, provider-reference, and invalid-transition discrepancies persist as reconciliation exceptions without mutating the transfer. A signed provider reversal creates an immutable correcting ledger entry, decrements the evidenced payment balance, and records the reconciliation. |
| Daily balance proof and exception review | A guarded daily endpoint creates an idempotent, SHA-256-evidenced PostgreSQL proof of ledger payment/reversal totals, dispute-paid balances, transfer counts, and unresolved reconciliation exceptions. Failed proofs create administrator alerts; exception decisions are one-way from `open` to `resolved` or `accepted_risk`. |

### Remaining blockers before any real-money use

The following are **mandatory** before enabling real transfer initiation:

1. Configure the deployment’s built-in `DATABASE_URL` with an authoritative managed PostgreSQL URI and deploy through the compose migration gate; do not run the PostgreSQL Drizzle schema against the current TiDB/MySQL-managed URL.
2. Replace the development CA, certificate fingerprint, callback keyring, ingress token, JWT secret, and backup passphrase with separately managed provider/production material; retain the prior callback key only during an explicitly documented rotation overlap.
3. Replace the Mojaloop simulator with a contracted, production FSP/payment provider and complete provider-specific mutual-TLS interoperability, idempotency, and operational acceptance testing.
4. Extend the settlement model to a durable transfer lifecycle such as `requested`, `authorized`, `submitted`, `accepted`, `settled`, `failed`, `reversed`, and `reconciled`; this implementation intentionally records only externally reported settlement evidence.
5. Make Redis/Redlock fail closed for non-ledger critical state transitions or use PostgreSQL transaction/advisory locks consistently; `withDisputeLock` presently executes unlocked when Redis is absent or lock acquisition fails.
6. Move the 19-step state machine into the authoritative transaction path, enforce required-field guards, and reject arbitrary `newStatus`/step jumps at the API layer.
7. Wire the daily balance-proof endpoint to the production scheduler, complete role-separation review for the production identity provider, retain immutable audit exports, configure production operational alert delivery, and complete provider-specific reversal/correction acceptance criteria.
8. Complete threat modeling, penetration testing, secrets management, backup/restore tests, disaster recovery exercises, operational alerting, load tests, and compliance assessment appropriate to the regulated parties and payment rail.

## 5. Middleware and Infrastructure Reality Check

| Component | Verified status | Required interpretation |
| --- | --- | --- |
| PostgreSQL | Source uses `drizzle-orm/postgres-js`; Docker Compose provisions PostgreSQL. | The complete migration chain, encrypted recovery drill, and configuration contract were validated locally. The managed deployment URL still needs replacement with PostgreSQL. |
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
| Reconciliation pull request | [#1](https://github.com/munisp/healthpoint/pull/1), merged after validation. |
| Initial remote branches | Only `main`. |
| Validated workspace commit | `ccbcad5a4168af0e947006cd1661d03453d8d70a` — `feat: harden payment evidence and internal funds controls`. |
| Safe pushed branch | [`audit/funds-flow-hardening-20260812`](https://github.com/munisp/healthpoint/tree/audit/funds-flow-hardening-20260812) |
| GitHub main | `df589f7` at the validated reconciliation point. |
| Merge status | **Merged safely.** PR #1 created a non-destructive merge commit that preserves both unrelated histories; TypeScript, Vitest, Playwright, and production build passed on the reconciliation branch before merge. |

The validated workspace and GitHub `main` are reconciled without force replacement. Future work should branch from the merged main history.

## 7. Required Go/No-Go Decision

**Go for controlled development/demo:** Yes, with clear labeling of simulated features and no payment-execution claims.

**Go for an IDR workflow production pilot:** Not yet. First resolve PostgreSQL deployment, workflow authorization/guard enforcement, E2E tests, live deployment health, and simulated feature boundaries.

**Go for real funds initiation, custody, or settlement:** **No.** The current system must remain fail-closed for payment execution until the mandatory controls in Section 4 are implemented, deployed, independently tested, and reviewed by qualified security, payments, compliance, and legal stakeholders.
