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

## Next, in priority order (risk-weighted)
1. **Walk one dispute through its full IDR lifecycle** (open negotiation
   → IDR initiation → `idrEntityId` assignment → `submitOffer` both
   sides → `advanceStep` to determination) far enough to retest payment
   idempotency on the REAL money-moving admin/settlement-linked path —
   the one path not yet exercised. Bigger, multi-step setup; worth doing
   properly rather than rushing.
2. **Authz follow-ups** (see test-cases/authz-dispute-isolation.md's
   "Not yet tested"): granted-relation path (reviewer/arbitrator/
   org_admin actually working, not just the no-relation deny case),
   mutation-side authz (e.g. advanceStep on a dispute you don't own),
   the real bootstrap-admin-claim flow (bypassed via direct DB write
   this pass).
3. **Impersonation guardrails** — already has real blocking logic
   (admin-impersonating-admin, onboarding-state transitions); worth
   proving those specific denials actually fire, not just reading the code.
4. **MFA-pending gate** — confirm the allow-list is actually enforced
   (can a pre-MFA session call something NOT on
   `MFA_PENDING_ALLOWED_PATHS`?).
5. **API key scope stripping** — confirm a non-admin-owned `hp_` key
   genuinely cannot reach admin-only procedures even if the underlying
   user is later promoted.
6. Everything else (the remaining ~35 router namespaces, performance,
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
