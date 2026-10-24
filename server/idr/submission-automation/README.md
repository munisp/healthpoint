# IDR Submission Automation (assisted-manual)

## Why assisted-manual is the conformant ceiling

CMS operates **no public submission API** for the federal No Surprises Act
Independent Dispute Resolution (IDR) process. The real federal IDR channel is
a **Salesforce-based portal at idr.cms.gov** that is **human-driven**: dispute
initiation, offer submission, and determination retrieval are performed by a
person through the portal UI. Any software claiming to submit to
`idr.cms.gov/api/v1` (or any REST endpoint) targets a fictional interface.

Therefore the conformant ceiling for automation is **assisted-manual**:

1. `package-builder.ts` validates completeness against the IDR initiation data
   elements of 45 CFR 149.510(b) and emits a flattened, copy-ready
   `portalFields` map for a human to enter into the portal.
2. `submission-fsm.ts` tracks the lifecycle and **requires a human attestation
   payload** (`{ actorId, attestedAt, portalConfirmationText? }`) for the
   `SUBMITTED` transition — the model is honest: the software never submits
   anything itself.
3. `feedback.ts` ingests certified determinations, computes the 30-calendar-day
   payment due date, and records win-rate telemetry.

## Audit finding — legacy Python service deprecation mapping

`backend/integration-services/cms-portal-automation-service/main.py` is
**DEPRECATED** (containment-only, 25-item cap). Its core assumption — a REST
API at `idr.cms.gov/api/v1` — is an **audit finding: fabricated endpoint**. No
such API exists.

| Legacy Python behavior (fictional) | Replacement here (real) |
|---|---|
| POST dispute JSON to `idr.cms.gov/api/v1/disputes` | `package-builder.buildSubmissionPackage()` → copy-ready `portalFields`; human enters into idr.cms.gov |
| Poll `GET .../disputes/{id}/status` | `submission-fsm.transition()` driven by human-recorded portal outcomes; `ACKNOWLEDGED` requires a real `cmsDisputeReferenceNumber` |
| Batch up to 25 items per "API submission" | No cap: package is per-dispute, portal entry is human-paced |
| Determination webhook | `feedback.recordDetermination()` from the certified determination notice; `remittanceReconciliation()` BLOCKED until 2027-01-01 (CMS-9897-F CARC/RARC data elements) |

## Honesty labels

- `package-builder.ts` — EXECUTABLE, local-only; produces a package, transmits nothing.
- `submission-fsm.ts` — EXECUTABLE, local-only; fail-closed guard table; SUBMITTED requires human attestation.
- `feedback.recordDetermination` — EXECUTABLE, local-only; pure calendar math (+30 days), no holiday logic.
- `feedback.remittanceReconciliation` — STATIC-ONLY/BLOCKED until 2027-01-01 and `REMITTANCE_2027_ENABLED=true`.
- No file in this directory performs network I/O.
