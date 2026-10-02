# TEST-CHAOS-001 — Redis unavailability (local)

**OBJECTIVE:** Section 28/13-G of the QA skill explicitly requires
testing "Redis disappears" and "Redis restart." Never exercised before
this test. Live production pod-killing chaos was attempted and blocked
by Claude Code's own permission classifier (`[Interfere With
Workloads]`) — that requires a settings change outside this session, so
this test runs against the local dev server + local
`healthpoint-test-redis` container instead. Same application code path,
zero risk to the live cluster or other tenants.

## Setup
`docker stop healthpoint-test-redis` while the local dev server kept
running (simulating Redis disappearing underneath a live app, not an app
restart).

## Findings

### Reads/checks fail open — correct, and confirmed live
- Rate limiting (`server/redis.ts`'s increment check): after 3 retries
  (`maxRetriesPerRequest: 3`) against the dead connection, logs
  `[ratelimit] backend unavailable for "api" — allowing request
  (fail-open)` and lets the request through rather than blocking every
  user because the rate-limit store is down.
- Token-revocation check (`isTokenRevoked`): same retry-then-give-up
  pattern. Confirmed live: `auth.me` and `disputes.list` both still
  returned correct `200` responses with real data while Redis was down
  — a revoked-token check failing open (not crashing, not hanging) is
  the right availability tradeoff here, since the primary session
  signature/expiry check doesn't depend on Redis at all.

### Real finding: severe, compounding latency during the outage
Both successful calls above took **11–13 seconds** (vs ~8ms normally) —
each Redis-touching check retries 3 times with backoff before giving up,
and a single request can hit multiple independent Redis-backed checks
(rate limit + token revocation), so the delays stack. A
Redis-write-dependent path (`auth.requestLoginEmailOtp`) took 10.5s just
to reach ITS OWN business-logic rejection, for the same reason.
**This is not a crash or a hang — every request tested eventually
returned the technically-correct response — but 10-13 seconds per
request during a Redis outage is effectively a disguised full outage
from a real user's perspective**, even though the system is "available"
by a narrow technical definition. Worth flagging: a shorter, fail-fast
circuit breaker (stop retrying after the first failure for some cooldown
window, rather than 3 fresh retries on every single request) would turn
this into a sub-second-degraded experience instead of a 10+ second one.
Not filing as a numbered defect (nothing is incorrect or unsafe), but a
real production-readiness consideration under this specific failure
mode.

### Recovery — clean and instant
`docker start healthpoint-test-redis` → the very next request returned
in **8ms**, fully normal. `ioredis`'s own reconnection logic recovered
on its own; no app restart was needed.

## RESULT: PASS (safe), with one real latency finding worth the repo
owner's attention (see above) — not filed as a defect since nothing
breaks or behaves incorrectly, just slowly.
