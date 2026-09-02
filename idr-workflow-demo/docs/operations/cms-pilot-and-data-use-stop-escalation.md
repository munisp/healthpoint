# CMS Pilot and Governed Data-Use Stop/Escalation Controls

**Status:** Release-control specification.
**Scope:** Human CMS portal pilots and Georgetown model-validation data.
**Non-negotiable rule:** HealthPoint does **not** automatically submit a notice to a CMS portal. A human operator completes permitted portal work and records the resulting evidence. No model validation or live governed outcome may use data without an active, purpose-bound approval.

> A `proceed` decision is limited authorization for the stated scope. It is not a certification, a legal conclusion, a general data license, or a release approval. Any missing, expired, revoked, unverifiable, or out-of-scope approval means **hold** or **abort**.

## CMS pilot stop and escalation rules

| Decision point | Required evidence/control | Stop condition | Immediate system/operational action | Escalation owner | Resolution required to proceed |
|---|---|---|---|---|---|
| Before a handoff package is prepared | Approved CMS pilot authorization; active scope; named operator; training hash; SOP hash; escalation owner; `status=approved`; `stopDecision=proceed`; future expiry. | Authorization is missing, not approved, held, aborted, expired, revoked, or assigned to a different operator. | Do not create a portal-submission task. Keep the dispute in a preparation/review state. Do not claim CMS submission. | CMS operations lead; compliance lead. | New or reapproved authorization record with current evidence hashes and an approved scope. |
| Before portal entry | Dispute material has completed required document/governance review; operator confirms scope and deadline; handoff payload hash is fixed. | Material is incomplete, altered after review, outside the pilot scope, or deadline/eligibility is uncertain. | Stop portal entry; preserve the draft and raise a dispute escalation. | CMS operations lead; IDR/legal owner. | Corrected immutable bundle, approval of any scope change, and renewed human review. |
| During human portal operation | Human operator follows approved SOP and records a redacted evidence reference. | Portal outage, access failure, unclear instruction, attempted automation, or an unexpected portal workflow. | Stop the task; record an operational event. Do not retry through software or use an unapproved API. | CMS operations lead; security if credentials/session are implicated. | Updated SOP, confirmed access, and an approved manual retry plan. |
| Receipt recording | Receipt reference, receipt SHA-256, operator identity, timestamp, and payload/dispute binding. | Receipt cannot be captured, receipt hash is invalid, reference conflicts with a prior receipt, or receipt cannot be linked to the handoff record. | Mark the handoff unreconciled; do not mark the dispute as submitted/acknowledged. | CMS operations lead; compliance reviewer. | Verified replacement evidence or a documented human reconciliation disposition. |
| Feedback/notice intake | Cryptographically verified gateway record **or** approved manual-verification procedure with provenance, timestamp, duplicate detection, and audit linkage. | Feedback provenance/signature/timestamp is unverified, duplicate handling fails, event/dispute reference conflicts, or workflow state cannot be reconciled. | Quarantine feedback; prevent downstream workflow advancement. | Security lead; CMS operations lead; IDR owner. | Verified feedback record, duplicate disposition, and audit-approved reconciliation. |
| Pilot closeout | Receipt/feedback reconciliation, operator sign-off, limitation statement, and evidence manifest. | Any open discrepancy, unprocessed feedback, missing drill result, or unresolved security/legal finding. | Pilot remains **hold**; claim remains blocked. | Program sponsor. | Written resolution, revised evidence bundle, and independent review. |

### CMS escalation timing

| Severity | Example | Response target | Mandatory notification | Release effect |
|---|---|---:|---|---|
| Critical | Unapproved submission attempt; suspected credential/session misuse; receipt/feedback integrity failure affecting a dispute. | Immediately; halt the affected pilot task. | CMS operations, security, compliance, executive sponsor. | Blocks CMS pilot and any CMS-related release claim. |
| High | Portal outage around filing deadline; material scope mismatch; receipt unavailable after operator completion. | Same business day. | CMS operations and IDR/legal owner. | Holds affected handoff until reconciled. |
| Medium | Training/SOP evidence expires; non-critical metadata is incomplete. | Two business days. | CMS operations lead and compliance lead. | No new pilot action until corrected. |
| Low | Non-substantive documentation formatting defect. | Five business days. | CMS operations lead. | Does not advance a claim until corrected. |

## Governed data-use stop and escalation rules

| Decision point | Required evidence/control | Stop condition | Immediate system/operational action | Escalation owner | Resolution required to proceed |
|---|---|---|---|---|---|
| Before data access or validation | A durable `model_data_use_approvals` record and external approval record; approved purpose is exactly `model_validation`; dataset ID and SHA-256 match; privacy and legal reviewer identities are distinct; retention/redaction method is declared. | Record missing; purpose differs; data hash differs; decision is not approved; stop decision is not `proceed`. | Do not load, train, validate, or serve the model. Keep live outcome predictions disabled. | Model governance lead; privacy and legal reviewers. | Approved, scope-correct record and matching real evidence. |
| Before model validation run | Approval has future expiry; no revocation; validation cohort is within approved scope; model feature schema is fixed. | Approval expired/revoked; scope drift; undocumented data transformation; cohort lacks required provenance. | Halt validation; mark proposed run blocked; retain no derived result as release evidence. | Data controller; model governance lead. | Reauthorization or revised approval plus documented lineage and hash. |
| Before live decision support | Passed validation run, approved model gate, active data-use approval, approved twelve-step document evidence, and pinned HTTPS Georgetown runtime. | Any artifact mismatch, expired approval, failed metrics/uncertainty/fairness review, unavailable runtime, or missing document evidence. | Runtime returns a fail-closed precondition failure; do not invoke a general-purpose fallback model. | Model governance board; security/platform lead for runtime faults. | Corrected artifact/approval/evidence; repeat independent review where model/data changed. |
| After release | Continuous approval validity, model artifact/revision integrity, data retention compliance, and incident/change review. | Expiry, revocation, detected drift, material data/process change, or unreviewed runtime/model change. | Immediately disable governed outcomes; preserve evidence and audit context; open an incident/change record. | Model governance lead; privacy/legal owner; program sponsor for material incidents. | Formal reapproval and revalidation before re-enablement. |

### Data-use escalation timing

| Severity | Example | Response target | Mandatory notification | Release effect |
|---|---|---:|---|---|
| Critical | Unauthorized data access/use; approval revoked; model serves against hash-mismatched data or artifact. | Immediately; disable model path. | Privacy, legal, security, model governance, executive sponsor. | Blocks all live Georgetown decision support. |
| High | Approval expires; scope/feature change discovered; cohort provenance incomplete. | Same business day. | Data controller, model governance, privacy/legal. | Holds validation and live outcomes. |
| Medium | Review or retention evidence is incomplete but no unapproved data has been accessed. | Two business days. | Model governance and compliance. | Does not permit promotion from staged validation. |
| Low | Non-substantive evidence-package formatting issue. | Five business days. | Evidence owner. | No score/claim credit until corrected. |

## Critical-path dependencies

The CMS pilot and data-use approval paths are mutually dependent on controlled staging, approved redacted material, and independently reviewable evidence. They are not dependent on an API integration to CMS.

| Dependency | CMS pilot impact | Data-use impact | Owner | Latest viable decision point | Contingency |
|---|---|---|---|---:|---|
| Executive sponsor and accountable owners | No authority to scope pilot or accept operational risk. | No authority to approve use purpose or fund review. | Program lead. | Week 1. | Stop program mobilization. |
| Privacy/legal-approved data protocol | Blocks upload/use of pilot material. | Blocks all data access, validation, and model evidence. | Compliance and counsel. | Week 2. | Use no substitute/synthetic evidence for release credit; reschedule dependent work. |
| Controlled staging/identity/access | Blocks secure handoff preparation and receipt storage. | Blocks governed runtime/deployment verification. | Platform/SRE and security. | Week 2. | Continue code-only verification only; do not open pilot. |
| Named trained CMS portal operator and approved SOP | Blocks portal operation and receipt capture. | Indirect: blocks pilot evidence that may contribute to model-operational review. | CMS operations lead. | Week 3. | Maintain draft-only preparation; no CMS submission claim. |
| Lawful, representative validation cohort and independent reviewers | Indirect: platform must not describe decision support as available. | Direct critical path; model cannot be approved. | Model governance lead. | Week 2 for access, Week 8 for evaluation. | Keep runtime gate disabled; re-scope or retire model feature. |
| Portal receipt and feedback availability | Direct: pilot cannot be closed or claimed. | Indirect: no operational outcome evidence may be used in later model assertions without separate approval. | CMS operations lead. | Week 6. | Pilot stays hold; complete reconciliation only with verified evidence. |

## Repository enforcement mapping

| Control | Enforcement location | Behavior |
|---|---|---|
| Protected external evidence execution | `scripts/validate-external-release-blockers.mjs` and production preflight. | Requires protected execution and an evidence directory; validates data-use, Georgetown, CMS, payment, operations, and compliance programs. |
| Data-use lifecycle | `model_data_use_approvals` in migration `0039_external_evidence_release_controls.sql`. | Database checks and lifecycle trigger prevent malformed, mutable, or incoherent approval states. |
| Data-use runtime gate | `server/services/governed-outcome.ts`. | Requires active approved purpose/scope/expiry/hash-bound data-use approval before calling Georgetown runtime. |
| CMS pilot lifecycle | `cms_pilot_authorizations` in migration `0039_external_evidence_release_controls.sql`. | Database checks and lifecycle trigger enforce active approved `proceed` state, evidence hashes, expiry, and terminal transitions. |
| Human CMS handoff | `server/services/cms-adapter.ts` and `server/services/cms-outbox.ts`. | Creates a durable preparation record and records only a human-supplied receipt; contains no HTTP CMS transport, polling, or automatic submission worker. |
| CMS automation prohibition | `server/_core/production-gates.ts` and `scripts/validate-production-env.mjs`. | Production fails when `CMS_AUTOMATION_ENABLED` is enabled. |
