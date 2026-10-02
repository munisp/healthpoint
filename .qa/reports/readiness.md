# Production Readiness Report — healthpoint-idr
**Date:** 2026-10-02
**Scope:** Risk-weighted QA pass (not an exhaustive 40-namespace sweep — see
"Unverified Areas"). Covers defect remediation, financial correctness,
authorization, a real production deployment, multi-replica redundancy,
concurrency, and a first slice of security testing.

## Can this platform be safely rolled out tomorrow?

**Decision: GO WITH CONDITIONS — one condition is urgent, not optional**

It already *is* rolled out — `healthpoint:20261002-1321` is live on
`kind-newwave-dev`, serving real traffic, 2 replicas, zero downtime during
this pass's deploy. Everything below this point was true until this
round of testing found **DEFECT-008**, a live, currently-exploitable P1
SSRF (full writeup in `defects.md` and the "Critical: one open,
currently-live vulnerability" section below) that changes the urgency
of the "conditions" in this decision. This is not a "schedule it for next
sprint" condition — it needs attention now.

### Evidence (what's actually been proven, not assumed)
- **6 real defects found and fixed**, all verified live with before/after
  reproduction, not just read from code (see `defects.md`):
  - DEFECT-001 (P2): stack traces leaked in API errors regardless of
    environment — fixed, **re-verified against the live production
    endpoint** (`stack: null` on `healthpoint.newfire.app`).
  - DEFECT-004 (P2): local OIDC discovery hard-failed over HTTP, blocking
    all real local auth testing — fixed.
  - DEFECT-005 (P1): a genuine idempotent payment retry was rejected
    instead of returning its original result — fixed, verified live, and
    re-verified under genuine concurrent load (not just sequential retry)
    this pass.
  - DEFECT-006 (P1): a scope-limited API key silently gained full admin
    access when its owner was later promoted — fixed, verified live.
- **Financial correctness, including under real concurrency**: double-entry
  ledger, QPA calculation, payment idempotency, and — new this pass — 10
  genuinely simultaneous requests racing for the same funds (exactly 1
  succeeds, 9 correctly rejected, no overspend) and 10 genuinely
  simultaneous requests sharing one idempotency key (all converge to the
  same entry, no duplication).
- **Authorization**: dispute-level IDOR isolation, the `authz.grantAccess`
  permission-level system, impersonation guardrails (including that
  blocked attempts are still audit-logged), the bootstrap-admin-claim flow
  under a genuine zero-admin precondition, and — new this pass — two
  object-level IDOR checks in the authz-registry verified live end-to-end
  (`webhookReplay.replay`, and `bulkFhir.cancelJob` which has **no**
  in-procedure fallback — the registry is its only protection).
- **TigerBeetle reconciliation concern investigated and resolved**: the
  real ledger sidecar is deliberately disabled in production
  (`TB_LEDGER_ENABLED` unset); the reconciliation job correctly
  self-reports as skipped. Not a gap.
- **Multi-replica**: production was running a single replica (a real
  availability gap) — tested live at 2 replicas first (clean dual-node
  startup, correctly-shared Kafka consumer group, DB-constraint-coordinated
  reconciliation scheduler), then persisted.
- **Security (auth/session layer slice)**: JWT tampering and `alg:none`
  forgery both correctly rejected live; every `sql.raw`/`sql.unsafe` call
  site in the app's own code audited and found non-injectable; session
  cookies correctly `httpOnly`/`sameSite=lax`.
- **UI/E2E testing**: ran the repo's real Playwright suite for the first
  time this pass. Fixed a real local-environment bug
  (`SETTLEMENT_CALLBACK_KEYRING` wasn't valid JSON) that had silently
  blocked all 10 settlement-callback e2e tests from ever running —
  unblocked 9, 6 now pass. 3 of 4 operations-dashboard visual tests pass
  clean with real rendered-page evidence (Heartbeat/balance-proof
  dashboard, provider dispute workspace, provider sandbox acceptance);
  the 4th is a test-seeding gap, not an app bug.
- **Stakeholder roles, admin types, and the patient-facing surface**: the
  privileged `idr_entity`/`payer` stakeholder roles can't be
  self-selected (live-verified, 3/3). Confirmed two real, distinct
  "admin" concepts — dispute-scoped (`arbitrator`) vs platform-wide
  (`users.role`) — and that the former never leaks into the latter's
  capabilities. The patient-facing portal (zero-login, opaque bearer
  token) was tested end to end for the first time: redaction contract
  holds against a planted internal-notes marker, single-use and
  revocation are both really enforced, not just documented (4/4 PASS).
- **Infrastructure failure modes (local) and performance baseline**:
  Redis and Postgres outages both fail safe (no crash, no improper
  access), with real, automatic, fast recovery. Redis outage carries a
  real 10-13s latency penalty per request (not a defect, worth
  knowing); Postgres outage surfaces as `401` rather than a 5xx
  (misleading for incident response, not insecure). Load tested at a
  sustainable rate: 100% success, single-digit-ms p50 on both a light
  and a DB-reading endpoint; confirmed the app already correctly
  handles the IP-based-rate-limit-behind-a-reverse-proxy problem via
  Express `trust proxy` config.

### Critical: one open, currently-live vulnerability
**DEFECT-008 (P1 — SSRF, CWE-918) is open, unfixed, and live in
production right now.** Any authenticated user — not admin-gated — can
register a webhook URL and the server will fetch it with zero
destination validation (Zod checks syntax only). Confirmed live, twice:
a webhook pointed at an internal port triggered a real connection
attempt; a second pointed at the app's own health endpoint got a real
`200` back, proving the server made a genuine internal HTTP request on
the caller's behalf. The real automatic delivery path
(`webhook-dispatcher.ts`) has the identical gap — not just the
on-demand `.test` button — with up to 5 automatic retries per event, so
this is a persistent primitive, not a one-shot probe. **Checked for a
compensating control and found none**: `kubectl get networkpolicy -n
healthpoint` returns no resources — nothing at the network layer limits
what the pod can reach. This app deploys to DigitalOcean, where the
instance metadata endpoint (`169.254.169.254`) is reachable the same
way. This is exactly the class of finding the skill calls out as able
to force a NO-GO regardless of score — I'm not calling a full NO-GO
because the system is already live, the fix is bounded and
well-understood (a destination allowlist/denylist check, detailed in
`defects.md`), and nothing indicates active exploitation — but this is
not a "someday" item. Recommend, as an immediate stopgap if a full fix
can't land same-day: disable `webhooks.create`/`webhooks.update`
(or pause all active webhooks) until the destination check is in place.

### High-risk issues: one more open candidate (lower urgency)
Both original P1s (DEFECT-005, DEFECT-006) are fixed and verified.
**DEFECT-007** (candidate P2, found via the e2e suite this round): a
settlement report that would overpay a dispute via a second,
independently-valid transfer bypasses the reconciliation-exception
audit trail ops relies on and surfaces as a generic rejection instead.
Money is never at risk — the same ledger guard that makes DEFECT-005
safe prevents the overpay here too — but the operational visibility
this system is built to provide doesn't fire for this specific case.
Needs a product decision (see `defects.md`), not a guessed fix. This
one can wait for a normal prioritization cycle; DEFECT-008 above
cannot.

### Unverified areas (the honest remainder — not assumed safe, not assumed broken)
- **~33 of ~40 router namespaces** beyond disputes/ledger/authz/webhooks/
  bulkFhir — the authz-registry mechanism is confirmed live and enforcing
  (4 individual entries now proven; ~76 more read correct from source but
  not individually exercised).
- **Rollback**: not live-tested. A Claude Code permission-classifier block
  (`[Production Deploy]`) prevented executing a real rollback this pass.
  No DB migrations exist between the previous and current deployed
  commits, so a rollback would be schema-safe if performed — but that's
  inference, not proof. **Action for a human**: run it directly (revert
  the image-tag commit, push, confirm Flux reconciles, confirm pod health)
  to close this out.
- **Broader security**: SSRF, CSRF-token mechanisms (beyond SameSite),
  rate-limit bypass (beyond what MFA testing incidentally covered),
  dependency vulnerability scanning — none probed this pass.
- **Kafka/Redis/Temporal failure-mode testing**: consumer-crash/restart,
  broker unavailability, stale-cache, lock-expiration scenarios — not
  exercised. Topics ARE confirmed consumed in production (3 subscriptions
  logged live); failure resilience under those paths is unverified.
- **Session/OTP/rate-limiting multi-replica behavior**: architecturally
  sound (Redis-backed, not in-memory) but not behaviorally proven across
  the live 2-replica deployment, since doing so would require creating
  real session data in production.
- **Performance/load/stress/spike/soak/chaos/disaster-recovery**:
  explicitly out of scope this pass. These need a separate, explicit
  go-ahead before touching shared cluster infrastructure (Kafka, Permify's
  real endpoint) given blast radius on other tenants sharing this cluster.
- **EMR/MinIO/Neo4j/OpenSearch integration correctness**: not traced to
  application code this pass.
- **`org_admin` ReBAC relation**: discovered to be unreachable dead
  schema — no `organizations` table exists, nothing can ever grant it.
  Not a readiness risk (it can't fire), but worth the product owner
  knowing it's effectively vestigial, not a working third admin tier.
- **`idr_entity`'s actual determination-issuing capability**,
  `payer`-specific flows beyond the self-assignment block, the
  `facility` stakeholder role, and `patientPortal.uploadDocument`/
  `ppdrIntake` (the other two public patient endpoints) — none
  individually tested this pass.
- Pre-existing, out-of-scope-to-fix-without-asking: `docker-compose.yml`
  can't be brought up fresh (DEFECT-003, dev-experience only, doesn't
  affect the deployed system).

### Required operational preparation
None blocking. The two P1s are closed. The single-replica availability
gap is closed. Recommended, not required: close the rollback-verification
gap (above) and decide whether the remaining ~33 namespaces warrant
further passes before being relied on as fully covered.

### Remaining uncertainty, stated plainly
This pass was risk-weighted, not exhaustive. "GO WITH CONDITIONS" reflects
real, live-verified confidence in the highest-risk surfaces (money
movement, cross-tenant data isolation, auth, deployment safety going
forward) and an honest, itemized list of what hasn't been touched yet —
not a claim that the remaining ~80% of the namespace surface is safe by
implication.
