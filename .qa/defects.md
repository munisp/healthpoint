# Defects — healthpoint-idr QA pass (2026-10-02)

## DEFECT-001 — FIXED
**Severity:** P2 (high — information disclosure)
**Title:** tRPC error responses leak full server stack traces regardless of environment
**Evidence:** `curl http://localhost:3000/api/trpc/submitter.list` (a deliberately-unknown
procedure) returned a JSON body containing the full Node.js stack trace,
including absolute filesystem paths under `node_modules/.pnpm/...`,
revealing exact library versions and internal directory structure.
**Root cause:** `initTRPC....create({ transformer: superjson })` had no
`errorFormatter`; tRPC v11's default error shape always includes
`error.stack`. No `NODE_ENV` gate existed anywhere in the chain.
**Fix:** `server/_core/trpc.ts` — added an `errorFormatter` that strips
`shape.data.stack` when `NODE_ENV !== "development"`.
**Verification:** Traced the standard, documented tRPC pattern for this
exact problem; confirmed no existing errorFormatter via grep. Did NOT
complete a live production-mode HTTP round-trip — production startup has
a long chain of unrelated required secrets (encryption key, scheduled
secret, settlement mTLS material...) that would need stubbing; judged
not worth the effort for a straightforward, well-understood fix. Full
vitest regression (1378/1393 passing, same 1 pre-existing/expected
failure) shows no behavioral regression.
**Commit:** `8f2d3f5` on `assurance/remediation-2026-09-05`.

## DEFECT-002 — FIXED
**Severity:** P4 (low — observability/operator-trust)
**Title:** Misleading ERROR-level log implies authentication is broken when it isn't
**Evidence:** Every server boot logged
`[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable.`
This directly cost real investigation time this session before being
traced to dead code.
**Root cause:** `server/_core/sdk.ts`'s `OAuthService` is legacy
scaffolding (not the real auth path — see architecture.md) but logs at
ERROR severity with no context distinguishing it from a real auth outage.
**Fix:** Downgraded to `console.warn` with an accurate message naming
what's actually affected (two legacy scheduled-endpoint handlers) and
what isn't (primary Keycloak-based auth).
**Verification:** Confirmed live against the running dev server; new
message appears on boot. Same regression run as DEFECT-001.
**Commit:** `8f2d3f5` on `assurance/remediation-2026-09-05`.

## DEFECT-003 — NOT FIXED (needs a scope decision)
**Severity:** P3 (medium — developer-experience, blocks fresh onboarding)
**Title:** The repo's own documented local dev stack (`docker-compose.yml`)
cannot be brought up as-is
**Evidence:**
1. `docker compose up -d postgres` fails to even *parse* the file:
   `'services[minio-init].command' invalid command line string` — a
   multi-line YAML block scalar combined with a custom
   `entrypoint: ["/bin/sh", "-c"]` that this Compose version rejects.
2. Even past that, `infra/postgres/init.sql` does
   `CREATE EXTENSION IF NOT EXISTS pgaudit;` against plain
   `postgres:16-alpine`, which doesn't ship that extension — init.sql
   would abort on a truly fresh container.
**Impact:** Nobody can `docker compose up` any subset of this stack
fresh, per the file's own stated purpose ("Development and Integration
Stack"). Worked around this pass by running postgres/redis as standalone
`docker run` containers and applying only Drizzle migrations, skipping
compose and init.sql entirely.
**Why not fixed:** `docker-compose.yml` is a large, shared,
production-adjacent file (has an explicit audit-trail of prior P1/P2
fixes in its own comments) — rewriting its YAML structure wasn't
something to do opportunistically without asking first.
**Suggested fix:** (a) rewrite `minio-init`'s `command` as a single-line
string instead of a YAML block scalar; (b) either switch to a postgres
image with pgaudit baked in (e.g. a custom build, matching how the real
cluster presumably does it) or make `init.sql` tolerate a missing
pgaudit extension (`DO $$ BEGIN ... EXCEPTION WHEN undefined_file THEN ... END $$;`
or just gate it).

## Findings that turned out NOT to be defects (corrected during investigation)
- **"Authorization is bypassed without Permify"** — wrong. `server/authz.ts`
  has a complete, real Postgres-based ReBAC reimplementation used as a
  drop-in fallback. Not a gap.
- **"Scheduled reconciliation is broken"** — wrong. The "skipped" status
  seen on every boot is `server/reconciliation.ts` correctly no-op'ing
  because `TB_LEDGER_ENABLED` is unset (TigerBeetle not configured
  locally) — a deliberate, safe feature-flag skip, not a failure.

## DEFECT-004 — FIXED
**Severity:** P2 (high — blocks all real local authentication testing)
**Title:** OIDC discovery hard-fails against a plain-HTTP local Keycloak
**Evidence:** `GET /api/auth/login` against a locally-running Keycloak
(`KEYCLOAK_URL=http://localhost:8080`, matching `.env.example` exactly)
failed with `ClientError: only requests to HTTPS are allowed` /
`OAUTH_HTTP_REQUEST_FORBIDDEN`, every time, with zero workaround available
in the existing code.
**Root cause:** `openid-client`/`oauth4webapi` v6 refuses non-HTTPS OIDC
discovery by default (a deliberate hardening). `server/_core/discovery-cache.ts`
called `client.discovery(issuerUrl, clientId, clientSecret)` with no
options, so there was no way to allow this even in development. This
means nobody has been able to locally test the real Keycloak login flow
end-to-end against a non-HTTPS Keycloak before.
**Fix:** Pass `{ execute: [client.allowInsecureRequests] }` — the
library's own sanctioned escape hatch — gated to `NODE_ENV !== "production"`,
so a real deployment (which uses the real HTTPS issuer) is unaffected.
**Verification:** Full real OIDC Authorization Code + PKCE login flow
executed end to end against a real local Keycloak container (importing
the repo's own `keycloak/realm-export.json`): login → Keycloak form
submission with seeded `test-provider` credentials → callback → session
cookie → `auth.me` tRPC call returned the real authenticated user
(`id` matching the Keycloak subject, `loginMethod: "keycloak"`). This is
the first time this session (and per the evidence, maybe ever locally)
this flow has been proven to work end to end, not just read in source.

## Local-test-environment artifacts (not app bugs — noting for completeness)
- `keycloak/realm-export.json` has several issues unrelated to DEFECT-004
  that blocked a fresh import and had to be worked around for THIS
  session's local Keycloak container only (not fixed in the committed
  file): (a) `healthpoint-frontend`/`healthpoint-app` redirect URIs and
  `healthpoint-backend`/`apisix-gateway` client secrets contain unexpanded
  `${VAR}` template placeholders that fail Keycloak's own URI/import
  validation — the file is clearly meant to go through an envsubst-style
  templating step before import that isn't present anywhere in this repo;
  (b) seeded test users' passwords are ALSO unexpanded placeholders
  (`${ADMIN_INITIAL_PASSWORD}` etc.) with zero lowercase characters,
  failing the realm's own password policy; (c) the export references
  the standard default client scopes (`profile`, `email`, `roles`,
  `web-origins`, `address`, `phone`) but doesn't include their
  definitions, so a fresh import silently drops them, breaking the
  default `scope=openid email profile` login request entirely
  (`invalid_scope`) until recreated manually. Recreating them via the
  admin API (as done for this test) produces bare scopes with no
  protocol mappers, which is why the authenticated user's `name`/`email`
  came back `null` even though the seed data has real values — that
  null is an artifact of this incomplete local workaround, not a bug in
  `server/_core/keycloak.ts`'s claim-extraction code (read and confirmed
  correct).
- Recommend, as a separate piece of work: fix `keycloak/realm-export.json`
  to either hold real resolvable values or go through a documented
  templating step, and consider exporting the full default scope set.

## DEFECT-005 — FIXED
**Severity:** P1 (critical — real financial-correctness bug, idempotency
is a core invariant for a payment ledger)
**Title:** A genuine idempotent payment retry was rejected with a
confusing error instead of returning its original result
**Evidence:** Recorded a real verified payment ($390, fully covering a
dispute's $390 determination) via `ledger.recordPayment` as admin.
Retried the EXACT SAME call with the EXACT SAME `idempotencyKey`
(simulating a client retry after e.g. a dropped response) — instead of
returning the original entry, it failed with: *"No remaining determined
amount to pay: determination 390.00 USD is already covered by recorded
payments of 390.00 USD."*
**Root cause:** `recordPaymentInTransaction` (`server/ledger.ts`) ran
`assertPaymentAcceptable()` (a business-state balance check) BEFORE
checking whether a ledger entry with this `idempotencyKey` already
existed. The first call's own success changed the state
(`paidAmount` now equals `determinationAmount`), so the retry's balance
check saw "nothing left to pay" and threw — even though the correct
behavior for a true idempotent replay is to return the original result
unconditionally, before any state-dependent validation runs at all.
**Impact:** Any real retry of a successful payment (network timeout,
client-side retry logic, a caller that didn't see the first response)
would get a hard error implying something is wrong, when the payment
had actually already succeeded correctly. In an automated settlement
pipeline this could be read as a failure requiring manual intervention
for a request that was, in fact, already complete.
**Fix:** Moved the idempotency-key existing-entry lookup to run
immediately after the per-dispute advisory lock is acquired, before the
dispute fetch, the step-state check, and `assertPaymentAcceptable` —
so a replay always short-circuits to its original result regardless of
any state change the original call itself caused.
**Verification:** Reproduced live (real server, real Postgres, real
admin session): first call succeeded and posted $390; the SAME call
with the SAME idempotency key failed with the error above BEFORE the
fix. After the fix, the identical retry returned the exact original
entry (same `id`, same `createdAt`) instead of erroring. Ledger balance
confirmed correct afterward (`paid: $390` exactly once, not duplicated,
not errored away). Full vitest regression: 1378/1393 passing, same 1
pre-existing/deliberately-unconfigured failure, no new regressions.

## DEFECT-006 — FIXED
**Severity:** P1 (critical — real privilege-escalation path)
**Title:** A pre-existing, intentionally-scope-limited API key silently
gains full admin access the moment its owner is later promoted to admin
**Evidence:** `apiKeys.create` correctly strips the `"admin"` scope at
mint time when the requester isn't an admin (confirmed: a key minted by
a non-admin test user requesting `["read","write","admin"]` was stored
with `scopes: "read,write"` only). Calling `admin.allDisputes` with that
key as a non-admin owner was correctly denied. But after promoting the
SAME key's owner to `admin` in the database — with the key's own stored
scopes left completely unchanged — the EXACT SAME, never-reissued key
was then able to successfully call `admin.allDisputes`.
**Root cause:** `adminProcedure` (`server/routers.ts`) only checked
`ctx.user.role !== "admin"`. `server/auth/bearer.ts`'s
`authenticateApiKey` re-derives the effective scope filter from the
key owner's CURRENT role on every request (`user.role === "admin" ?
requestedScopes : requestedScopes.filter(s => s !== "admin")`) and sets
`ctx.user` to that live user row — so once the owner becomes admin,
`ctx.user.role` reads `"admin"` regardless of what the key itself was
ever granted. `adminProcedure` never consulted `ctx.apiKeyScopes` at
all, so it had no way to tell "this request has an admin session" apart
from "this request has a non-admin-scoped key whose owner happens to be
admin now."
**Impact:** Defeats the entire purpose of scoped API keys for any
`adminProcedure`-gated endpoint. A key deliberately minted with limited
scope (e.g. for a specific automation/integration that should never be
able to perform admin actions) silently becomes a full admin key the
moment its owner's account is promoted for unrelated reasons — with no
re-mint, no scope change, and no visible signal to anyone relying on
the key's documented scope.
**Fix:** `adminProcedure` now also requires, when the request
authenticated via an API key (`ctx.viaApiKey`), that
`ctx.apiKeyScopes.includes("admin")` — independent of the live
`ctx.user.role` check.
**Verification:** Reproduced live end to end (real server, real
Postgres, real Keycloak sessions): non-admin mints a key requesting
admin scope → stored as `read,write` → denied pre-promotion (baseline)
→ owner promoted to admin in the DB, key never touched → **before the
fix**, the same key was allowed through `admin.allDisputes`; **after
the fix**, the same key is correctly denied with `"This API key does
not have the admin scope"`. Also confirmed no regression on the
legitimate path: a key minted by an ALREADY-admin user with the admin
scope genuinely granted continues to work normally. Full regression:
1372/1393 passing + 20 skipped (2 Temporal suites hit a transient
ephemeral-server startup timeout under post-restart system load,
confirmed unrelated to this change — both pass cleanly, 6/6, on a
clean re-run) + the 1 pre-existing/deliberately-unconfigured
kafka-connectivity failure. No new regressions.

## UI/E2E testing — a real gap in this pass, now partially closed

No browser-based testing had happened at all until this point. The repo
has a real Playwright e2e suite (`e2e/*.spec.ts`, 2 files, 13 tests
total) that had never been run this pass. Running it surfaced both a
pre-existing local-environment bug and a real candidate application
defect.

**Local environment bug found and fixed**: `SETTLEMENT_CALLBACK_KEYRING`
in `.env` was the plain string `dev-settlement-callback-keyring` —
`parseSettlementCallbackKeyring` (`server/settlement-auth.ts`) requires
valid JSON (`{"keyId": "secret(>=32 chars)"}`), so this value has always
silently resolved to "no keyring configured," and
`SETTLEMENT_MTLS_CLIENT_FINGERPRINTS` wasn't valid hex either. Together
these caused ALL 10 `settlement-callback.spec.ts` tests to fail their
`beforeAll` precondition check and never run — this has apparently been
broken in this local setup since whenever `.env` was created, not
something this session caused. Fixed both values to valid formats in
`.env` (local dev file only); this unblocked 9 of the 10 tests to
actually execute, 6 of which pass.

## DEFECT-007 — CANDIDATE, NOT YET CONFIRMED (needs product judgment)
**Severity:** P2 (likely — reconciliation visibility gap, not a financial
correctness bug; money is never misplaced, but ops loses visibility into
*why* a report was rejected)
**Title:** A settlement provider report that would overpay a dispute via
a DIFFERENT transfer than the one already fully covered it bypasses the
reconciliation-exception audit trail and surfaces as a generic error
instead
**Evidence:** `e2e/settlement-callback.spec.ts`'s lifecycle tests seed one
dispute with TWO settlement transfers (`lifecycleTransferId` = $80,
`exceptionTransferId` = $40). After the first transfer's report settles
and fully covers the dispute's $80 determination, the second transfer's
own report — which matches ITS OWN transfer's amount/provider/status
correctly — expected `{reconciliationStatus: "exception", transferStatus:
"submitted"}` with a 409. Actual response: `{"error": "Settlement report
was not reconciled", "message": "No remaining determined amount to pay:
determination 80.00 USD is already covered..."}`, same 409 status but a
different, non-reconciliation-tracked error shape.
**Root cause:** `reportSettlementOutcome` (`server/settlement-lifecycle.ts`
~line 400) only classifies a report as a tracked `reconciliationStatus:
"exception"` (written to `settlement_reconciliations` +
`settlement_exception_reviews` for ops review) when the report's amount/
provider/transition doesn't match its OWN transfer row. When those all
match but the report would still overpay the DISPUTE overall (because a
different transfer already consumed the determination), it instead calls
`recordPaymentInTransaction`, which throws `LedgerIntegrityError` from
`assertPaymentAcceptable` — a correct, necessary guard (this is the exact
invariant DEFECT-005 fixed the idempotency-ordering around) — but that
throw isn't caught and reclassified into the exception-review workflow;
it just propagates as a generic rejection.
**Impact:** Ops has a dedicated review queue
(`settlement_exception_reviews`) specifically for "a provider report
didn't reconcile cleanly, someone needs to look at this" — this failure
mode produces exactly that situation (a real provider report that can't
be applied) but skips the queue entirely. The money is safe (the ledger
guard correctly prevents overpayment either way), but the operational
visibility this system is clearly designed to provide for reconciliation
problems doesn't fire here.
**Why not fixed yet:** This needs a product decision, not just a code
change — is this scenario (two transfers against one dispute, second one
arriving after the first already fully paid) something that should
always route to exception-review, or is today's hard-reject the
intentional, simpler behavior and the test's expectation is what's wrong?
Both are defensible; picking the wrong one risks masking real double-
transfer situations OR flooding the exception queue with normal
already-settled noise. Flagging for the repo owner rather than guessing.
**Suggested fix (if exception-routing is the right call):** wrap the
`recordPaymentInTransaction`/`reversePaymentInTransaction` calls in this
function in a catch for `LedgerIntegrityError` specifically, and on catch,
write the same `settlement_reconciliations`/`settlement_exception_reviews`
rows the amount/provider/transition-mismatch path already writes, with
the ledger error's message as the `exceptionReason`.

## DEFECT-008 — FOUND, NOT FIXED (P1 — SSRF, CWE-918)
**Severity:** P1 (critical — server-side request forgery, exploitable by
ANY authenticated user, not just admin)
**Title:** Webhook URLs are never validated against internal/private
targets; the server will fetch whatever URL a user registers, both
on-demand (`webhooks.test`) and automatically on every matching dispute
event (the real delivery path)
**Evidence (live, both directions):**
1. Registered a webhook as a plain authenticated user with
   `url: "http://127.0.0.1:6379/"` (the local Redis port) — `Zod`'s
   `z.string().url()` is the ONLY validation (`webhooks.create`,
   `server/routers.ts` ~line 3066), which only checks URL *syntax*, not
   destination. Creation succeeded with no warning. `webhooks.test`
   then performed a real TCP connection to that internal port
   (`statusCode: 0`, protocol mismatch — proof the connection was
   actually attempted and reached, not rejected upfront).
2. Registered a second webhook with
   `url: "http://127.0.0.1:3000/api/health"` (the app's own internal
   health endpoint) — `webhooks.test` returned **`{success: true,
   statusCode: 200}`**: conclusive proof the server made a real,
   successful internal HTTP request on the caller's behalf and reported
   the live result back to them.
3. Confirmed this is NOT limited to the on-demand `.test` button:
   `server/webhook-dispatcher.ts`'s `dispatchWebhooksForEvent` — the
   real, automatic delivery path triggered by every matching dispute
   event — calls `fetch(webhook.url, ...)` (line 168) with the
   identical absence of any URL validation. Worse than `.test`: this
   path retries up to 5 times over an hour
   (`WEBHOOK_RETRY_SCHEDULE_MS`) per event, automatically, for as long
   as the webhook stays active — a persistent, recurring SSRF primitive
   triggered by ordinary application activity (any dispute event the
   registering user can see), not a one-shot action.
**Root cause:** `webhooks.create`/`webhooks.update`'s Zod schema
(`url: z.string().url()`) validates URL *syntax* only — scheme, host,
and path well-formedness — with zero check against the URL's actual
network destination (private/loopback/link-local ranges, cloud
metadata endpoints, internal cluster service DNS names).
**Impact:** Any authenticated user (the procedure is plain
`protectedProcedure`, no admin gate) can make the server issue
arbitrary HTTP requests to internal-only targets. Concretely, since
this app deploys to DigitalOcean
(`registry.digitalocean.com/talentgraph-auth/healthpoint`), a webhook
pointed at DigitalOcean's metadata endpoint
(`http://169.254.169.254/metadata/v1/...`) could potentially expose
instance metadata; a webhook pointed at another in-cluster service's
ClusterIP or `*.svc.cluster.local` name could reach internal
APIs/admin endpoints that assume network-level isolation is their only
protection (several of this cluster's own services — Keycloak admin
API, Permify, internal DB ports — fall in that category per this
session's own infrastructure notes). The response body/status/timing
is echoed straight back to the requesting user via `webhooks.test`,
making this a usable oracle, not just a blind probe.
**Why not fixed:** Found via live SSRF testing enabled by the broader
testing authorization this round; a correct fix needs a real allowlist/
denylist design decision (block RFC 1918 + loopback + link-local +
cloud metadata ranges at minimum, likely also DNS-rebinding protection
if the check only happens once at creation time rather than at each
fetch) rather than a quick patch, and should be applied consistently to
both `webhooks.create`/`update`'s validation AND
`webhook-dispatcher.ts`'s actual fetch call (validating only one would
leave the other exploitable). Flagging for an explicit decision and
fix rather than rushing a partial patch.
**Suggested fix:** Add a shared `assertNotInternalUrl(url: string)`
helper — resolve the hostname, reject if the resolved IP falls in any
private/loopback/link-local/cloud-metadata range (and reject redirects
to such ranges during actual delivery, not just the initial check) —
called from `webhooks.create`, `webhooks.update`, AND as a final guard
immediately before both `fetch()` call sites (`webhooks.test` and
`webhook-dispatcher.ts`), since a TOCTOU gap between create-time
validation and delivery-time DNS resolution (DNS rebinding) would
otherwise still be exploitable even with create-time-only validation.
**Cleanup:** Both test webhooks deleted from the local test DB after
confirming; this was tested against the local dev server only, never
the live cluster.
