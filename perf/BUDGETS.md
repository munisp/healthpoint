# Performance budgets — HealthPoint IDR

Budgets are enforced by k6 thresholds in `perf/*.js`. A threshold breach fails
the k6 run (non-zero exit), which is what `make perf` and any CI perf job rely on.

## Budgets

| Flow | Metric | Budget | Load shape |
| --- | --- | --- | --- |
| Reads (`ledger.history`, `ledger.balances`, `search.query`, authed probes) | p95 latency | **< 300 ms** | 50 RPS constant |
| Payment create (`ledger.recordPayment`) | p95 latency | **< 800 ms** | 50 RPS constant |
| Token acquisition (Keycloak direct grant) | p95 latency | < 500 ms | 10 RPS |
| All flows | error rate (`http_req_failed`) | **< 0.1%** | any |

Why the asymmetry: payment-create is a multi-statement DB transaction
(advisory lock → account upserts → idempotency read → entry insert → two
balance updates → dispute update → outbox insert) plus an outbox dispatch, so
it legitimately costs more than a read; 800 ms p95 still bounds user-visible
settlement latency. Reads should be single indexed queries — 300 ms p95 leaves
headroom for the Fuse.js fallback path.

## Suites

| Script | Flow |
| --- | --- |
| `perf/auth.js` | Keycloak token → authenticated `system.health` probe |
| `perf/payments.js` | `ledger.recordPayment` (unique idempotency key per iteration) → `ledger.history` poll |
| `perf/search.js` | `search.query` with rotating terms |

## Prerequisites

- `BASE_URL` pointing at an environment that is allowed to be load-tested
  (staging only — **never run against production**).
- `ACCESS_TOKEN` for `payments.js`/`search.js` (mint via the Keycloak token
  endpoint; `perf/auth.js` shows how).
- `LOAD_DISPUTE_ID` for `payments.js`: a dispute seeded at `STEP_14_PAYMENT_DETERMINATION`
  with a `determinationAmount` large enough to absorb the whole run
  (each iteration posts 1–101 cents; a 2-minute 50 RPS run posts ≤ ~$3,030, so
  `99999999.00` is ample). Seed via `scripts/seed.mjs` or SQL.
- k6 >= 0.50 installed (`brew install k6`, `go install go.k6.io/k6@latest`, or
  the official Docker image `grafana/k6 run -`).

## Capacity notes (assumptions behind the budgets)

- **PostgreSQL pool**: the app uses postgres-js with `max: 20` connections
  (`server/db.ts`). At 50 RPS with p95 < 800 ms, expected concurrent payment
  transactions ≈ 50 × 0.8 ≈ 40 worst case, so a payment burst can transiently
  saturate the pool; reads then queue behind it. If payment and read traffic
  share one deployment, keep payment RPS ≤ ~25 sustained or raise the pool and
  Postgres `max_connections` together (rule of thumb: pool ≤ 80% of
  `max_connections`, leaving room for the outbox worker, Temporal worker, and
  migrations).
- **Postgres instance**: budgets assume ≥ 2 vCPU / 4 GB, local NVMe, and
  `shared_buffers` ≈ 25% RAM. The ledger writes are `UPDATE ... SET balance =
  balance + X` on two hot rows per dispute — contention is per-dispute and
  serialized by `pg_advisory_xact_lock(hashtext(disputeId))`, so throughput
  scales with the number of *distinct* disputes, not rows.
- **Redis**: used for pub/sub fan-out, session cache, and distributed locks.
  Assumed ≥ 100k simple ops/s (any single-node Redis 7). Lock acquisition is
  per-dispute and off the payment hot path (workflow transitions only). Pub/sub
  delivery is fire-and-forget and non-authoritative.
- **Kafka**: the outbox dispatcher claims at most 25 events per batch per
  worker with exponential backoff (1 min → 1 h cap, 8 attempts → dead letter).
  At 50 payment RPS the outbox accrues ~3,000 events/min; one dispatcher loop
  draining 25/batch must run ≥ 2×/s to keep up — size worker count accordingly.
  Kafka producer throughput (≥ 10k msg/s/broker) is not the bottleneck; the DB
  claim/update round-trips are.
- **Search**: with `OPENSEARCH_URL` unset, search runs on the in-process
  Fuse.js index built from PostgreSQL; the 300 ms read budget assumes the
  in-process index. With OpenSearch, assume single-digit ms queries and the
  budget has ~30× headroom.

## Running

```bash
# via Makefile (wraps the three suites)
make perf BASE_URL=https://staging.example ACCESS_TOKEN=... LOAD_DISPUTE_ID=...

# or individually
k6 run perf/auth.js
k6 run -e BASE_URL=... -e ACCESS_TOKEN=... -e LOAD_DISPUTE_ID=... perf/payments.js
k6 run -e BASE_URL=... -e ACCESS_TOKEN=... perf/search.js

# smoke (10 s, 1 RPS) before a full run
k6 run -e RPS=1 -e DURATION=10s perf/payments.js
```
