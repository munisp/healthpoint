# Production Readiness Reassessment — 2026-08-19

## Decision

**HealthPoint is not ready for a blanket production or real-money release.** The deployed TypeScript/Express IDR workflow has meaningful production controls and verified infrastructure connectivity, but the repository also contains simulated and mock Python services outside the active deployed application path. In addition, the regulated provider/FSP acceptance gate remains open and payment execution is deliberately disabled.

| Dimension | Evidence | Assessment |
|---|---|---:|
| Active IDR web application | PostgreSQL-only guard, Keycloak/OAuth routes, role/object authorization, 19-step validation, transactional outbox, encryption, admin proof UI | **75 / 100** |
| Deployment and operations | Managed PostgreSQL strict TLS, Redis, Kafka, Permify, Temporal TLS, deployed health check, observed balance-proof Heartbeat | **70 / 100** |
| Provider settlement interoperability | Hermetic simulator only; no provider-issued mTLS material, bilateral sandbox acceptance, or reconciliation-report contract | **15 / 100** |
| Whole repository production hygiene | Multiple tracked Python services contain mock, placeholder, simulated, or random-output behavior and are not verified as part of the deployed TypeScript application | **30 / 100** |
| **Conservative overall production readiness** | Weighted by the highest-risk deployment and real-money constraints | **55 / 100** |

## Verified Active-Path Controls

The active web application is backed by PostgreSQL and uses authenticated route procedures for disputes, profiles, settlement proofs, and administrative scheduling. The deployed health endpoint reported a connected PostgreSQL database, and the registered balance-proof Heartbeat was bound to durable configuration, executed with HTTP 201, and restored to its daily 02:00 UTC cadence. The current assurance run completed **188 passing tests with 2 intentionally skipped connectivity probes**, and the production build completed successfully.

The production Docker image copies only `package.json`, production `node_modules`, `dist`, and `infra` from the build stage. It does not include the repository’s legacy Python service directories. The two simulator modules in the active TypeScript server are explicitly test-only and reject production invocation; they do not provide fallback business or settlement behavior.

## Simulated, Test-Only, and Placeholder Inventory

| Location or feature | Classification | Production impact |
|---|---|---|
| `server/provider-sandbox-simulator.ts` | **Intentional test-only simulator**; refuses production/non-disabled execution | Does not establish provider acceptance and cannot authorize payment execution. |
| `server/emr-sandbox-simulator.ts` | **Intentional test-only encryption lifecycle simulator**; refuses production | Does not connect to an EMR or process clinical records. |
| `client/src/pages/DisputeOutcomeSimulator.tsx` | Legacy scenario/decision simulation | Removed from the production route and navigation surface; it is not an active deployed feature. |
| `ai-ml-dl-implementation/`, legacy top-level Python services, and several `backend/core-services` modules | Contains explicit mock, placeholder, random/simulated, or demonstration logic | Not part of the active TypeScript deployment evidence; cannot be represented as production services without separate integration, security review, test coverage, and removal/replacement of simulated logic. |
| Provider/FSP integration | No provider-issued certificate/key, provider sandbox endpoint, reconciliation report schema, or signed acceptance record | External release blocker. Real-money execution remains disabled. |

## Release Conditions

The active IDR web workflow can be considered for a restricted, non-money-moving operational pilot only after the new UI checkpoint is published and its route permissions are manually accepted in the deployment. A full production release requires closure of the provider/FSP gate, removal or isolation of unintegrated mock/simulated services from the release artifact, formal threat modeling and penetration testing, operational monitoring/alert runbooks, tested backup restoration in the deployed environment, and independent compliance/legal review.

> No score in this document is a guarantee of security, regulatory compliance, or loss prevention. The application remains fail closed for payment execution.
