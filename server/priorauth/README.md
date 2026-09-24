# server/priorauth — Prior Authorization workflow module (CMS-0057-F)

Provider-side prior authorization (PA) tracking and escalation support aligned
with the CMS Interoperability and Prior Authorization Final Rule (CMS-0057-F,
89 FR, finalized 2024-01-17, published 2024-02-08).

## What ships now

- **Decision clocks** (`clocks.ts`): computes CMS-0057-F decision deadlines —
  72 hours for expedited requests, 7 calendar days for standard requests — for
  impacted payers (MA organizations, state Medicaid FFS, Medicaid MCOs, CHIP
  FFS, CHIP managed care). QHP issuers on Federally-Facilitated Exchanges are
  modeled as NOT_SUBJECT to the timeframes (CMS-0062-P proposes to extend
  them; not final). Pre-2026-01-01 submissions are NOT_SUBJECT (operational
  provisions effective 2026-01-01). `isBreach` / `nextEscalationAt` support
  provider-side escalation tracking.
- **Lifecycle FSM** (`fsm.ts`): DRAFT → SUBMITTED → PENDED_INFO →
  APPROVED | DENIED → APPEAL_ROUTED → CLOSED; CANCELLED from DRAFT/SUBMITTED.
  Denial-reason capture is enforced fail-closed (non-empty reason required for
  impacted payers with submittedAt >= 2026-01-01). Clock breaches append
  events to an append-only log. Invalid transitions throw.
- **Appeal routing state** (`APPEAL_ROUTED`) is modeled as a lifecycle state
  only; actual appeal delivery integrations are out of scope.

## What is BLOCKED (honesty labels)

- **PAS submission** (`pas-adapter.ts`): Da Vinci PAS Bundle construction is
  implemented (STATIC-ONLY skeleton), but `submitViaPas()` returns
  `{ status: 'BLOCKED' }` unless `PA_API_2027_ENABLED=true` AND a payer
  endpoint is configured. CMS-0057-F Prior Authorization API compliance is
  generally required 2027-01-01 (managed care: rating periods on/after;
  QHPs: plan years on/after); payer endpoints are not expected before then.
  No network code path executes without configuration. Even when enabled, no
  transport is wired — only payload preparation.
- **PAS profile URL** must be re-verified against the current published
  Da Vinci PAS IG before go-live; IG/profile versions change between releases.

## Enforcement discretion

Some sources describe CMS enforcement discretion during 2026. This module
models it as the `enforcementDiscretion` configuration option (clocks and FSM)
— never hardcoded — so policy can change without code changes.

## Not in scope

- Payer-side metric reporting (payers' annual public PA metrics, first due
  2026-03-31, is a payer obligation; this module captures the underlying
  timestamps/reasons that providers need for tracking and appeals).
- CRD/DTR client integration.

All regulatory statements here reflect CMS-0057-F as published; verify against
the final rule text and subsequent CMS guidance before relying on deadlines in
production.
