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

---

# TEST-CHAOS-002 — PostgreSQL unavailability (local)

**OBJECTIVE:** Same motivation as above, for the primary database
(section 13's "database crashes" / section 28's db-dependency testing).

## Setup
`docker stop healthpoint-test-postgres` while the dev server kept
running.

## Finding: fails safe, but mislabels the failure as client-side auth
- `auth.me` (optional-auth) returned `200` with `data: null` in ~10ms —
  `createContext`'s session resolution wraps the DB lookup in a
  catch-all that silently falls back to "no user" on ANY error,
  including a connection failure, not just an actually-missing/invalid
  cookie.
- `disputes.list` (a real `protectedProcedure`, genuinely authenticated
  session, valid cookie) returned **`401 UNAUTHORIZED`** in ~6ms. The
  session cookie was completely valid; the only thing wrong was the
  database being unreachable to resolve it. A real user hitting this
  during an actual outage sees the same response as "your session
  expired" — no signal that this is a system-wide failure, not
  something wrong with their login. This fails SAFE (no data leaked, no
  improper access granted) but fails UNINFORMATIVELY: ops watching
  error rates would see a spike in 401s, not 5xxs, during a database
  outage, which points incident response in the wrong direction.
- Not filing as a numbered defect — nothing is insecure, and
  distinguishing "unauthenticated" from "auth-system unavailable" is a
  genuine design choice some teams make deliberately (never reveal
  *why* auth failed) — but worth the repo owner knowing this is the
  current behavior, since it affects incident diagnosis time, not
  safety.

## Recovery — clean and fast
`docker start healthpoint-test-postgres` → first request after ~3s
startup returned correctly in **42ms**. No app restart needed, the
connection pool reconnects on its own.

## RESULT: PASS (safe), with one real observability finding (see above).
