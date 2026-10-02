# server/notice-consent — NSA Notice & Consent module (45 CFR 149.410–450)

Balance-billing protections and the notice-and-consent exception for
out-of-network (OON) providers furnishing non-emergency services at
in-network facilities, under the No Surprises Act (45 CFR Part 149,
Subparts E–F).

## What ships now

- **Waiver eligibility** (`waiver.ts`): fail-closed evaluation of whether the
  notice-and-consent exception is available. NON_WAIVABLE categories are
  modeled explicitly: emergency services (149.410(b) — balance billing
  prohibited outright, no waiver ever), ancillary services (anesthesiology,
  pathology, radiology, neonatology, assistant surgeons, hospitalists,
  intensivists), diagnostic services (incl. radiology/lab), unforeseen urgent
  medical needs, and items/services from an OON provider when no in-network
  provider is available at the facility (149.410(c)(4)(iii), 149.420(b)).
  In-network providers are NON_WAIVABLE (the exception is OON-only).
- **Notice timing** (`waiver.ts` `validateNoticeTiming`): 72-hour rule when
  the appointment is scheduled >=72h before the service; day-of-scheduling
  notice plus >=3-hour consent lead time when scheduled within 72h
  (149.420(c)-(d)). Consent must follow notice.
- **Notice content** (`validateNoticeContent`): required-element checklist
  (OON statement, good-faith estimate, items/services list, consent-optional
  statement, in-network option statement, prior-authorization statement,
  cost-sharing disclaimer, plan contact info) per 149.420(c) and the HHS
  standard notice form.
- **Retention** (`retentionUntil`): 7-year document-retention window
  (26 CFR 54.9816-7).
- **Lifecycle FSM** (`fsm.ts`): NOTICE_REQUIRED → NOTICE_DELIVERED →
  CONSENT_SIGNED → SERVICE_RENDERED; CONSENT_REVOKED permitted any time
  before the service is furnished (149.420(f)); NOTICE_EXPIRED models the
  re-execution path when the service is rescheduled; WAIVED_IMPOSSIBLE is a
  terminal state for items found non-waivable (balance billing prohibited).
  Guards are fail-closed: incomplete notice content, non-waivable services,
  or non-compliant timing all block CONSENT_SIGNED and append guard-rejection
  events to an append-only log.

## What is BLOCKED / not in scope (honesty labels)

- **Exact notice wording**: the HHS standard notice-and-consent document
  templates must be sourced from current published versions (and OMB-approved
  forms) before production use; this module validates content *categories*,
  not verbatim text. STATIC-ONLY.
- **State-law interaction**: states with their own balance-billing laws may
  displace or supplement the federal exception; see
  `server/idr/state-programs/` for jurisdiction resolution. Not modeled here.
- **Air ambulance** (149.440–450): air-ambulance services are entirely
  outside the notice-and-consent exception; callers must not route air
  ambulance cases through this module.
- **Document storage**: retention computation is provided; actual document
  persistence/e-signature capture is out of scope.

All regulatory statements reflect 45 CFR 149.410–450 as published; verify
against current CFR text and HHS guidance before production reliance.
