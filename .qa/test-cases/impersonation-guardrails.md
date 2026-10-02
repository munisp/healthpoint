# TEST-IMP-001 — Impersonation guardrails and audit trail

**OBJECTIVE:** Confirm the impersonation feature's documented guardrails
(`server/_core/trpc.ts`'s `auditImpersonatedRequest` middleware) actually
fire, not just that the code reads correctly.
**ENVIRONMENT:** Real server/DB/Keycloak sessions, no mocks. Two real
promoted admins (`platform-admin`, `test-idr-entity`) to exercise the
admin-impersonating-admin path for real.

## Results — 4/4 PASS

1. **Onboarding-state block fires regardless of target's role.**
   `platform-admin` impersonated `test-provider` (non-admin) and
   attempted `totp.setup` (one of the explicitly blocked onboarding-state
   paths). **DENIED**: `onboarding_state_blocked_during_impersonation`.
2. **Admin-impersonating-admin block is real and target-role-specific.**
   Promoted a second user (`test-idr-entity`) to admin. As that admin,
   impersonated `platform-admin` (also admin) and attempted
   `admin.updateUserRole` — a real privilege-escalation-relevant mutation.
   **DENIED**: `"Admin mutations are blocked while impersonating another admin"`.
3. **The block is target-specific, not "block all admin mutations during
   impersonation."** The SAME mutation (`admin.updateUserRole`), while
   `platform-admin` impersonated `test-provider` (a non-admin target),
   **SUCCEEDED** normally. Confirms the guardrail correctly checks the
   impersonation TARGET's role, not a blanket impersonation-mode lockout.
4. **Audit trail is complete, including blocked attempts.** Queried
   `audit_log` directly: all 5 expected rows present — both
   `impersonate.start` entries, and `impersonate.access` entries for
   ALL THREE attempted actions (`totp.setup`, and `admin.updateUserRole`
   twice) — including the two that were ultimately BLOCKED. The audit
   write happens before the guardrail check runs, so even a failed
   impersonation-abuse attempt leaves a record, not just successful
   actions. Good property, not a defect.

## RESULT: PASS (4/4)
No defects found. Impersonation guardrails work exactly as documented
and intended.

## Not yet tested (follow-up)
- The off-channel alert / notification side of impersonation (if any) —
  only the audit_log + blocking behavior were checked.
- Impersonation session expiry (15 min hard cap per `IMPERSONATION_TTL_MS`)
  — not waited out live this pass.
