# Infrastructure Inventory & Usage Verification — healthpoint-idr

Evidence-based, 2026-10-02. Per the skill: never assume a component is
used because it's deployed. Status reflects what was actually confirmed
this pass, in THIS local dev environment, not the real cluster.

| Component | In docker-compose.yml | Wired in local dev (this pass) | Actually invoked by app code | Notes |
|---|---|---|---|---|
| PostgreSQL 16 | Yes | **Yes** — standalone container, migrations applied | Yes — primary datastore, confirmed via `[Database] Connected` | `docker-compose.yml`'s own init.sql requires the `pgaudit` extension, which plain `postgres:16-alpine` doesn't ship — **pre-existing bug in the local dev stack**, unrelated to this app; worked around by running postgres standalone and applying only Drizzle migrations (init.sql's extensions/permify-schema/replication settings were skipped). Not yet fixed in the repo. |
| Redis 7 | Yes | **Yes** — standalone container | Yes, confirmed `[Redis] Connected` | compose's own redis service isn't published to the host directly (only `expose: 6379`, reached via Caddy mTLS on 6380 in the real stack) — ran a separate plain redis container instead for this pass. |
| Kafka (SASL_SSL) | No (uses shared `mojaloop-kafka-cluster` in the real k8s cluster) | No — deliberately left unconfigured | Confirmed invoked (event bus) when configured — wiring real creds flipped `server/events/bus.publish.test.ts` from an in-memory stub to the real shared cluster, which doesn't host this app's expected topics. Reverted. | Real creds exist (`external-client` secret, `kafka` ns) and work for the standalone `kafka-connectivity.test.ts`, but the app's event-bus topics aren't provisioned on that shared cluster — provisioning them is out of scope (shared, multi-tenant cluster). |
| Temporal | Yes (compose) | No local instance; `@temporalio/testing`'s TestWorkflowEnvironment used instead | Yes — `server/temporal/*` workflows, confirmed via real (if time-skipping) workflow execution in tests | Two workflow test files (`journeys.test.ts`, `lakehouse.test.ts`) now pass for real after fixing the missing `@temporalio/testing` devDependency. |
| Permify | Yes (compose) | No — real external endpoint used instead for the connectivity test only | Optional — real authz backend when `PERMIFY_URL` set; app has a full equivalent Postgres fallback otherwise (see architecture.md) | `permify-connectivity.test.ts` passes against the real cluster endpoint (173.66.76.192:32049). App itself (dev server) still runs with `PERMIFY_URL` unset → uses the Postgres fallback. |
| Keycloak | Yes (compose) | **Not yet wired** | Yes — the real, primary auth mechanism (confirmed by tracing `createContext`) | `.env` already has `KEYCLOAK_URL=http://localhost:8080` etc. but nothing is listening there. User confirmed a real Keycloak exists in its own `keycloak` namespace in the cluster — next step. |
| TigerBeetle | Yes (compose) | No | Guarded by `TB_LEDGER_ENABLED` feature flag; code confirms it fails safe (skips, doesn't crash) when disabled | `server/reconciliation.ts`'s hourly scheduler correctly no-ops with status `skipped` when the flag is off — not a bug. |
| MinIO | Yes (compose) | No | UNVERIFIED — not yet traced to specific app code paths | |
| Neo4j | Yes (compose), optional/commented profile | No | UNVERIFIED — comment in compose says it's a no-op unless `NEO4J_URI` is set | Low priority. |
| OpenSearch | Yes (compose) | No | UNVERIFIED | `lakehouse-analytics` router name suggests it may be the search backend; not confirmed. |
| EMR integration | — | No | Yes — `EMR_CREDENTIALS_ENCRYPTION_KEY` is a hard production-startup requirement (fail-closed, confirmed live) | External EMR system integration exists; not explored further this pass. |

## Pre-existing bugs found in infrastructure config (not yet fixed)

1. **`docker-compose.yml`'s `minio-init` service has invalid YAML**
   (`command: |` multi-line block scalar combined with a custom
   `entrypoint: ["/bin/sh", "-c"]` — this Compose version rejects it:
   `'services[minio-init].command' invalid command line string`). Blocks
   parsing the **entire** compose file, meaning nobody can
   `docker compose up` any subset of this stack fresh without hitting it.
   Worked around by running services standalone instead of via compose.
2. **`init.sql` requires `pgaudit`**, unavailable on `postgres:16-alpine`.
   Same category as #1 — the documented "Development and Integration
   Stack" cannot actually be brought up as documented on a fresh clone.

Both are real, reproducible, and would block any new engineer trying to
follow this repo's own `docker-compose.yml` from scratch. Not fixed yet —
flagged in `../risks.md`, deferred pending a decision on whether to patch
`docker-compose.yml` (shared, not something to change without being asked).
