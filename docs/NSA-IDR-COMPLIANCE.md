# NSA / Federal IDR Compliance Matrix

**Branch:** `assurance/remediation-2026-09-05` · **Status of this document:** documentation aid for engineering and compliance review. **This is not legal advice.** Regulatory citations are to the Code of Federal Regulations as implemented in the Federal IDR rules; fee amounts, batching parameters, and some deadlines have changed through rulemaking and litigation (e.g., *TMA v. HHS*) and are treated here as **configurable policy values**, never as constants "hardcoded as law."

**Legend:** ✅ Implemented · ⚙️ Configurable (mechanism implemented; value/policy set by configuration) · 🔄 Partial · 🏛️ External responsibility (not performable by this platform) · ❌ Gap

## 1. Lifecycle state machine (grounding)

19-step state machine in `server/workflow/idr-workflow.ts:40` (`IDR_WORKFLOW_STEPS`), persisted on `disputes.currentStep` (`drizzle/schema.ts:98`), with transition + required-field guards in `validateWorkflowTransition` (`idr-workflow.ts:243`) and `advanceWorkflow` (`idr-workflow.ts:270`). Main path: `STEP_01` open negotiation initiated → `STEP_02` ON period (30 BD) → `STEP_03` ON failed → `STEP_04` IDR initiated (4 BD) → `STEP_05` notice sent (3 BD) → `STEP_06` IDRE selection (3 BD) → `STEP_07` IDRE selected → `STEP_08` eligibility review → `STEP_09` offer submission (10 BD) → `STEP_10` QPA disclosure (5 BD) → `STEP_11` additional information (5 BD) → `STEP_12` arbitration review (30 BD) → `STEP_13` determination issued → `STEP_14` payment determination (30 calendar days) → `STEP_15` payment made → `STEP_16` admin fee paid → `STEP_17` closed (terminal); appeal branch `STEP_18 → STEP_19 → STEP_17`.

## 2. Federal IDR process obligations (45 CFR § 149.510 / PHSA § 2799A-1)

| Obligation | Citation | Implementation (file:line) | Status | Evidence |
|---|---|---|---|---|
| 30-business-day open negotiation period from initiation notice | § 149.510(b)(1) | Workflow `STEP_02` (`idr-workflow.ts:40`); deadline engine `computeIDRDeadlines` (`server/idr/deadlines.ts:285`); persisted ledger `idr_deadline_events` (`drizzle/schema-idr-compliance.ts`) | ✅ | `server/idr/deadlines.test.ts` — 30-BD holiday-stretch case (ON 2025-11-17 → 2025-12-31, verified independently) |
| IDR initiation within 4 business days after ON ends | § 149.510(b)(2)(i) | `computeIDRDeadlines` idrInitiation window; `disputes.idrInitiationDeadline` (`drizzle/schema.ts:98`) | ✅ | deadlines.test.ts window case (ON end 2025-12-31 → window 2026-01-02…01-07 across New Year holiday) |
| Complete/accurate information at initiation — party attestation | § 149.510(b)(2)(ii) | `attestations.attest` (`server/routers/idr-compliance.ts`), `validateNewAttestation` (`server/idr/attestations.ts`) | ✅ (portal's own attestation text: 🏛️) | `server/idr/attestations.test.ts` — affirmations, wrong-step, duplicate, supersede |
| Joint IDRE selection within 3 business days of IDR initiation | § 149.510(c)(1) | `STEP_06/07` guard requires `idrEntityId` (`idr-workflow.ts:243`); selection deadline in engine | ✅ | deadlines.test.ts 3-BD case (2026-02-17 → 02-20) |
| Random IDRE selection by the Departments when parties fail to agree | § 149.510(c)(1) | — | 🏛️ External | Occurs in the HHS federal IDR portal; platform records the resulting `idrEntityId` |
| Offer submission within 10 business days of IDRE selection | § 149.510(c)(3)(i) | Engine `offerSubmissionDeadline`; offers stored on `disputes.initiatingPartyOffer/respondingPartyOffer` | ✅ | deadlines.test.ts (2026-03-02 → 03-16) |
| Batching conditions (same/similar codes, same payer, caps) | § 149.510(c)(3) | `idr_fee_schedules.batchingMaxLineItems` + batched IDRE fee range columns | ⚙️ Configurable; batch **grouping model** ❌ Gap (no batched-dispute entity in schema — reported as `null` in exports) | fees.test.ts batched-range case; `_not_collected` in federal-reporting.ts |
| IDRE payment determination within 30 business days of selection | § 149.510(c)(4)(ii) | Engine `determinationDeadline`; `STEP_12` 30-BD default | ✅ | deadlines.test.ts (2026-03-02 → 2026-04-13) |
| Payment of determined amount within 30 calendar days | PHSA § 2799A-1(c)(6) | Engine `paymentDeadline` (calendar days); `disputes.paymentDeadline` set at STEP_14 (`server/db.ts`) | ✅ | deadlines.test.ts calendar-day case |
| Business-day calendar (weekends + federal holidays) | § 149.510(a)(2) (definition of business day) | `usFederalHolidays` (`deadlines.ts:174`) with observed-date shifts; extra closures configurable | ✅ + ⚙️ | deadlines.test.ts — 2026 holiday table, Saturday/Sunday observation, Dec 31 spillover |
| Deadline monitoring & escalation | Best practice / operational | Scheduled checker `server/scheduled/idrDeadlineCheck.ts:42`: T-5 BD, T-1 BD, overdue tiers; idempotent (per-tier sentAt + deterministic outbox keys) | ✅ (endpoint registration pending — see § 7) | `server/idr/deadline-tracking.test.ts` — 9 planner cases incl. dedupe/escalation |

## 3. Fee management (45 CFR § 149.510(d))

| Obligation | Citation | Implementation | Status | Evidence |
|---|---|---|---|---|
| Administrative fee per party, per determination, **non-refundable** | § 149.510(d)(1) | `fees.assessOnIdrInitiation` (one assessment per party); refund transition blocked for `administrative` fee type (`server/idr/fees.ts` transition guard) | ✅ mechanism · ⚙️ amount (env/admin-configured, effective-dated `idr_fee_schedules`) | fees.test.ts — idempotent per-party keys, non-refundable guard |
| Certified IDRE fee within published ranges (single/batched) | § 149.510(d)(2) | `fees.assessIdreFee` validates `withinPublishedRange` against schedule min/max | ✅ mechanism · ⚙️ ranges | fees.test.ts range validation cases |
| IDRE fee refund when dispute found ineligible | § 149.510(d)(2)(iv) | `paid → refunded` transition (IDRE fee types only) + `fees.updatePaymentStatus` audit event | ✅ | fees.test.ts transition matrix |
| Fee amounts set by annual HHS/Labor/Treasury guidance | § 149.510(d) | Amounts live ONLY in `idr_fee_schedules` (effective-dated) or `IDR_*_CENTS` env seed; **no fee amount is hardcoded as law** | ⚙️ | `buildEnvFeeSchedule` returns null when unconfigured (fails closed); notes cite rulemaking risk |
| Payment status tracking | Operational | `idr_fee_assessments.status` (assessed/invoiced/paid/waived/refunded/void) + timestamps + payment reference | ✅ | fees.test.ts transition matrix |

## 4. Attestation flow

| Obligation | Implementation | Status | Evidence |
|---|---|---|---|
| Party attests completeness/accuracy at IDR initiation (STEP_04–06) and offer submission (STEP_09) | `idr_attestations` table; `attestations.attest`; step-gating in `ATTESTATION_REQUIRED_STEPS` | ✅ | attestations.test.ts — 10 cases |
| Corrections preserve evidence (no deletes) | Supersede flow: old row → `superseded` with `supersededBy` link; `attestation.recorded`/`superseded` audit events | ✅ | attestations.test.ts re-attestation cases |
| Attribution | `attestedBy`, name, timestamp, IP, user-agent recorded | ✅ | router `attest` mutation |

## 5. Federal reporting exports

| Obligation | Implementation | Status | Evidence |
|---|---|---|---|
| Dispute-volume / determination summary for a period | `reporting.volumeSummaryCsv` (admin-only): counts by status & service type, median days-to-determination, prevailing-offer breakdown, fee totals | ✅ (export) · 🏛️ (actual submission to HHS portal) | federal-reporting.test.ts CSV/aggregation cases |
| Per-determination record (dispute type, items/services, offers, QPA, determination, IDRE, dates, fees) | `reporting.determinationRecord` → JSON grounded to `disputes`/`dispute_events`/`idr_fee_assessments`/`idr_entities` fields that exist | ✅ · uncollected fields emitted `null` and listed in `_not_collected` | federal-reporting.test.ts record cases |

## 6. HIPAA Security Rule mapping (existing repo mechanisms)

| Safeguard | Citation | Mechanism | Status |
|---|---|---|---|
| Access control | 45 CFR § 164.312(a)(1) | Keycloak OIDC authentication (`server/_core/keycloak.ts`), tRPC `protectedProcedure`, role/dispute authorization registry (`server/authz.ts:167`, `:291`) | ✅ |
| Audit controls | § 164.312(b) | `audit_log` (`drizzle/schema.ts:520`); durable `event_log` outbox (`:695`) with worker delivery (`server/outbox.ts:50`); compliance events for deadlines/fees/attestations (`server/idr/compliance-events.ts`) | ✅ |
| Integrity | § 164.312(c)(1) | Append-only `dispute_events` timeline (`drizzle/schema.ts:168`); supersede-not-delete attestations; outbox idempotency keys | ✅ |
| Person/entity authentication | § 164.312(d) | Keycloak sessions; scheduled-endpoint shared-secret auth (`scheduledAuth`, `server/_core/index.ts`) | ✅ |
| Transmission security | § 164.312(e)(1) | TLS termination at the edge (deployment); **enforced** `sslmode=verify-ca` + root cert for external Postgres in production (`server/_core/env.ts:66-67`); HSTS/CSP via helmet (`server/_core/index.ts:130`) | ✅ (edge TLS is deployment responsibility) |
| Encryption at rest | § 164.312(a)(2)(iv) (addressable) | Managed-Postgres volume encryption (infrastructure); AES-256-GCM for stored third-party credentials (`server/credential-crypto.ts`) | ⚙️ infra-level; credential crypto ✅ |
| Contingency plan / backups | § 164.308(a)(7) | `backup_service.py` + `server/backup-automation.test.ts` | ✅ mechanism; restore drills are operational 🏛️ |
| Risk analysis / workforce security / vendor mgmt | § 164.308(a)(1), (a)(3), (a)(4) | Process controls — outside code | 🏛️ Organizational responsibility |

## 7. Configurable policy values (with documented defaults)

All in `server/idr/deadlines.ts` (`getDeadlinePolicy`) and `server/idr/fees.ts` (`getFeeEnvConfig`); defaults cite the CFR section and are **subject to rulemaking change**:
`IDR_OPEN_NEGOTIATION_BUSINESS_DAYS=30`, `IDR_INITIATION_WINDOW_BUSINESS_DAYS=4`, `IDR_IDRE_SELECTION_BUSINESS_DAYS=3`, `IDR_OFFER_SUBMISSION_BUSINESS_DAYS=10`, `IDR_DETERMINATION_BUSINESS_DAYS=30`, `IDR_PAYMENT_CALENDAR_DAYS=30`, `IDR_BUSINESS_DAY_EXTRA_CLOSURES`, `IDR_USE_FEDERAL_HOLIDAYS`, `IDR_ADMIN_FEE_CENTS`, `IDR_IDRE_FEE_{SINGLE,BATCHED}_{MIN,MAX}_CENTS`, `IDR_BATCHING_MAX_LINE_ITEMS`, `IDR_FEE_SCHEDULE_EFFECTIVE_FROM`.

## 8. External responsibilities (not performable by this platform)

1. **HHS federal IDR portal**: initiating IDR, random IDRE selection on disagreement, official attestation presentation, and report submission all occur in the federal portal. This platform produces records/exports only.
2. **Fee amount publication**: the Departments set the administrative fee and IDRE fee ranges; the platform consumes them as configuration.
3. **Certified IDRE decisions**: the payment determination itself is made by the certified IDRE; the platform records outcomes.
4. **Organizational HIPAA safeguards** (risk analysis, training, BAAs) and edge TLS/infra encryption are deployment/organizational responsibilities.

## 9. Known gaps / suspected items (honest list)

1. ❌ **Batching group model** — no batched-dispute entity in the schema; only configurable caps and batched fee ranges exist. Exports report `batched: null`.
2. 🔄 **QPA methodology (45 CFR § 149.140)** — `qpaBenchmarks`/`qpaStateModifiers` tables (`drizzle/schema.ts:1688`) and `qpa_calculation_service.py` exist; the median-contracted-rate algorithm was not re-audited in this workstream and its TS-side integration is only partial (`disputes.qpaAmount`).
3. ⚠️ **Pre-existing deadline math** in `server/workflow/idr-workflow.ts`/`server/db.ts` (`addBusinessDays`) skips weekends only (no federal holidays); the new engine is holiday-aware but the legacy path still sets the `disputes.*Deadline` columns. Reconciling the legacy setters to call `server/idr/deadlines.ts` requires editing `db.ts`/`idr-workflow.ts`, which is outside this workstream's file ownership — recommended follow-up.
4. ⚠️ **Registration pending**: `idrComplianceRouter` and `POST /api/scheduled/idr-deadline-check` require the two one-line registrations in `server/routers/REGISTER-idr-compliance.md` (routers.ts ownership boundary).
5. ⚠️ **drizzle-kit visibility**: `drizzle.config.ts` points at `drizzle/schema.ts`; add `export * from "./schema-idr-compliance";` so future generated migrations see the compliance tables (migration 0028 already applies them).
6. ❓ **HHS reporting field set** — the per-determination JSON mirrors fields publicly known from federal IDR reporting guidance; the authoritative current data dictionary should be confirmed against the CMS portal documentation before relying on the export for submission.
