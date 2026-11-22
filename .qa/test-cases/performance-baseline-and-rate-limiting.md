# TEST-PERF-001 — Performance baseline & rate limiting (local)

**OBJECTIVE:** Section 37 (Performance Testing) was entirely untested
before this. Live load/stress testing against the production cluster
was out of scope (shared infra, other tenants) per standing practice
this whole pass, so this runs against the local dev server via
`autocannon`. Caveat up front: the local dev server is `tsx watch`
against a single unclustered Node process, not the production Docker
build — these numbers are a functional/regression baseline, not a
production capacity number.

## First run: accidentally load-tested the rate limiter instead
`autocannon -c 20` with no rate cap fired ~7,300 req/s at `auth.me`.
Result: 300 successful 2xx, then ~110,000 consecutive `429 Too Many
Requests`. Initially looked alarming; turned out to be the app's
IP-keyed rate limiter (`server/auth/ratelimit.ts`,
`RATE_LIMIT_API_MAX=300`/60s default) working exactly as configured —
300 successes is an exact match for the configured limit, not a crash
or an error. All of autocannon's connections share one IP
(`localhost`), so they correctly collapsed into one bucket.

**While investigating, confirmed a real production concern was already
correctly handled**: the limiter keys on `req.ip`, and in a reverse-proxy
deployment that would collapse every real user onto the gateway's one
IP unless Express's `trust proxy` setting is configured to read
`X-Forwarded-For` from the private hop. Checked `server/_core/index.ts`
line ~145: it IS configured (`trust proxy: "loopback, linklocal,
uniquelocal"`), with a comment showing the author already identified
and fixed this exact failure mode. The cluster's pod CIDR (`10.244.x.x`,
confirmed from live pod IPs throughout this pass) falls under the
trusted private range. Not a defect — verified already correct.

## Clean baseline (rate-limit bucket flushed, capped at 4 req/s — well under the 300/min limit)

| Endpoint | Requests | Success | p50 | p97.5 | p99 | Max |
|---|---|---|---|---|---|---|
| `auth.me` (session lookup) | 84 | 84/84 (100%) | 6ms | 13ms | 14ms | 17ms |
| `disputes.list` (DB read) | 84 | 84/84 (100%) | 8ms | 20ms | 24ms | 28ms |

Both clean: no errors, no timeouts, latency scales sensibly with the
heavier DB-reading endpoint costing a few ms more than the lighter
session-only one.

## RESULT: PASS. No functional regressions found under light sustained
load. Rate limiting is real, correctly configured for the actual
reverse-proxy topology, and was the (correct) cause of the first run's
apparent "failures." A genuine production capacity/stress test (sustained
high RPS against the real multi-replica deployment) remains out of
scope — this establishes a functional baseline, not a capacity number.
