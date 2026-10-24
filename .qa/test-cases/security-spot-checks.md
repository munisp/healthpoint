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

## SQL injection — app code audited clean; a real incident in MY OWN test tooling (not the app)
Enumerated every `sql.raw`/`sql.unsafe` call site in the non-test server
code (there are 5):
- `server/emr/provenance.ts` — raw identifier is always one of the
  hardcoded `EMR_FILLABLE_FIELDS` array entries; values are always bound
  parameters. Not attacker-reachable.
- `server/routers.ts` (`cohortAnalysis`) — `groupBy` is a closed
  `z.enum(["serviceType","state","month"])`; only 3 fixed, developer-written
  SQL fragments can ever be produced regardless of input. Dates are
  regex-validated AND bound as parameters (defense in depth).
- `server/scheduled/emailDigest.ts` — cron-only, not reachable from any
  HTTP route.
- `server/journeys/context.ts` (`cleanPriorRuns`) — dev CLI tooling only,
  iterates a hardcoded table-name array, not reachable from any HTTP route.
No injectable raw-SQL surface found in the application code.

**Real incident during this check (full transparency):** attempted a live
SQL injection probe by inserting a classic payload
(`Robert'); DROP TABLE disputes; --`) as a dispute field value, using
`psql -v name=value` / `:name` substitution to build the INSERT. That
substitution mechanism is **plain text interpolation, not a parameterized
bind** — unlike anything the app itself does. The payload broke out of the
intended string literal and executed as written, actually dropping the
`disputes` table in the **local test Postgres container only**
(`healthpoint-test-postgres`/`idr_demo` — never the live cluster, never
production). This is the inverse of a false negative: it's proof the
underlying attack pattern is real and dangerous against naive string
interpolation, while also being a mistake in my own test harness, not a
finding about the application.

**Recovery:** confirmed exactly one table was affected (108 others intact,
no cascade failures — meaning nothing else has an enforced FK into
`disputes`), spun up a disposable fresh Postgres container, ran this
repo's own Drizzle migrations against it cleanly, `pg_dump --schema-only
-t disputes` from that known-good instance, and applied the resulting DDL
(full column set, primary key, unique constraint, all 14 indexes) to the
damaged local database. Verified recovery: `disputes.list` returns a
clean, correctly-empty result afterward. No data of lasting value was
lost (the table was already legitimately empty of test fixtures at the
time — the standing practice this whole pass was to delete each test's
fixtures immediately after asserting on them). Temporary container and
scratch files cleaned up.

**Lesson for future SQL injection probes against this app**: construct the
test payload as an actual HTTP request through the application's own API
(as every other test in this pass did), never via `psql`'s own `-v`/`:var`
substitution — that mechanism has no bearing on whether the *application*
is vulnerable and can trivially stage a real accident against whichever
database happens to be connected.

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

## RESULT: PASS on everything tested (5/5 — cookies, JWT tampering,
alg:none forgery, stack-trace leak, SQL injection code audit); broad
security section still has real remaining scope (see above). The IDOR/
ownership-chain checks for `webhookReplay.replay` and `bulkFhir.cancelJob`
are documented separately in `risks.md` (both PASS, live-verified).
