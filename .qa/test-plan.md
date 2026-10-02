# Test Plan — healthpoint-idr

Scoped realistically. The skill's full 64-section workflow is enormous;
this plan prioritizes by actual risk (financial correctness, authz,
tenant isolation) over uniform shallow coverage of all ~40 router
namespaces. Anything not listed here is deferred, not silently skipped —
see `risks.md`.

## Done
- [x] Baseline: vitest suite made fully runnable (was broken by a missing
      devDependency and a missing dotenv setup) — 1378/1393 passing, 1
      deliberately-unconfigured (kafka-connectivity, see infrastructure.md).
- [x] Discard/flag the fictional Python smoke/integration/regression
      suites as non-evidence.
- [x] Real dev server boots against real local Postgres/Redis.
- [x] DEFECT-001, DEFECT-002 fixed and regressed clean.
- [x] Architecture, infrastructure, role model mapped (this directory).
- [x] Wired a real local Keycloak (own container, importing the repo's
      `keycloak/realm-export.json`) — found and fixed 2 more real bugs
      to get there (DEFECT-004: OIDC discovery HTTPS-only block;
      missing default client scopes). See defects.md.
- [x] **Authz/IDOR dispute isolation** — `test-cases/authz-dispute-isolation.md`.
      3/3 real, executed sub-checks PASS: owner allowed, unrelated
      authenticated user denied (real FORBIDDEN, not a loose name
      match), admin bypass allowed. Also confirmed Keycloak realm roles
      are never auto-synced to app privilege (deliberate, good).

- [x] **QPA + ledger + idempotency** — `test-cases/ledger-qpa-financial.md`.
      QPA calculation confirmed real/differentiated (not stubbed).
      Double-entry ledger confirmed correct on dispute creation. Payment
      idempotency confirmed PERFECT on the non-admin/unverified path
      (duplicate key → same reportId, zero ledger movement either way).
      Admin/verified path blocked by a real state-machine guard
      ("payment-determination stage" required) — correct behavior, but
      means that path is still unverified; needs walking a dispute
      through its full lifecycle first (next item below).

- [x] **Real money-moving payment idempotency** — fast-forwarded the test
      dispute directly to STEP_14_PAYMENT_DETERMINATION via a DB write
      (the repo's own `payment-flow.test.ts` uses the identical fixture
      pattern, so this is consistent with existing practice, not a
      shortcut invented for this pass). Found and fixed a real P1 bug:
      DEFECT-005 — a genuine idempotent retry of a payment that had
      already fully covered the determination amount was rejected with
      a confusing error instead of returning its original result,
      because the balance check ran before the idempotency-key lookup.
      Fixed, verified live, zero regressions (1378/1393).

- [x] **MFA-pending gate** — confirmed live: an mfa-pending session calling
      a procedure NOT on `MFA_PENDING_ALLOWED_PATHS` (`disputes.list`)
      correctly gets `FORBIDDEN`/`mfa_required`.
      Along the way, built the email-OTP MFA feature the user asked for
      (TOTP was the only path before — see the `feat(auth)` commit) and
      verified IT end to end too: real delivery via Resend's SDK (routed
      through the AfroNG resend-simulator), single-use enforcement
      (old code rejected on a fresh mfa-pending session), and a
      per-user (not per-session) rate limit that correctly capped
      attempts across two separate login sessions.

- [x] **Authz follow-ups** — `test-cases/authz-dispute-isolation.md`
      UPDATE section. Real `authz.grantAccess` grant tested (not a DB
      shortcut): the exact same previously-denied user can read the
      dispute immediately after being granted `"read"`, and is
      correctly still denied `"write"`-level `disputes.advance` with
      only a `"read"` grant — permission levels are real, not binary.

- [x] **Impersonation guardrails** — `test-cases/impersonation-guardrails.md`.
      4/4 PASS: onboarding-state block fires regardless of target role;
      admin-impersonating-admin block is real AND target-role-specific
      (the same mutation succeeds when impersonating a non-admin); full
      audit trail confirmed in `audit_log`, including the blocked
      attempts (not just successful actions).

- [x] **API key scope stripping** — found and fixed a real P1:
      DEFECT-006. `adminProcedure` checked only the live `ctx.user.role`,
      never `ctx.apiKeyScopes` — so a key deliberately minted with
      `"read,write"` (admin correctly stripped at creation since the
      owner wasn't admin yet) silently gained full admin access the
      moment its owner was LATER promoted, with the key itself never
      reissued. Fixed: `adminProcedure` now also requires
      `ctx.apiKeyScopes.includes("admin")` when the request came via an
      API key. Verified live (before/after), confirmed no regression on
      legitimately admin-scoped keys. Full regression clean.

- [x] **Bootstrap-admin-claim flow** — `test-cases/bootstrap-admin-claim.md`.
      3/3 PASS, with a genuine zero-active-admin precondition (not
      bypassed this time): claim succeeds exactly once, audit-logged,
      correctly denied for a second user once an admin exists again.

- [x] **Authz-registry corrected + spot-checked** — earlier note calling
      it "inert" was wrong (see risks.md CORRECTED section): it has ~80
      real registered checkers covering most of the untested namespaces.
      Spot-checked one live: `reports.exportCSV`'s `adminOnlyCheck` —
      denied for a real non-admin, succeeds for a real admin. Mechanism
      confirmed genuinely active; most of its ~80 individual entries are
      still unverified beyond this one.

## Next, in priority order (risk-weighted)
1. Everything else (the remaining ~35 router namespaces, performance,
   chaos, DR, deployment/rollback) — explicitly deferred. Chaos/load
   testing in particular should NOT target shared cluster infra
   (Kafka, Permify's real endpoint) without a separate, explicit go-ahead
   given blast radius on other tenants.

## Explicitly out of scope for now
- Load/stress/soak/chaos testing against any shared cluster component.
- Disaster recovery / backup-restore proof (no backup mechanism
  identified yet for this app specifically).
- Full procedure-by-procedure role matrix across all 40 namespaces —
  would take many more hours; doing the top 2-3 highest-risk domains
  properly is worth more than a shallow pass over all of them.
