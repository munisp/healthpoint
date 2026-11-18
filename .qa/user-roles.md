# Users & Roles — healthpoint-idr

Discovered from `drizzle/schema.ts` + `server/authz.ts` + `server/_core/trpc.ts`.
Three independent, overlapping role systems — confirmed real, not inferred.

## 1. System role (`users.role`)
`roleEnum = ["user", "admin"]`. Coarse-grained. Checked directly in many
procedures (`role === "admin"`) and feeds `enforceObjectLevelAuthz`'s
subject (`role: user.role === "admin" ? "admin" : "user"`).

## 2. Stakeholder/business role (`user_profiles.stakeholderRole`)
`stakeholderRoleEnum = ["provider", "facility", "payer", "idr_entity", "other"]`.
Represents the party's real-world position in a billing dispute:
- `provider` — individual clinician/practice submitting a dispute
- `facility` — hospital/facility-level submitter
- `payer` — insurer, the counterparty
- `idr_entity` — the certified IDR/arbitration entity adjudicating
- `other` — catch-all (UNVERIFIED what this covers in practice)

## 3. Per-dispute relation (ReBAC, Zanzibar-style — `server/authz.ts`)
- `dispute#owner@user` — created the dispute
- `dispute#reviewer@user` — payer-side reviewer (read + write)
- `dispute#arbitrator@user` — IDR entity arbitrator (read + admin)
- `dispute#org_admin` — org admins (read + admin + delete)

## Other identity concepts confirmed in code
- **API keys** (`hp_`-prefixed) — scoped (`apiKeyScopes`), admin scope
  stripped for non-admin key owners (`context.ts`).
- **Impersonation** — an admin can act as another user via
  `x-impersonation-token`; audited; blocked from admin-mutations while
  impersonating another admin, and blocked from onboarding-state
  transitions for the target (MFA enrollment, invite accept, bootstrap
  admin claim, onboarding completion) — `server/_core/trpc.ts`.
- **MFA-pending** — a session state, not a role, but gates procedure
  access (`MFA_PENDING_ALLOWED_PATHS`).
- **Cron/scheduled identity** (`cron_`-prefixed openId) — legacy,
  depends on the dead `OAuthService` (see architecture.md). Only reached
  by two scheduled-endpoint handlers, not the primary scheduler.

## UNVERIFIED
- Whether `idre_entity` users get a genuinely separate UI/portal, or
  share the main app shell with role-gated views.
- Full list of role checks across all ~40 `routers.ts` namespaces — only
  spot-checked so far (admin checks are common; full audit pending).
- Patient-facing role, if any (`patient-portal` router exists —
  implies patients are a distinct, probably-unauthenticated-or-lightly-
  authenticated actor class not yet investigated).
