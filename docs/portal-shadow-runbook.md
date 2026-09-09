# Portal RPA Shadow-Mode Runbook (DRY_RUN)

Scope: the federal IDR portal RPA submitter (`server/idr/portal-rpa/`). This
runbook governs the shadow phase: `DRY_RUN=true`, `RPA_LIVE_ENABLED` unset or
false. Nothing here authorizes live submission.

## 1. Prerequisites (hard gates)

- [ ] **ToS counsel sign-off** — written confirmation that automated access to
      the federal IDR portal under our account complies with the portal Terms
      of Service; filed with compliance before the first shadow run.
- [ ] **login.gov account** provisioned for the service operator identity;
      **MFA enrolled per policy** (phishing-resistant factor where supported).
      Credentials live in the secrets manager only — never in env files,
      scripts, or logs.
- [ ] `PORTAL_MAP_VERSION` pinned; selector map hash recorded in the run log.
- [ ] Evidence-bundle output directory writable and access-controlled.
- [ ] `DRY_RUN=true` verified in the runtime environment (print effective
      config at startup; two-person verification).

## 2. Supervised first-run procedure

1. Operator + observer (two-person rule) start the submitter against **one**
   known-good test dispute with `DRY_RUN=true`.
2. Watch the session live (screen share or supervised VNC); confirm each step
   halts before any irreversible action (the dry-run barrier must intercept
   the final submit control).
3. Confirm the evidence bundle is written: step log, DOM snapshots, selector
   resolution traces, halt reason.
4. Confirm no network call carrying submission payloads left the dry-run
   barrier (proxy log review).
5. File the run record: date, operators, PORTAL_MAP_VERSION, dispute id,
   bundle hash.

## 3. Selector verification protocol

- Every selector starts **unverified**; the submitter must refuse to act on an
  unverified selector (fail-closed).
- To flip a selector to `verified: true`:
  1. Capture a DOM snapshot showing the selector resolves to exactly one
     intended element on the current portal build.
  2. Second operator confirms against the live page.
  3. Record selector, snapshot hash, verifier initials, date in the portal map.
  4. **Bump `PORTAL_MAP_VERSION`** and record the bump in the change log.
- Any portal UI change (detected drift, failed resolution, or announced portal
  release) reverts affected selectors to unverified; a run with unverified
  selectors on the critical path must abort.

## 4. Evidence-bundle review checklist (per run)

- [ ] Bundle complete: step log, snapshots, selector traces, config echo,
      PORTAL_MAP_VERSION, bundle hash.
- [ ] All resolved selectors were `verified` at run time.
- [ ] Dry-run barrier engaged at the submit step (no live POST).
- [ ] Data in the bundle matches the source dispute record (no mutation).
- [ ] Bundle retained per records policy; hash registered.

## 5. Go / No-Go criteria for RPA_LIVE_ENABLED

**Go** requires ALL of:
- N consecutive clean shadow runs (recommend N ≥ 10) across representative
  dispute types, with complete evidence bundles and zero selector reverts.
- Counsel sign-off current (reconfirm if portal ToS changed).
- CMS/portal operator communication completed where required.
- Live-mode rollback plan tested (kill switch + queue drain verified).
- Two-person approval recorded.

**No-Go** (any one):
- Any selector drift unresolved, any evidence gap, any dry-run barrier miss,
  counsel sign-off lapsed, or portal change without a reverified map.

When live: `RPA_LIVE_ENABLED=true` only in the production secrets manager;
`DRY_RUN` must be explicitly false; first live submission is supervised with
the same two-person rule.
