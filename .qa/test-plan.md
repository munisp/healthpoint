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

## In progress
- [ ] Wire a reachable Keycloak so real auth'd journeys can run (user
      confirmed one exists in its own `keycloak` namespace in-cluster).

## Next, in priority order (risk-weighted)
1. **Disputes + ledger + QPA calculation** (`routers.ts`'s `disputes`,
   `ledger`, `qpa` namespaces) — the core financial/regulatory workflow.
   Highest blast radius if wrong.
2. **Authz / IDOR** — exercise the ReBAC model for real with 2+ real
   logged-in users of different roles/relations: can a `payer` read a
   dispute they're not the `reviewer` on? Can a `provider` from org A
   read org B's dispute? This is the single highest-value test given a
   regulated, adversarial-party domain (providers and payers are
   literally on opposite sides of money).
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
