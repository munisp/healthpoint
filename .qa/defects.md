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
