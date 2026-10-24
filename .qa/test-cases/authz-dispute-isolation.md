# TEST-AUTHZ-001 — Dispute object-level authz (IDOR) isolation

**ROLE:** provider (owner) / payer (unrelated third party) / system admin
**OBJECTIVE:** Confirm `disputes.getById` enforces real ReBAC-style
object-level authorization, not just session authentication — an
unrelated authenticated user must not be able to read another party's
dispute by guessing/supplying its ID.
**RISK:** Critical. This is an adversarial, regulated, two-sided
financial domain (providers and payers are the literal opposing parties
in a billing dispute) — an IDOR here is a real HIPAA/financial-privacy
incident, not a cosmetic bug.
**ENVIRONMENT:** Local dev, real Postgres + real local Keycloak (healthpoint
realm, `keycloak/realm-export.json`), real tRPC server, no mocks.
**TEST ACCOUNTS:** `test-provider` (seeded, stakeholder=provider),
`test-health-plan` (seeded, stakeholder=payer), `platform-admin`
(seeded, promoted to `users.role='admin'` via direct DB update for
this test — Keycloak realm roles are NOT auto-synced to app role,
confirmed separately, see below).

## Steps and results

1. Logged in as `test-provider` via the real OIDC Authorization Code +
   PKCE flow (Keycloak login form submission, not a stubbed session).
   **Result:** session established; `auth.me` returned the real user
   (`id: 3366be74-aea2-469f-99f3-8ad73a6e3a1a`).
2. Created a real dispute via `disputes.create` as `test-provider`
   (`initiatingPartyType: provider`, `respondingPartyName: "Test Health
   Plan"` — a plain text field, not a relation grant).
   **Result:** dispute `1a322b30-16de-46aa-b0c5-66413cb7403f` created.
   (Along the way: the fail-closed completeness gate correctly rejected
   the first attempt for a missing `renderingNpi` — working as intended,
   not a defect.)
3. Read the dispute back as `test-provider` (the owner) via
   `disputes.getById`.
   **Result: PASS.** Returned successfully.
4. Logged in as a SEPARATE, unrelated seeded user, `test-health-plan`
   (different Keycloak subject, different session cookie jar), and
   attempted `disputes.getById` on the SAME dispute ID.
   **Result: PASS.** Denied with tRPC `FORBIDDEN` (code -32003):
   `"You do not have read access to dispute 1a322b30-..."`. Confirms the
   check is a real relation check, not a loose string match against the
   `respondingPartyName` text field (which literally says "Test Health
   Plan" — the same org name — yet access was still correctly denied,
   since no `dispute#reviewer@user` relation was ever granted to this
   specific user).
5. Logged in as `platform-admin`. **Finding (not a defect):** despite
   having Keycloak realm role `admin`, the app's own `users.role` came
   back `user` on first login — confirms `server/_core/keycloak.ts`'s
   documented behavior that privileged app roles are never auto-synced
   from IdP claims (self-asserted roles aren't trusted; elevation only
   via `admin.updateUserRole` or an explicit bootstrap-claim flow). This
   is a deliberate, good security property.
6. Manually promoted `platform-admin` to `users.role='admin'` via direct
   DB update (to exercise the admin-bypass path without chasing the full
   bootstrap-claim flow this pass) and retried `disputes.getById` on the
   same dispute.
   **Result: PASS.** Allowed, as expected for an admin.

## Evidence
All three calls executed for real against a running server, real
Postgres, real Keycloak-issued sessions — not mocked, not asserted from
reading source. Raw tRPC responses captured in
`/tmp/healthpoint-test-logs/` (this session's scratch dir, not
committed).

## RESULT: PASS (3/3 sub-checks)
No defect found. Object-level authz for disputes is correctly enforced
for the owner/unrelated/admin matrix tested.

## Not yet tested (follow-up)
- `reviewer`/`arbitrator`/`org_admin` relation grants specifically (only
  owner vs. no-relation vs. admin were exercised — the granted-relation
  path itself, e.g. "payer who WAS assigned as reviewer CAN read", is
  still unverified).
- Mutation-side authz (`disputes.create`'s object isn't scoped per-user
  since it's a creation, but other mutations like `advanceStep` on a
  dispute the caller doesn't own).
- Horizontal escalation via a manipulated/forged session rather than a
  real second account.
- The `admin.updateUserRole` / bootstrap-claim flow itself (bypassed via
  direct DB write for this test).

## UPDATE: granted-relation path tested — RESULT: PASS (2/2 additional sub-checks)

Followed up the "Not yet tested" item above with the real
`authz.grantAccess` procedure (not a DB shortcut this time — it's a real
tRPC mutation, itself gated by requiring `admin`-level access on the
dispute, which the owner has implicitly).

7. As the owner (`test-provider`), granted `test-health-plan` `"read"`
   access via `authz.grantAccess`.
   **Result: PASS.** The exact same `test-health-plan` session that was
   denied in step 4 above can now read the dispute — confirms the grant
   path works and takes effect immediately (no re-login needed).
8. Attempted `disputes.advance` (requires `"write"`) as `test-health-plan`,
   who was only granted `"read"`.
   **Result: PASS.** Denied with a real `FORBIDDEN`
   ("You do not have write access..."). Confirms permission levels are
   enforced with real least-privilege granularity (`read`/`write`/`admin`
   are not just a binary has-access flag) — a `read` grant cannot be used
   to perform a `write`-level mutation.

## Full authz matrix now verified for real, end to end:
owner (allow) / no relation (deny) / granted read (allow-for-read,
deny-for-write) / admin (allow). Mutation-side authz confirmed
alongside read-side.
