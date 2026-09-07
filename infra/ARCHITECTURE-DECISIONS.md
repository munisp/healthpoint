# Architecture Decisions — Infrastructure Remediation (2026-09-05)

Records decisions from the 2026-09-05 infrastructure audit. These are
documented, not deleted: removal requires owner sign-off.

## ADR-001: Fluvio is decorative — recommend removal (PARKED)

**Status:** Removed from the dev compose stack on 2026-09-05; permanent
removal of any remaining Fluvio assets is parked pending owner sign-off.

**Finding (audit P1-15a):** The Fluvio cluster carried no application
traffic. The Rust services (`services/rust`) consume and produce via
rdkafka against Kafka directly (consumer groups `idr-rust-stream-processor`
and `idr-rust-event-handler`, producers to `idr.lakehouse.ingest`); the
former "fluvio processor" was a Kafka consumer/producer in disguise. Fluvio
was orphan infrastructure.

**Recommendation:** Do not reintroduce Fluvio. Kafka remains the single
event backbone.

## ADR-002: Mojaloop is simulator-only — recommend dropping the simulator (PARKED)

**Status:** Parked pending owner sign-off.

**Finding (audit P1-15b):** Only the `mojaloop/simulator` image runs, behind
the `simulation` compose profile; the production overlay disables it and
`PAYMENT_EXECUTION_MODE` defaults to `disabled` (fail-closed). The ILP
fields in the go-services Mojaloop connector
(`services/go/main.go`, `MojaloopService.InitiatePayment`) are placeholders —
no ILP packet/condition/fulfillment is computed; only FSPIOP-shaped headers
and bodies are produced.

**Recommendation:** Drop the simulator and keep the FSPIOP-shaped adapter
boundary in `services/go` so a real Mojaloop (or other FSPIOP) provider can
be wired in later without changing callers.

**Dependency note (verified 2026-09 via upstream sources):**
- The released Mojaloop Helm charts require MySQL for central-ledger — see
  the dependency table in <https://github.com/mojaloop/helm>
  (central-ledger charts pull in the `mysql` chart).
- central-ledger master is moving to Postgres-only: its README states
  Postgres is the supported database (`CLEDG_DATABASE_URI`, default
  `postgres://...`) — see <https://github.com/mojaloop/central-ledger>.

  If Mojaloop is ever adopted for real, prefer a central-ledger version
  whose chart supports Postgres so the platform does not inherit a second
  database engine; until then the adapter boundary keeps the option open.

## ADR-003: One WAF — Coraza at the edge; openappsec becomes an optional hop (ACCEPTED)

**Status:** Accepted and implemented 2026-09-05.

**Finding (audit P1):** The request path ran TWO web application firewalls
in series — Caddy's embedded Coraza (OWASP CRS) at the edge AND the
openappsec NGINX ML-WAF hop (`Caddy → openappsec:80 → apisix:9080`). Two
WAFs double the latency and false-positive surface, and their block pages /
rule-tuning workflows diverge, making incident response ambiguous about
which layer blocked a request.

**Decision:** Caddy keeps Coraza as the single, always-on WAF at the edge.
The default chain is now:

    Internet → Caddy (TLS + Coraza + rate limit + forward_auth) → APISIX → App

The openappsec ML-WAF agent is OPTIONAL:
- the `openappsec` compose service is gated behind the `waf-agent` profile
  and does not start by default (`docker compose --profile waf-agent up`
  to enable);
- `infra/caddy/Caddyfile` proxies directly to `apisix:9080`, with the
  previous `reverse_proxy openappsec:80` block preserved (commented) for
  users who want the ML-WAF hop — re-enabling requires both the profile
  and the Caddyfile swap.

**Consequences:** one WAF to tune and monitor; openappsec's `latest`-tagged
image no longer runs in the default topology (see the release-blocking
image-pinning note in docker-compose.yml). If ML-based detection is wanted
later, the hop can be reinstated without schema or route changes.
