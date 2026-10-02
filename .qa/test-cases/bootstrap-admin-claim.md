# TEST-BOOT-001 — First-admin bootstrap claim

**OBJECTIVE:** Confirm `orgs.claimBootstrapAdmin`'s documented guarantee
("when ZERO active admin users exist, any authenticated user may claim
the platform admin role exactly once") holds for real, including the
precondition itself — every other admin-related test this pass reached
admin via a direct DB promotion, so this specific flow was still
unverified.

## Setup
Temporarily demoted all 4 existing admin test users to `"user"` (direct
DB write — safe and reversible on this disposable local DB) to create a
genuine zero-active-admin precondition.

## Results — 3/3 PASS

1. **Claim succeeds with zero active admins.** Logged in fully as
   `test-provider` (now demoted), confirmed `role: "user"` pre-claim,
   called `orgs.claimBootstrapAdmin` for real. **Result:** `{ok: true,
   role: "admin"}`. Confirmed in the database afterward.
2. **Audit entry written.** `audit_log` has a real `admin.bootstrap`
   row for this exact claim, correct `userId`, correct timestamp.
3. **Second claim by a different user is correctly denied** once an
   admin exists again. Logged in as `test-health-plan` (still `"user"`)
   and attempted the same claim. **Result:** `FORBIDDEN` — *"Bootstrap
   unavailable: an active platform admin already exists. Ask an admin
   to grant the role via admin.updateUserRole."*

## A real debugging note from this test (not an app defect)
The first claim attempt returned `mfa_required` even after a
seemingly-successful `auth.verifyLoginEmailOtp` call. Root cause was in
my OWN test tooling, not the app: `verifyLoginEmailOtp`'s response sets
an upgraded session cookie via `Set-Cookie`, but my first curl call only
read the existing cookie jar (`-b`) without writing the response's new
cookie back to it (`-c`) — so the mfa-pending cookie was never replaced
client-side, even though the server-side upgrade had genuinely
succeeded. Decoding the JWT payload directly confirmed the fix
(`"type":"mfa-pending"` → `"type":"session"` once `-c` was used on the
verify call itself). Documented here since it's a real trap for anyone
else scripting against this two-stage login.

## RESULT: PASS (3/3)
No defects found. The bootstrap-admin-claim flow works exactly as
documented, for a genuine zero-admin precondition, not just by
inspection of the code.

## Cleanup
Restored all 4 originally-admin test users back to `role: "admin"`
afterward (this test's own promotion of test-provider makes 5 total
pre-cleanup) so the local environment matches its pre-test state for
any further QA work.
