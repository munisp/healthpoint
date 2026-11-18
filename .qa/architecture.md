# Architecture — healthpoint-idr

Evidence-based. Last updated 2026-10-02 during a live QA pass. Anything not
directly observed in code or a running instance is marked UNVERIFIED.

## What this system is

A federal No Surprises Act Independent Dispute Resolution (IDR) platform for
US healthcare claims billing disputes between providers/facilities and
payers. Core domain terms confirmed in code: disputes, QPA (Qualifying
Payment Amount), arbitrators, IDR entities, expert review, trading
partners/EDI.

## Topology

Single Node.js monolith (`healthpoint-idr`, package.json), NOT a
microservices architecture (see `../risks.md` — three ~1000-2000 line
Python "smoke/integration/regression/platform" test suites at the repo
root assume a 9-service topology on ports 8001-8009 that has never
existed; their "passing" result JSONs are not evidence of anything).

- Entry point: `server/_core/index.ts`, listens on one port (`PORT`,
  default 3000).
- API: tRPC v11 (`@trpc/server`), mounted at `/api/trpc`. Root router is
  `rootRouter` in `server/app-router.ts`, merging:
  - `server/routers.ts` (5879 lines — the original/core router, "owned by
    another workstream," ~40 top-level namespaces: system, auth,
    dashboard, disputes, arbitrators, drafts, qpa, notifications,
    documents, admin, ai, emr, stateLaws, expertReview, templates, leads,
    profiles, reports, audit, webhooks, predictions, docIntelligence,
    workflow, ledger, search, mojaloop, temporal, authz, lakehouse,
    comments, payerContacts, apiKeys, sla, bulkActions, csvImport,
    webhookReplay, emailPrefs, providerAcceptance, watchlist, + more past
    line 4541 not yet enumerated — UNVERIFIED beyond this list)
  - 14 satellite routers under `server/routers/*.ts` (idr-compliance,
    push-subscriptions, personas [payer/idre/orgs], patient-portal,
    idre-directory, fee-schedules, unsubscribe, submitter,
    submitter-billing, practice-audit, lakehouse-analytics, bulk-upload)
    plus `feature-flags.ts`, `impersonation.ts`, `auth/nppes.ts`,
    `auth/totp-admin.ts`.
- Client: Vite-built SPA (`client/`), served by the same server in dev.
- ORM: Drizzle, Postgres dialect. 55 migrations as of this pass.
- Auth: Keycloak session cookie + Bearer JWT (verified against realm
  JWKS) + `hp_`-prefixed API keys. See `server/_core/context.ts`,
  `server/_core/keycloak.ts`, `server/auth/bearer.ts`. CONFIRMED this is
  the real/only primary auth path — traced every branch of
  `createContext`.
- Authz: Zanzibar-style ReBAC. Real backend is Permify (gRPC/REST) when
  `PERMIFY_URL` is set; when unset, falls back to an equivalent
  in-process PostgreSQL implementation (`server/authz.ts`) — NOT a
  bypass, a real drop-in reimplementation of the same permission model.
  Central object-level authz (IDOR protection) enforced as tRPC
  middleware (`enforceObjectLevelAuthz` in `server/_core/trpc.ts`),
  consulting a path→checker registry (`server/authz-registry.ts`,
  UNVERIFIED in detail — not yet read).
- MFA: TOTP, enforced via `mfa-pending` session state + an allow-list of
  pre-MFA-safe procedures (`MFA_PENDING_ALLOWED_PATHS`).
- Impersonation: real feature, audited (`audit_log` action
  `impersonate.access`), with explicit guardrails against
  admin-impersonating-admin mutations and onboarding-state changes while
  impersonating (`server/_core/trpc.ts`).

## Dead / legacy code found

- `server/_core/sdk.ts`'s `OAuthService` (`webdev.v1.WebDevAuthPublicService`
  paths, "Manus Scheduled Task" naming) is leftover scaffolding from
  whatever platform originally generated this app. NOT in the real auth
  path. Only used by two scheduled-endpoint handlers
  (`settlementBalanceProof.ts`, `ledgerReconciliation.ts`'s HTTP-trigger
  path) for a legacy cron-identity branch — not the primary hourly
  internal reconciliation scheduler (`server/reconciliation-scheduler.ts`),
  which runs independently and correctly skips when `TB_LEDGER_ENABLED`
  is unset.

## Open questions (UNVERIFIED)

- Full procedure list for all ~40 namespaces in `server/routers.ts` —
  only namespace names confirmed, not individual procedures/roles per
  procedure.
- `server/authz-registry.ts` — the actual IDOR-check registry content.
- Whether `mojaloop` namespace in routers.ts relates to the mojaloop
  simulators/cluster seen elsewhere this session, or is unrelated.
