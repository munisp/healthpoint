# Audit Platform-Hardening Reconciliation Validation Summary

## Scope

This summary applies to the local reconciliation branch `reconcile/audit-platform-hardening`, based on remote commit `642b193bb131f1af7835426425a41c87088fb012`. The audited implementation was integrated into the remote repository’s `idr-workflow-demo/` application directory. Root-level Python, Go, and other remote-only assets were retained.

## Successful Local Validation

| Validation | Result | Boundary |
|---|---|---|
| Frozen nested dependency installation | Passed | `idr-workflow-demo/pnpm-lock.yaml` |
| Dependency audit | Passed with **0 critical** and **0 high** findings; 3 moderate findings remain reported | Local package registry audit; not a production approval |
| Strict TypeScript compilation | Passed | Local source validation |
| Full default Vitest suite | **29 files / 245 tests passed; 10 files / 11 tests skipped** | Skipped files are explicitly external-integration tests, not simulated passes |
| Production build | Passed | Local bundle/build validation |
| Migration journal validation | Passed; **44 checked-in migrations / 44 journal entries** | Static migration inventory |
| Clean PostgreSQL migration verification | Passed; **44 migration rows, 18 required tables, 7 required triggers** | Disposable local database only: `healthpoint_migration_test` |
| Durable Temporal drill audit test | Passed; **2 tests** including PostgreSQL persistence | Disposable local database only; payment execution remained disabled |

## CI Reconciliation

The root security workflow now executes Node dependency, type-check, test, and build commands in `idr-workflow-demo/`, using the nested lockfile for caching and installation. It adds a PostgreSQL service job that performs a clean migration verification and runs the durable Temporal audit persistence test with `RUN_POSTGRES_INTEGRATION_TESTS=true`.

The ordinary Node test job does not use database, message-bus, cache, authorization, TigerBeetle, or Temporal fallback implementations. External-integration tests remain explicitly skipped unless their required runtime environment is provisioned. The PostgreSQL migration and audit-persistence checks are now exercised in CI through a real PostgreSQL service.

## Remaining Evidence Boundary

> These results do **not** establish staging or production readiness. They do not prove real Keycloak, Permify, Redis, Kafka, Temporal, TigerBeetle mTLS/finality, CMS manual-portal operations, or governance/assurance evidence. Those controls remain subject to separately provisioned integration and external-evidence gates.

No branch was merged into `main` as part of this validation.
