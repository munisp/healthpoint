# Mission-Critical Assurance Audit — Working Notes

**Status:** Preliminary leads only. Each item requires direct repository and runtime verification before it may be reported as a finding.

| Surface | Lead requiring verification | Initial disposition |
|---|---|---|
| Funds flow | Payment sidecars, provider callbacks, transfer lifecycle, outbox, reconciliation, and reversal paths | Verify actual service registrations, provider contracts, failure behavior, and real-dependency coverage. |
| AI/EMR | Potential simulations, fallback responses, and untested Python service paths | Verify whether each path is reachable in production and retire or fail-close unsupported behavior. |
| Deployment | Non-PostgreSQL managed preview binding; scheduler and service health configuration | Treat as release blockers until a deployed PostgreSQL runtime and production scheduler execution are observed. |
| Security | Secrets, request authorization, callback mTLS, and credential encryption claims | Inspect direct implementation and test deny-by-default behavior. |
| Claims/tests | Checked task entries, legacy test scripts, and documentation assertions | Build a versioned manifest; never infer readiness from a checkmark or a passing narrow test. |

> No release decision has been made. The audit will distinguish direct evidence from unverified claims and external dependencies that cannot be exercised in the isolated environment.

## Directly Verified Findings

| ID | Severity | Evidence | Release impact |
|---|---|---|---|
| MC-001 | Critical | `docker-compose.yml` configures default credentials, Keycloak `start-dev` with `dev-mem`, disabled OpenSearch security, unauthenticated etcd, and plaintext/internal endpoints. | The compose topology is a development stack and is not suitable as a production deployment baseline. |
| MC-002 | Critical | `docker-compose.yml` configures `mojaloop-simulator` and passes its URL to both the Node application and Go sidecar. | Real funds initiation must remain disabled; a simulator cannot be evidence of regulated settlement execution. |
| MC-003 | High | `services/go/main.go` uses insecure gRPC credentials and localhost fallbacks for Permify, TigerBeetle, Kafka, and Mojaloop. | The Go sidecar cannot be considered production-secure without authenticated, encrypted service transport and mandatory configuration. |
| MC-004 | High | The managed preview logs show a non-PostgreSQL database binding, while the application now fail-closes unless `DATABASE_URL` is PostgreSQL. | Deployed database-backed behavior and production scheduler execution cannot be verified. |
| MC-005 | High | AI-service source includes local defaults and a documented fail-open `needs_review` confidence fallback; direct production-path and external-provider verification remain absent. | AI/EMR outputs cannot support a production-critical decision or release claim. |
