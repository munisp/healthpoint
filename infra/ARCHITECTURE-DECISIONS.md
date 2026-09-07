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
