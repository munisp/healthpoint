# Configured External Resource Release-Gate Map

## Scope

This map distinguishes **configured and tested infrastructure transport** from the separate evidence required to certify a deployed production workflow and a regulated real-money settlement rail. It records only evidence that is presently available in this workspace.

| Configured resource | Verified safe capability | Release gate it supports | Evidence still required to close the gate |
|---|---|---|---|
| Managed PostgreSQL | Direct TLS connection, schema with 63 public tables, and application health query were previously verified | `MC-POSTGRES-RUNTIME` | The deployed HealthPoint runtime must bind this PostgreSQL URI (rather than the platform preview database) and expose an observed health check against that binding. |
| Redis | Authenticated PING and production URL configuration | Workflow concurrency and cache transport; supports `MC-COMPOSE-PRODUCTION` | Must be deployed in the hardened overlay and observed together with the production application. |
| Kafka | SASL_SSL metadata check with CA verification | Durable outbox/event transport; supports `MC-COMPOSE-PRODUCTION` | Production broker, ACLs, consumer group, and delivery monitoring must be observed from the deployed overlay. |
| Permify | Strict CA-verified bearer health check | Authorization infrastructure; supports `MC-COMPOSE-PRODUCTION` | Deployed policy model, relationship synchronization, and authorization decisions must be observed in the production overlay. |
| Temporal | TLS certificate chain verification | Durable workflow transport; supports `MC-COMPOSE-PRODUCTION` and scheduled operations | Authenticated gRPC workflow client, namespace, worker, and execution history must be observed in the deployed application. |
| TigerBeetle | CA- and hostname-verified mTLS tunnel with read-only `lookupAccounts` | High-throughput ledger transport; supports `MC-COMPOSE-PRODUCTION` | Deployed proxy, production account model, access policy, and non-financial interoperability evidence must be observed. |
| Settlement callback controls | HMAC callback and provider-report reconciliation tests | `MC-SETTLEMENT-EVIDENCE` | This claim is already verified for isolated test evidence; it does not establish a regulated provider transfer rail. |

## Gate Conclusion

The configured resources satisfy transport- and authentication-level acceptance checks for Redis, Kafka, Permify, Temporal TLS, TigerBeetle read connectivity, and the direct managed PostgreSQL endpoint. On 2026-08-16, a strict-CA PostgreSQL query to the managed endpoint verified PostgreSQL 18.6 and 63 public schema tables without mutation. They do **not**, by themselves, prove that the deployed runtime is using the managed PostgreSQL binding, that a regulated provider has accepted the settlement interface, that the production scheduler has executed daily proofs, or that the complete production overlay interoperates as one deployed system. The release gate therefore remains fail closed until those deployment and provider observations are available.

## Operator-Only Control Plane Boundary

HealthPoint uses only data-plane credentials required by its application processes. Vault root credentials, APISIX administrative credentials, database superuser/root credentials, and other control-plane identities are intentionally excluded from runtime configuration. They remain operator-only controls and are not accepted by the application deployment contract.
