# TEST-SEC-001 — Security spot checks (auth/session layer)

**OBJECTIVE:** The skill's security-testing section (SQL/NoSQL injection, JWT
vulnerabilities, session hijacking, mass assignment, CSRF, etc.) was entirely
untouched prior to this pass. This is a focused first slice on the auth/
session layer, which is the highest-leverage target (a hole here compromises
everything else already tested) — not a claim that the full security section
is complete.

## Session cookie attributes — PASS
`app_session_id`, `KEYCLOAK_SESSION`, `AUTH_SESSION_ID`, etc. are all set
`httpOnly: true, sameSite: "lax"`, with `secure` conditional on
`x-forwarded-proto: https` or direct TLS (server/_core/keycloak.ts). Blocks
JS-based cookie theft (httpOnly) and classic cross-site form CSRF (sameSite
lax, since all tRPC mutations are POST). **Not independently verified**:
whether Apisix actually forwards `x-forwarded-proto: https` on the real
production route (would need Apisix route inspection to confirm `secure`
resolves true live) — flagged as unverified rather than assumed.

## JWT tampering — PASS (live, not just code review)
Session JWTs are signed HS256 (`jose` SignJWT/jwtVerify) with a server-only
secret, verification pinned to `algorithms: ["HS256"]`. Payload carries only
`sub`/`name`/`email`/`type`/`jti`/`exp` — no role or permission claim, so
even a *valid* forged token could never carry elevated privilege (role is
always re-fetched from the DB by `sub` on every request).

Live tests against the local dev server:
1. Took a real, valid session cookie, decoded it, changed `sub` to an
   arbitrary fake user ID, re-encoded, kept the original (now-mismatched)
   signature. **Result:** `auth.me` → `null` (treated as unauthenticated).
   Control request with the untouched cookie still worked.
2. Crafted a classic `alg: none` unsigned forgery (header `{"alg":"none"}`,
   empty signature segment, claiming an arbitrary user ID). **Result:**
   `auth.me` → `null`; `disputes.list` → `401 UNAUTHORIZED`. Explicit
   algorithm pinning in `jwtVerify` blocks this well-known JWT library
   vulnerability class.

## Error response stack-trace leak — PASS (verified live in production)
This session's `errorFormatter` fix (added earlier in this pass, strips
`shape.data.stack` outside `NODE_ENV=development`) was verified not just
locally but against the **real live production endpoint**:
```
curl https://healthpoint.newfire.app/api/trpc/disputes.list
→ {"error":{"json":{...,"stack":null}},"meta":{"values":{"data.stack":["undefined"]}}}
```
Confirmed `NODE_ENV=production` on the live pod first
(`kubectl exec ... printenv NODE_ENV`), then confirmed the real HTTPS
endpoint returns `stack: null` on an unauthorized request — the fix is
effective in the actual deployed environment, not just reasoned about from
the code.

## Mass assignment — architectural spot check, not exhaustively tested
Every mutation input reviewed uses explicit `z.object({ ...named fields })`
Zod schemas (tRPC's default behavior strips unrecognized keys rather than
passing them through to a DB write). Role changes are only ever possible via
the separate, explicitly admin-gated `admin.updateUserRole` procedure
(already exercised this pass via DEFECT-006 and the bootstrap-admin-claim
test) — there is no generic "update my profile" mutation that accepts a
`role` field. This is a pattern-level finding across the handlers reviewed,
not a check of all ~40 namespaces' input schemas individually.

## NOT YET TESTED (explicitly out of scope for this pass)
- SQL/NoSQL injection probes against free-text fields.
- SSRF via any user-controlled URL/webhook fields (`webhooks.*` namespace
  exists and is registry-covered per the earlier authz-registry spot-check,
  but SSRF specifically wasn't probed).
- CSRF beyond the SameSite=Lax cookie attribute (no explicit CSRF token
  mechanism found/tested).
- Rate-limit bypass on login/MFA beyond what DEFECT and MFA testing already
  incidentally covered (per-user OTP rate limiting was confirmed earlier,
  but not an exhaustive brute-force probe).
- Dependency vulnerability scanning (`npm audit` or similar) — not run this
  pass.

## RESULT: PASS on everything tested (4/4); broad security section still
has real remaining scope (see above).
