# server/gfe-ppdr — Good Faith Estimate & Patient-Provider Dispute Resolution (45 CFR 149.610–620)

Good Faith Estimate (GFE) delivery obligations for uninsured/self-pay
individuals and the Patient-Provider Dispute Resolution (PPDR) process for
bills substantially in excess of the GFE, under the No Surprises Act
(45 CFR Part 149, Subpart G).

## What ships now

- **GFE delivery clocks** (`gfe-clock.ts`): 149.610(a)(2) deadlines computed
  in business days — 3 business days when the service is scheduled >=10
  business days out (or the GFE is requested without scheduling), 1 business
  day when scheduled 3–9 business days out. Services scheduled <3 business
  days out fail closed to delivery at scheduling time. Business-day math is
  Monday–Friday with a caller-supplied holiday calendar (never hardcoded —
  the federal holiday set changes by statute).
- **GFE content** (`validateGfeContent`): required content categories per
  149.610(b) (patient identifying info, itemized services with CPT/HCPCS/DRG
  codes, expected charges, provider/facility info, co-provider disclaimer,
  PPDR-process disclaimer, not-a-contract disclaimer).
- **Recurring-services GFEs** (`validateRecurringGfeWindow`): enforces the
  12-month maximum window for a single recurring-services GFE.
- **PPDR eligibility** (`ppdr.ts` `evaluatePpdrEligibility`): fail-closed
  evaluation of 149.620(b) — uninsured/self-pay only, billed charges exceed
  the GFE total by >= $400 (per provider/facility), dispute initiated within
  120 calendar days of the initial bill. Thresholds are exported constants.
- **PPDR FSM** (`ppdr.ts`): DRAFT → INITIATED → DOCS_PENDING → UNDER_REVIEW →
  DETERMINED → CLOSED, plus INELIGIBLE from any pre-determination state.
  Guards: INITIATED requires the administrative fee injected from current
  annual HHS guidance (no hardcoded default permitted) and passes the
  eligibility check; DETERMINED requires a certified PPDR entity ID and
  cannot leave the individual owing more than the GFE total (149.620(f));
  determinations are recorded as binding. INELIGIBLE is itself fail-closed —
  it refuses disputes that actually satisfy the criteria.

## What is BLOCKED / not in scope (honesty labels)

- **Administrative fee amount**: set by annual HHS guidance (e.g., $25 per
  dispute in recent guidance); MUST be injected per policy year — this module
  refuses to initiate without it. Verify the current amount before enabling.
- **PPDR entity certification roster**: `entityId` must reference the current
  HHS-certified PPDR entity list; no roster ships in this module. BLOCKED on
  authoritative roster data.
- **GFE document templates**: content categories are validated; verbatim HHS
  template text and OMB-approved forms must be sourced before production.
  STATIC-ONLY.
- **Co-provider GFE aggregation** (149.610 convening-provider/facility
  coordination duties): the co-provider disclaimer requirement is modeled in
  content validation; actual cross-entity estimate collection is not built.
- **Convening-provider obligations for insured individuals' GFE-AEOB flow**
  (149.610 applicability to the advanced EOB process): out of scope; that
  track is deferred pending final AEOB rulemaking.

All regulatory statements reflect 45 CFR 149.610–620 as published; verify
against current CFR text, HHS guidance, and the administrative-fee guidance
for the applicable year before production reliance.
