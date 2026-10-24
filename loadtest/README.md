# HealthPoint IDR — load-test harness

k6 scripts for the dispute and settlement hot paths, exercised **through the
gateway** (Caddy → APISIX → app / ml-service) so numbers reflect the real
request path including WAF and auth.

## Honest status

**No TPS numbers exist for this stack yet.** This harness was added in the
2026-09-05 audit (P2) but has NOT been executed against a deployed
environment. Any throughput figure quoted before these scripts are run end
to end is fabricated — do not cite one. `targets.md` lists vendor-claimed
per-component ceilings only; they are not measurements of this platform.

## Files

- `k6-disputes.js` — dispute create + advance (tRPC via gateway) plus
  `/api/ml/fraud/score` on the ML serving upstream.
- `k6-settlement.js` — settlement intent endpoints.
- `targets.md` — vendor-claimed theoretical ceilings per component, with
  citations, for sanity-checking measured results.

## Prerequisites

- [k6](https://k6.io/docs/get-started/installation/) installed.
- The compose stack (or a staging deployment) up and healthy:
  `docker compose up -d` (plus `--profile ml-tracking` / `--profile graph`
  only if you are testing those paths).
- A valid Keycloak access token for a test principal (client-credentials or
  password grant against the `healthpoint` realm).

## Environment variables

| Variable      | Default                          | Meaning |
| ------------- | -------------------------------- | ------- |
| `BASE_URL`    | `https://localhost`              | Gateway base URL (no trailing slash) |
| `AUTH_TOKEN`  | *(empty — requests fail 401)*    | Bearer token injected as `Authorization` |
| `VUS`         | `10`                             | Virtual users |
| `DURATION`    | `30s`                            | Test duration |
| `TENANT_ID`   | `loadtest-tenant`                | Tenant header value |
| `INSECURE_TLS`| `true`                           | Set `false` to enforce valid TLS certs |

## Running

```sh
AUTH_TOKEN="$(get-token.sh)" \
BASE_URL=https://staging.healthpoint.example.com \
k6 run loadtest/k6-disputes.js

k6 run --vus 50 --duration 5m loadtest/k6-settlement.js
```

For the local self-signed stack, pass `--insecure-skip-tls-verify` to k6 (or
keep `INSECURE_TLS=true`, which the scripts honor via `tlsAuth`/options).

## What to measure

Record, per run, into a results log (date, git SHA, VUs, duration,
environment):

- **Throughput**: `http_reqs` rate per scenario (disputes create, dispute
  advance, fraud score, settlement intent).
- **Latency**: p50 / p95 / p99 of `http_req_duration` per tagged endpoint
  (tags are set in the scripts: `endpoint=...`).
- **Error rate**: `http_req_failed` rate; non-2xx counts by status.
- **Saturation signals** (from the stack, not k6): Postgres
  `pg_stat_activity` counts / lock waits, Kafka consumer lag on
  `idr.disputes`, Redis `used_memory`, ml-service CPU.
- Compare against `targets.md` ceilings to identify which component
  saturates first.

## Guardrails

- Run against **staging/dev only**. The dispute-create path writes real rows
  and emits Kafka events; point at a disposable database/tenant.
- Settlement endpoints are fail-closed (`PAYMENT_EXECUTION_MODE=disabled`)
  in the dev topology — expect 4xx/5xx there unless execution is explicitly
  enabled in a test environment. That is the correct behavior; record it as
  such rather than treating it as a harness bug.
