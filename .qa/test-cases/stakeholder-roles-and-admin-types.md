# TEST-ROLE-001 — Stakeholder roles, admin types, and the patient-facing surface

**OBJECTIVE:** All authz testing up to this point exercised the
system-role dimension (user vs admin) and generic ReBAC permission
levels (read/write/admin). It never exercised the business
*stakeholder* roles this app actually models (`provider`, `facility`,
`payer`, `idr_entity`), never confirmed there's more than one kind of
"admin," and never touched the patient-facing surface at all. This test
closes those three gaps.

## Part 1 — Privileged stakeholder-role self-selection is correctly blocked
`profiles.save` lets a user self-assert `stakeholderRole`, but
`payer` and `idr_entity` are carved out as privileged (only an admin or
invite flow may assign them — `server/routers.ts` ~line 2786).

Live test as a genuine non-admin, no existing profile:
- Self-select `idr_entity` → **FORBIDDEN**: *"The 'idr_entity' role can
  only be assigned by an admin or invite flow; it cannot be
  self-selected."*
- Self-select `payer` → **FORBIDDEN**, same message pattern.
- Self-select `provider` (not privileged) → **succeeds**, profile
  correctly updated.

**RESULT: PASS (3/3).** The arbitrator-tier (`idr_entity`) and
admin-tier (`payer`) stakeholder identities can't be claimed by just
asking for them — a real finding, since `idr_entity` is the certified
arbitrator whose determinations are presumably legally binding; letting
anyone self-assign that would be a serious hole, and it's closed.

## Part 2 — "Types of admins": dispute-scoped admin vs platform admin
`server/authz.ts` documents 4 ReBAC relations: `owner`, `reviewer`
(payer-side), `arbitrator` (read+admin on ONE dispute), and `org_admin`
(org-scoped, read+admin+delete). Two findings:

1. **`org_admin` is unreachable dead schema, not an untested feature.**
   No `organizations` table exists anywhere in `drizzle/schema.ts`, and
   `org_admin`/`orgAdmin` appear nowhere outside `server/authz.ts`
   itself. `canonicalRelationForPermission` — the one function that
   maps a granted permission to a relation — deliberately maps
   `"admin"` to `arbitrator`, explicitly bypassing `org_admin` ("targets
   organization#admin, not a user"). There is no code path that could
   ever create an org-admin relationship today. Correcting the
   assumption that this was simply untested: it's not built, at all.

2. **Dispute-scoped "admin" (arbitrator) does not leak into
   platform-admin capability — verified live.** Granted a genuine
   non-admin, unrelated user `permission: "admin"` on exactly one
   dispute via `authz.grantAccess`. Confirmed:
   - They can read the granted dispute (previously denied, now allowed).
   - They can perform an admin-level action ON that dispute
     (`authz.grantAccess` to grant a third party access to it) —
     confirming "admin" here really does mean full control of that one
     resource, not a no-op.
   - They **cannot** call `admin.allDisputes` (platform-wide):
     `FORBIDDEN — "Admin access required"`.
   - They **cannot** call `reports.exportCSV` (tenant-wide export):
     `FORBIDDEN — "Admin role required to export tenant-wide reports"`.

**RESULT: PASS.** There are genuinely two different "admin" concepts in
this codebase — a scoped, per-resource one (arbitrator) and the real
platform-wide one (`users.role = 'admin'`) — and the boundary between
them holds. `org_admin` is not a third kind in practice; it's unbuilt.

## Part 3 — Patient-facing portal (never touched before this test)
An entirely separate, unauthenticated, token-based access model —
`server/routers/patient-portal.ts`. A provider/admin issues an opaque
bearer token (`patientPortal.issueViewToken`) scoped to one dispute;
the patient uses it via `publicProcedure` (no login at all) to view a
redacted summary. Documented contracts: single-use for "view" scope,
revocable, and a strict redaction allowlist (never internal notes,
document paths, or user ids).

Live test, real dispute seeded with an internal `notes` value
containing an obvious marker string:
1. **Issued token → used with zero cookies/session** (true public
   access): succeeded. Response contained exactly the documented
   redacted fields (`referenceNumber`, `status`, `currentStep`,
   amounts, etc.) — the internal `notes` marker string, the dispute's
   `id`, `createdBy`, and `initiatingPartyId` were **not present
   anywhere** in the response. Redaction contract holds, not just
   documented.
2. **Same token reused** → `UNAUTHORIZED — "Invalid, expired, or
   already-used patient access token"`. Single-use is real, not a
   stale comment — the DB-level check requires `usedAt IS NULL`, so a
   reused token simply doesn't match any row.
3. **Garbage/fabricated token** → same `UNAUTHORIZED`, correctly
   indistinguishable from "already used" (doesn't help an attacker
   tell which case they hit).
4. **Fresh second token, revoked before first use, then attempted** →
   `UNAUTHORIZED — "This patient access link has been revoked"` — a
   distinct, specific message from the expiry/reuse case, confirming
   the separate `assertNotRevoked` check actually runs and fires.

**RESULT: PASS (4/4).** The patient-facing surface — a meaningfully
different trust model from everything else tested this pass (no login,
opaque bearer token, strict redaction) — holds up under live testing on
every documented guarantee checked.

## Part 4 — idr_entity's actual determination-issuing capability: resolved
Checked every reference to `idr_entity`/`stakeholderRole` across
`server/routers.ts`: it is used ONLY as descriptive metadata (who this
person represents) and in the self-selection guard already tested
above. **No procedure anywhere gates on `stakeholderRole ===
"idr_entity"` specifically.** The real authorization for issuing a
determination is whatever generic dispute-level permission the caller
holds — the `arbitrator` ReBAC relation or system admin, both already
verified live in Part 2. There is nothing further to test here; the
stakeholder role and the authorization mechanism are two independent
systems, confirmed by reading every call site, not assumed.

## Part 5 — the remaining two patient-portal endpoints
- **`uploadDocument`**: deliberately does NOT enforce single-use (its
  own comment: "tolerates prior view use") — confirmed live: a token
  already consumed by `viewCase` still succeeds for upload, and a
  SECOND upload with the identical token also succeeds (genuinely
  repeatable, not an oversight — a patient needs to attach multiple
  documents under one link). Revocation still correctly blocks it
  (`UNAUTHORIZED — "revoked"`) once revoked.
- **`ppdrIntake`**: scope separation confirmed (a `ppdr_intake` token
  rejected by `viewCase`'s "view"-scope requirement). A real intake
  with plausible numbers produced genuinely computed values
  (`excessUsd: 1500` = billedTotal − gfeTotal, not a stub) and created
  a real FSM case. **Found a real but harmless doc/code mismatch**:
  `server/personas/guards.ts`'s comment claims "ppdr_intake tokens stay
  reusable until expiry for the intake wizard," but
  `patientPortal.ppdrIntake`'s handler explicitly calls
  `markPatientTokenUsed` after a successful intake (line ~287) — live-
  confirmed the token IS single-use in practice, contradicting the
  comment. Not a security defect: the enforced behavior (single
  intake per link) is actually the safer of the two, preventing a
  leaked/shared link from spam-creating unlimited duplicate PPDR
  cases. Just a stale comment worth correcting.

## Still not tested
- `payer`-specific flows beyond the self-assignment block (e.g., is
  `reviewer` relation actually granted to payer-role users
  automatically anywhere, or always a manual `grantAccess` call?).
- `facility` stakeholder role — not distinguished from `provider` in
  any test this pass.
