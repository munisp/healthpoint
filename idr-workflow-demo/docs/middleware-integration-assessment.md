# HealthPoint IDR Platform — Middleware Integration Assessment

**Document version:** 1.0 · **Date:** July 2026  
**Scope:** 14 middleware and infrastructure components evaluated for integration into the HealthPoint 19-Step Federal IDR Workflow Platform

---

## Executive Summary

The HealthPoint platform processes federally regulated Independent Dispute Resolution (IDR) cases under the No Surprises Act (45 CFR §149.510). Each dispute traverses up to 19 discrete steps — from open negotiation initiation through certified IDR entity (CIDE) determination — with strict statutory deadlines, immutable audit requirements, and multi-party communication obligations involving providers, payers, and federal portals.

The 14 components assessed below span five architectural layers: **data persistence**, **event streaming**, **workflow orchestration**, **security and identity**, **observability**, **API gateway**, **financial ledger**, and **analytics**. Each is evaluated on fit, integration pattern, deployment complexity, and a recommended priority tier.

---

## Architecture Overview

The current HealthPoint stack is a Node.js/React monolith backed by a MySQL-compatible database (TiDB). The migration path recommended here targets a **cloud-agnostic, open-source architecture** using PostgreSQL as the primary OLTP store, with the 14 components layered in according to the priority tiers below.

```
┌─────────────────────────────────────────────────────────────────┐
│  APISIX (API Gateway + OpenAppSec WAF)                          │
├─────────────────────────────────────────────────────────────────┤
│  Keycloak (AuthN/AuthZ)  ←→  Permify (Fine-Grained AuthZ)       │
├──────────────────┬──────────────────────────────────────────────┤
│  HealthPoint     │  Dapr Sidecar (service mesh + pub/sub)       │
│  Node.js App     │                                              │
├──────────────────┴──────────────────────────────────────────────┤
│  Kafka (event backbone)  ←→  Fluvio (edge/real-time streams)    │
├──────────────────────────────────────────────────────────────────┤
│  Temporal (workflow orchestration)                              │
├──────────────────────────────────────────────────────────────────┤
│  PostgreSQL (OLTP)  ←→  TigerBeetle (financial ledger)         │
│  Redis (cache/sessions)  ←→  OpenSearch (full-text/analytics)  │
├──────────────────────────────────────────────────────────────────┤
│  Lakehouse (Apache Iceberg + Spark/Trino)                       │
├──────────────────────────────────────────────────────────────────┤
│  Mojaloop (payment interoperability)                            │
└──────────────────────────────────────────────────────────────────┘
```

---

## Component Assessments

### 1. PostgreSQL

**Role:** Primary OLTP database replacing the current MySQL/TiDB instance.

PostgreSQL is the mandatory database choice for this platform. The existing Drizzle ORM schema uses MySQL-compatible types (`mysqlTable`, `varchar`, `mysqlEnum`); migration to PostgreSQL requires changing the Drizzle driver to `drizzle-orm/postgres-js` and replacing `mysqlEnum` with `pgEnum`, `mysqlTable` with `pgTable`, and `timestamp` with `timestamp` (PostgreSQL-native). The schema is otherwise structurally compatible.

PostgreSQL brings several capabilities critical to IDR compliance: **row-level security** (RLS) for multi-tenant dispute isolation, **logical replication** for CDC (change data capture) to Kafka, **JSONB columns** for flexible metadata storage on audit_log entries, and **advisory locks** for preventing duplicate dispute submissions. The `pg_audit` extension provides database-level audit logging that complements the application-level `audit_log` table.

| Aspect | Detail |
|---|---|
| Migration effort | Medium — Drizzle driver swap + enum/type changes |
| Integration point | Replace `DATABASE_URL` with PostgreSQL DSN; update `drizzle/schema.ts` |
| Key features used | RLS, logical replication, JSONB, pg_audit, advisory locks |
| Deployment | Self-hosted via Docker/Kubernetes; no cloud-vendor lock-in |
| **Priority** | **P0 — Foundational** |

---

### 2. Redis

**Role:** Session cache, distributed locking, rate limiting, and real-time pub/sub for UI notifications.

Redis serves three distinct functions in the IDR platform. First, it replaces the current JWT cookie session store with a distributed session cache, enabling horizontal scaling of the Node.js application tier without sticky sessions. Second, it provides **distributed locks** (via Redlock) to prevent race conditions on dispute state transitions — for example, ensuring that two concurrent requests cannot both advance a dispute from `open_negotiation` to `idr_initiated`. Third, Redis Streams or Pub/Sub can power the real-time notification feed in the UI (dispute status changes, deadline alerts) without requiring a full WebSocket infrastructure.

The integration is straightforward: the `ioredis` npm package connects from the Node.js server; session middleware (`express-session` + `connect-redis`) replaces the current JWT cookie approach, or the JWT approach is retained with Redis used only for token revocation lists and distributed locking.

| Aspect | Detail |
|---|---|
| Migration effort | Low — additive; no schema changes required |
| Integration point | `server/_core/context.ts` for session; new `server/lock.ts` helper for Redlock |
| Key features used | Distributed sessions, Redlock, Pub/Sub for real-time UI notifications |
| Deployment | Redis 7 OSS via Docker; Redis Sentinel for HA |
| **Priority** | **P0 — Foundational** |

---

### 3. Keycloak

**Role:** Identity provider (IdP) — authentication, SSO, MFA, and OIDC/SAML federation.

The current platform uses Manus OAuth for authentication, which is appropriate for the demo environment but insufficient for production. A production IDR platform must support: (a) **multi-tenant SSO** so that provider groups and payer organizations log in with their own identity systems (Active Directory, Okta, Azure AD) via SAML 2.0 or OIDC federation; (b) **MFA enforcement** for all users handling PHI; (c) **role-based token claims** that flow through to the tRPC `ctx.user` object; and (d) **audit-grade login events** required by HIPAA.

Keycloak satisfies all four requirements as a self-hosted, open-source IdP. The integration replaces the current `OAUTH_SERVER_URL` / `VITE_OAUTH_PORTAL_URL` environment variables with Keycloak realm endpoints. The `server/_core/context.ts` JWT verification switches from the Manus token format to Keycloak's JWKS-signed tokens. Keycloak realms map to tenants (one realm per organization or a single realm with tenant-scoped groups), and realm roles (`idr_admin`, `provider_staff`, `payer_reviewer`) map to the existing `role` enum in the `users` table.

| Aspect | Detail |
|---|---|
| Migration effort | Medium-High — replace OAuth provider; update JWT verification in `_core/context.ts` |
| Integration point | `OAUTH_SERVER_URL` → Keycloak realm URL; JWKS endpoint for token verification |
| Key features used | OIDC federation, SAML 2.0 brokering, MFA, realm roles, audit events |
| Deployment | Keycloak 24+ on Kubernetes; PostgreSQL as Keycloak's own DB |
| **Priority** | **P0 — Foundational** |

---

### 4. Permify

**Role:** Fine-grained, relationship-based authorization (ReBAC) engine.

The current platform uses a simple binary `role` field (`admin` / `user`). Production IDR requires far more granular access control: a provider staff member should be able to read their organization's disputes but not those of another provider; a payer reviewer should only see disputes where their payer is named; a CIDE arbitrator should only access disputes assigned to their entity; and an admin should have cross-tenant visibility.

Permify implements **Google Zanzibar-style** relationship-based access control. The authorization schema defines entities (`organization`, `dispute`, `document`, `user`) and relations (`owner`, `reviewer`, `member`), and permission checks are evaluated against a live relation tuple store backed by PostgreSQL. The Node.js integration uses the Permify gRPC client (`@permify/permify-node`); every tRPC `protectedProcedure` that touches a dispute calls `permify.check({ subject, permission, object })` before executing the query.

| Aspect | Detail |
|---|---|
| Migration effort | Medium — define schema; instrument all dispute/document procedures |
| Integration point | New `server/_core/authz.ts` wrapper around Permify gRPC client |
| Key features used | ReBAC schema, permission check API, relation tuple writes on dispute creation |
| Deployment | Permify server on Kubernetes; PostgreSQL for relation store |
| **Priority** | **P1 — High** |

---

### 5. Apache Kafka

**Role:** Durable event backbone for all IDR workflow state transitions.

Every IDR dispute state change (19 steps) is a business event that must be reliably published to downstream consumers: the audit log writer, the webhook dispatcher, the Lakehouse ingestion pipeline, the OpenSearch indexer, and potentially external federal portal integrations. Kafka provides the **durable, ordered, replayable event log** that makes all of these consumers decoupled and independently scalable.

The integration pattern is: the tRPC dispute mutation procedures publish events to Kafka topics (`idr.disputes.state_changes`, `idr.documents.uploaded`, `idr.offers.submitted`) after committing to PostgreSQL. Consumers run as separate Node.js workers (or Go microservices for performance-critical paths) that subscribe to these topics. The `audit_log` table writer, webhook dispatcher, and Lakehouse Kafka connector all become Kafka consumers, eliminating the current synchronous coupling between dispute mutations and side effects.

Kafka also enables **event sourcing** as an optional future pattern: the full dispute history can be reconstructed by replaying the `idr.disputes.state_changes` topic from offset 0, which is valuable for compliance audits and disaster recovery.

| Aspect | Detail |
|---|---|
| Migration effort | High — requires refactoring tRPC mutations to publish events; building consumer workers |
| Integration point | `kafkajs` npm package; new `server/events/producer.ts` and `server/workers/` |
| Key features used | Topic partitioning by `disputeId`, consumer groups, exactly-once semantics |
| Deployment | Apache Kafka 3.x via KRaft (no ZooKeeper); 3-broker cluster |
| **Priority** | **P1 — High** |

---

### 6. Dapr

**Role:** Distributed application runtime — service mesh, pub/sub abstraction, state management, and secret store.

Dapr acts as a **portability layer** between the HealthPoint application code and the underlying infrastructure components. Rather than coding directly against the Kafka SDK, Redis SDK, and PostgreSQL SDK, the application code calls Dapr's unified APIs: `dapr.publishEvent()` instead of Kafka producer, `dapr.getState()` instead of Redis GET, `dapr.getSecret()` instead of direct environment variable access. This means the underlying broker (Kafka vs. RabbitMQ), cache (Redis vs. Memcached), or secret store (Vault vs. AWS Secrets Manager) can be swapped without changing application code.

For the IDR platform specifically, Dapr's **service invocation** feature with mTLS provides secure inter-service communication between the Node.js API, the Go-based TigerBeetle ledger service, and any future Python ML microservices. Dapr's **workflow API** (built on Temporal under the hood in some configurations) can also orchestrate multi-step IDR processes as durable workflows.

The Dapr sidecar is injected as a Kubernetes sidecar container alongside each application pod. The Node.js integration uses the `@dapr/dapr-client` npm package.

| Aspect | Detail |
|---|---|
| Migration effort | Medium — additive sidecar injection; gradual SDK migration |
| Integration point | Kubernetes sidecar annotations; `@dapr/dapr-client` in Node.js |
| Key features used | Pub/sub (Kafka component), state (Redis component), secrets (Vault component), mTLS |
| Deployment | Dapr control plane on Kubernetes; per-pod sidecar injection |
| **Priority** | **P1 — High** |

---

### 7. Fluvio

**Role:** Edge and real-time stream processing — low-latency event enrichment and filtering.

While Kafka handles the durable event backbone, **Fluvio** addresses a different need: real-time, low-latency stream processing at the edge of the platform. Specifically, Fluvio's SmartModules (WebAssembly-based stream processors) can perform inline transformations on the event stream — for example, enriching incoming webhook payloads from federal portals with dispute metadata before they reach the application, or filtering and routing events to different downstream consumers based on content.

Fluvio is particularly well-suited for the **federal portal integration layer** where HealthPoint must consume events from the CMS IDR portal (batched XML/JSON feeds) and transform them into the internal event schema in real time. Its Rust-based runtime delivers sub-millisecond processing latency, which is important for the 3-business-day open negotiation deadline tracking.

The integration uses Fluvio's Kafka-compatible producer/consumer API, meaning existing Kafka consumers can read from Fluvio topics with minimal changes. Fluvio and Kafka can be deployed in tandem, with Fluvio handling edge ingestion and Kafka handling internal durable storage.

| Aspect | Detail |
|---|---|
| Migration effort | Low-Medium — additive; Kafka-compatible API reduces integration friction |
| Integration point | Fluvio Kafka-compatible endpoint; SmartModules for federal portal event transformation |
| Key features used | SmartModules (WASM), Kafka-compatible API, edge ingestion |
| Deployment | Fluvio cluster on Kubernetes or edge nodes near federal portal endpoints |
| **Priority** | **P2 — Medium** |

---

### 8. Temporal

**Role:** Durable workflow orchestration for the 19-step IDR process.

This is arguably the most strategically important middleware component for the IDR platform. The 19-step IDR process is not a simple state machine — it involves **long-running workflows** (up to 30 business days for open negotiation + 10 days for IDR initiation + 30 days for CIDE determination), **human-in-the-loop steps** (provider and payer must both submit offers), **conditional branching** (batch vs. individual disputes, emergency service vs. non-emergency), **deadline enforcement** (statutory timers that auto-advance or auto-close disputes), and **compensation logic** (rollback if a step fails after partial completion).

Temporal's durable execution model is purpose-built for exactly this pattern. Each IDR dispute becomes a Temporal **Workflow** instance. The 19 steps are implemented as **Activities** (individual units of work with retry policies). Temporal's built-in timer support handles statutory deadlines: a `sleep(30 * BUSINESS_DAYS)` in the workflow code creates a durable timer that survives server restarts and infrastructure failures. Human-in-the-loop steps use Temporal **Signals** (external events that advance the workflow) and **Queries** (read the current workflow state without modifying it).

The Node.js integration uses the `@temporalio/client` and `@temporalio/worker` npm packages. The tRPC dispute mutation procedures become thin wrappers that start or signal Temporal workflows, while the actual business logic lives in the workflow and activity definitions.

| Aspect | Detail |
|---|---|
| Migration effort | High — significant refactoring of dispute state machine into Temporal workflows |
| Integration point | `@temporalio/client` in tRPC procedures; `@temporalio/worker` as separate process |
| Key features used | Durable workflows, activities with retry, timers for statutory deadlines, signals, queries |
| Deployment | Temporal Server on Kubernetes; PostgreSQL as Temporal's persistence store |
| **Priority** | **P1 — High** |

---

### 9. TigerBeetle

**Role:** High-performance, ACID-compliant financial ledger for dispute financial tracking.

The IDR process involves precise financial accounting: billed amounts, allowed amounts, paid amounts, patient responsibility, and final determination amounts must be tracked with **double-entry bookkeeping** accuracy. Disputes can involve millions of dollars across thousands of line items, and any discrepancy in financial records is a compliance violation.

TigerBeetle is a purpose-built financial ledger database that enforces double-entry accounting at the database level, with sub-millisecond transaction throughput and deterministic crash safety. For the IDR platform, TigerBeetle stores the financial lifecycle of each dispute: the initial billed amount as a debit, the payer's allowed amount as a credit, the determination amount as a final settlement entry, and any adjustments as correcting entries.

The integration requires a **Go microservice** (per the technology stack preference for performance-critical components) that wraps the TigerBeetle client and exposes a gRPC API consumed by the Node.js application via Dapr service invocation. The Go service handles account creation (one account per dispute party per dispute), transfer creation (each financial event), and balance queries. The Node.js tRPC procedures call this service for all financial operations rather than storing amounts as plain `varchar` fields in PostgreSQL.

| Aspect | Detail |
|---|---|
| Migration effort | High — requires Go microservice; migrate financial fields from PostgreSQL varchar to TigerBeetle |
| Integration point | Go gRPC service; Dapr service invocation from Node.js; new `server/ledger.ts` client |
| Key features used | Double-entry accounts, transfers, balance queries, linked transfers for atomic multi-leg entries |
| Deployment | TigerBeetle cluster (3 replicas); Go ledger service on Kubernetes |
| **Priority** | **P1 — High** |

---

### 10. OpenSearch

**Role:** Full-text search, dispute discovery, and operational analytics dashboard.

The current platform has no search capability beyond exact-match database queries. A production IDR platform requires: (a) **full-text search** across dispute notes, document OCR text, denial reasons, and audit log entries; (b) **faceted filtering** by payer, status, date range, CPT code, and ICD-10 code; (c) **near-real-time indexing** of new disputes and documents; and (d) **aggregation-based dashboards** (dispute volume by payer, average days to close, win rate trends) without putting analytical load on the OLTP PostgreSQL instance.

OpenSearch (the AWS-independent fork of Elasticsearch) satisfies all four requirements. The integration uses a Kafka connector (`opensearch-connector-for-apache-kafka`) that consumes the `idr.disputes.state_changes` topic and indexes documents into OpenSearch in near-real time. The Node.js application queries OpenSearch via the `@opensearch-project/opensearch` npm package for search and aggregation endpoints, while PostgreSQL remains the source of truth for transactional operations.

The Payer Intelligence page's trend charts and the Audit Trail's full-text search are natural candidates for OpenSearch-backed queries once dispute volumes exceed the practical limits of client-side filtering.

| Aspect | Detail |
|---|---|
| Migration effort | Medium — Kafka connector for indexing; replace client-side filtering with OpenSearch queries |
| Integration point | Kafka → OpenSearch connector; `@opensearch-project/opensearch` in tRPC search procedures |
| Key features used | Full-text search, faceted aggregations, Kibana-compatible dashboards |
| Deployment | OpenSearch 2.x cluster on Kubernetes; 3 data nodes + 1 dedicated master |
| **Priority** | **P2 — Medium** |

---

### 11. Keycloak + OpenAppSec

**Role:** Web Application Firewall (WAF) and API security — ML-based threat detection.

OpenAppSec is an open-source, ML-powered WAF that integrates as an NGINX/Envoy plugin or as a standalone Kubernetes admission controller. For the IDR platform, it provides: (a) **OWASP Top 10 protection** (SQL injection, XSS, CSRF) at the API gateway layer; (b) **ML-based anomaly detection** that learns the normal request patterns for each tRPC endpoint and flags deviations (e.g., an unusually large payload on `docIntelligence.analyze`); (c) **rate limiting** per user/IP to prevent abuse of the VLM OCR endpoint; and (d) **bot detection** to prevent automated scraping of dispute data.

OpenAppSec integrates with APISIX (see below) as a plugin, creating a unified security perimeter. The ML model is trained on production traffic and updated continuously, which is important for a platform where the request patterns evolve as new features are added.

| Aspect | Detail |
|---|---|
| Migration effort | Low — plugin installation on APISIX/NGINX; no application code changes |
| Integration point | APISIX plugin configuration; OpenAppSec management API for policy updates |
| Key features used | ML-based WAF, OWASP protection, rate limiting, bot detection |
| Deployment | OpenAppSec agent as Kubernetes DaemonSet; management server as Deployment |
| **Priority** | **P1 — High** |

---

### 12. APISIX

**Role:** API gateway — routing, rate limiting, authentication offloading, and plugin ecosystem.

APISIX replaces any existing reverse proxy (NGINX, Caddy) as the unified API gateway for the HealthPoint platform. Its plugin ecosystem is the key differentiator: the **Keycloak auth plugin** validates JWT tokens at the gateway layer before requests reach the Node.js application; the **OpenAppSec plugin** applies WAF rules; the **Kafka logger plugin** streams all API access logs to Kafka for audit purposes; and the **traffic-split plugin** enables canary deployments of new dispute workflow versions.

For the IDR platform's federal portal integration, APISIX's **gRPC transcoding plugin** translates HTTP/JSON requests from the Node.js application into gRPC calls to the TigerBeetle Go service and the Temporal worker service, eliminating the need for separate gRPC-HTTP bridges.

APISIX's **rate limiting** at the gateway layer (rather than in application code) is critical for the VLM OCR endpoint (`docIntelligence.analyze`), which is computationally expensive and should be limited to a configurable number of requests per user per minute.

| Aspect | Detail |
|---|---|
| Migration effort | Medium — replace existing reverse proxy; configure routes and plugins |
| Integration point | Kubernetes Ingress replacement; Keycloak OIDC plugin; OpenAppSec plugin |
| Key features used | JWT auth offloading, rate limiting, gRPC transcoding, traffic splitting, Kafka access logging |
| Deployment | APISIX on Kubernetes with etcd for configuration storage |
| **Priority** | **P1 — High** |

---

### 13. Mojaloop

**Role:** Payment interoperability — settlement of IDR determination amounts between providers and payers.

Mojaloop is the open-source payment switch developed by the Gates Foundation for interoperable financial transfers. In the IDR context, once a CIDE issues a final determination, the payer is obligated to pay the determined amount to the provider within a statutory timeframe. Mojaloop provides the **payment rail** for this settlement, connecting to payer payment systems and provider banking systems via the Mojaloop API (based on the Level One Project principles and ISO 20022).

The integration is the most complex of all 14 components. It requires: (a) a **Mojaloop participant** account for the HealthPoint platform (acting as a DFSP — Digital Financial Services Provider); (b) a **quote request** workflow triggered when a determination is issued; (c) a **transfer execution** workflow that moves funds from the payer's Mojaloop account to the provider's account; and (d) integration with TigerBeetle to record the settlement as a final ledger entry.

Given the regulatory complexity of payment settlement in the US healthcare context (ACH, HIPAA financial transaction standards), Mojaloop is a **P3 — Future** priority that requires dedicated legal and compliance review before implementation.

| Aspect | Detail |
|---|---|
| Migration effort | Very High — requires DFSP registration, legal review, ACH/banking integration |
| Integration point | Mojaloop SDK (`@mojaloop/sdk-scheme-adapter`); TigerBeetle for settlement ledger entries |
| Key features used | DFSP participant API, quote/transfer workflow, ISO 20022 message format |
| Deployment | Mojaloop switch (self-hosted or via Mojaloop Hub); participant connector service |
| **Priority** | **P3 — Future** |

---

### 14. Lakehouse (Apache Iceberg + Apache Spark + Trino)

**Role:** Unified analytics platform — historical dispute analytics, ML model training, and regulatory reporting.

The Lakehouse is the **central data platform** that integrates all other components for analytics and AI/ML purposes. The architecture uses Apache Iceberg as the open table format (stored on S3-compatible object storage), Apache Spark for batch ETL and ML feature engineering, and Trino for interactive SQL analytics.

All core system components feed into the Lakehouse:

- **PostgreSQL** → Kafka CDC → Iceberg tables (disputes, users, audit_log, webhooks)
- **TigerBeetle** → periodic export → Iceberg financial tables (accounts, transfers, balances)
- **OpenSearch** → periodic snapshot → Iceberg search analytics tables
- **Kafka** → Kafka Iceberg sink connector → real-time event tables
- **VLM OCR results** → document_analyses table → Iceberg for ML training data

The Lakehouse enables: (a) **regulatory reporting** — generating the annual NSA compliance reports required by CMS; (b) **ML model training** — training the outcome prediction model on historical dispute data (payer, CPT codes, billed amount, denial reason → win probability); (c) **Payer Intelligence analytics** — the trend charts in the Payer Intelligence page can be powered by pre-computed Iceberg aggregations rather than live PostgreSQL queries; and (d) **cross-tenant benchmarking** — anonymized aggregate statistics across all platform tenants.

The Lakehouse must be the authoritative source for all analytical queries. No analytical workload should run against the OLTP PostgreSQL instance in production.

| Aspect | Detail |
|---|---|
| Migration effort | High — requires object storage, Spark cluster, Trino cluster, Kafka connectors |
| Integration point | Kafka → Iceberg sink; PostgreSQL CDC → Kafka → Iceberg; Trino query API for analytics |
| Key features used | Iceberg ACID tables, Spark ETL, Trino SQL, time-travel queries for audit |
| Deployment | MinIO (S3-compatible) + Spark on Kubernetes + Trino cluster |
| **Priority** | **P2 — Medium** |

---

## Integration Priority Matrix

| Priority | Component | Rationale |
|---|---|---|
| **P0 — Foundational** | PostgreSQL | Mandatory DB preference; replace MySQL/TiDB immediately |
| **P0 — Foundational** | Redis | Session management, distributed locking for state transitions |
| **P0 — Foundational** | Keycloak | Production-grade AuthN; HIPAA MFA requirement |
| **P1 — High** | Permify | Fine-grained multi-tenant authorization |
| **P1 — High** | Kafka | Durable event backbone; decouple mutations from side effects |
| **P1 — High** | Dapr | Portability layer; mTLS inter-service; secret management |
| **P1 — High** | Temporal | Durable 19-step workflow orchestration with statutory timers |
| **P1 — High** | TigerBeetle | Double-entry financial ledger for determination amounts |
| **P1 — High** | APISIX + OpenAppSec | API gateway + ML WAF; rate limiting on VLM endpoint |
| **P2 — Medium** | Fluvio | Edge stream processing for federal portal ingestion |
| **P2 — Medium** | OpenSearch | Full-text dispute search; analytics offload from OLTP |
| **P2 — Medium** | Lakehouse | Regulatory reporting; ML training; Payer Intelligence analytics |
| **P3 — Future** | Mojaloop | Payment settlement post-determination; requires legal review |

---

## Recommended Implementation Sequence

**Phase 1 (Months 1–2): Foundation**
Migrate from MySQL/TiDB to PostgreSQL. Deploy Redis for distributed locking and session management. Replace Manus OAuth with Keycloak, configuring the existing `users` table roles as Keycloak realm roles. These three changes are prerequisites for everything that follows.

**Phase 2 (Months 3–4): Security and Gateway**
Deploy APISIX as the API gateway with the Keycloak JWT plugin and OpenAppSec WAF plugin. Implement Permify for fine-grained dispute-level authorization, replacing the binary `role` field checks in tRPC procedures. Add Dapr sidecar injection to the Node.js application pods.

**Phase 3 (Months 5–7): Event Backbone and Workflow**
Deploy Kafka and refactor dispute mutation procedures to publish events. Implement Temporal workflows for the 19-step IDR process, starting with the open negotiation and IDR initiation steps. Deploy TigerBeetle with the Go ledger microservice and migrate financial fields.

**Phase 4 (Months 8–10): Analytics and Search**
Deploy OpenSearch with the Kafka connector for near-real-time dispute indexing. Build the Lakehouse (MinIO + Iceberg + Trino) and establish CDC pipelines from PostgreSQL and Kafka. Deploy Fluvio for federal portal event ingestion. Migrate Payer Intelligence analytics to Trino-backed queries.

**Phase 5 (Month 12+): Payment Settlement**
Engage legal and compliance review for Mojaloop integration. Implement the DFSP participant connector and TigerBeetle settlement entries once regulatory clearance is obtained.

---

## Current Platform Integration Status

The HealthPoint demo platform currently implements application-level analogs of several of these components:

| Middleware | Current Analog | Gap |
|---|---|---|
| PostgreSQL | MySQL/TiDB via Drizzle ORM | Driver and schema type migration required |
| Redis | None (in-memory state) | No distributed locking; single-instance only |
| Keycloak | Manus OAuth (demo only) | No MFA, no SSO federation, no SAML |
| Permify | Binary `role` field | No object-level authorization |
| Kafka | Synchronous tRPC mutations | No event decoupling; side effects are synchronous |
| Dapr | None | No service mesh; direct SDK calls |
| Temporal | In-memory state machine | No durable timers; no crash recovery |
| TigerBeetle | `varchar` financial fields | No double-entry; no ledger integrity |
| APISIX | None (direct Node.js) | No gateway; no rate limiting |
| OpenAppSec | None | No WAF |
| Fluvio | None | No edge stream processing |
| OpenSearch | Client-side JS filtering | No full-text search; no aggregations |
| Lakehouse | None | No analytics layer |
| Mojaloop | None | No payment settlement |

---

*This assessment is based on the HealthPoint platform architecture as of July 2026. All middleware components referenced are open-source and cloud-agnostic, consistent with the platform's architectural principles.*
