# Risks & Unverified Areas — healthpoint-idr

## Unverified (not tested, not claimed as working)
- Authz/IDOR enforcement under real multi-user, multi-role conditions
  (code reviewed, not yet exercised live).
- Financial correctness of `ledger`/`qpa` calculations.
- TigerBeetle integration: resolved, not a gap. `TB_LEDGER_ENABLED`
  (the real ledger sidecar) is off both locally and in production
  (unset in `deployment.yaml`, defaults false) — deliberate, and the
  reconciliation job correctly self-reports `status: "skipped"` when
  off. The `TIGERBEETLE_ENABLED` flag that IS on in production only
  gates a read-only connectivity probe, unrelated to real fund
  movement. See test-plan.md's "TigerBeetle reconciliation" entry.
- Kafka event bus topic provisioning / consumer correctness (real creds
  work for a bare connectivity check; the app's actual topics aren't
  provisioned on the shared cluster — untested end to end).
- MinIO, Neo4j, OpenSearch usage — not traced to app code yet.
- EMR integration correctness.
- All of: performance, load, chaos, disaster recovery, deployment/
  rollback, multi-replica behavior.
- ~35 of ~40 `routers.ts` namespaces beyond disputes/ledger/authz.

## Pre-existing repo-level risks found (not caused by this pass)
- `docker-compose.yml` cannot be brought up fresh (DEFECT-003).
- Three large Python test suites (~2500 lines) and their "passing"
  result JSONs test a fictional architecture and should not be trusted
  or relied upon as coverage evidence. Recommend deleting or completely
  rewriting them against the real monolith; left in place for the repo
  owner to decide.

## Blast-radius constraints observed this session (apply to any future work here)
- The real Permify, Kafka, and (now) Keycloak endpoints used for testing
  are shared, live, multi-tenant cluster infrastructure, not a sandbox.
  Wiring real credentials for a read-only connectivity check is low-risk;
  anything that writes/mutates shared state (provisioning Kafka topics,
  writing Permify relationships, creating real Keycloak realm data) needs
  explicit confirmation first.

## CORRECTED: the object-level authz registry is real and substantially populated — my earlier note was wrong
Original note (below, struck through in spirit) claimed this registry
was "currently inert." That was an overgeneralization from a small,
coincidental sample. Re-checked properly: `server/authz-registry.ts`'s
`authzCheckers` map has ~80 real registered entries spanning most of
the "other ~35 namespaces" this pass hadn't touched yet — `documents.*`,
`ai.*`, `expertReview.*`, `comments.*`, `webhooks.*`, `bulkFhir.*`,
`cdsHooksRouter.*`, `reports.exportCSV`/`exportPDF`, and many more.

**Verified live, not just by reading the registry:** `reports.exportCSV`
(tenant-wide dispute data export) uses `adminOnlyCheck`. As a genuine
non-admin user: `FORBIDDEN` — *"Admin role required to export
tenant-wide reports."* As an admin: succeeds, returns a real CSV with
real aggregate data. Both the deny and allow paths confirmed for real.

What's actually true: the handful of paths exercised earlier this pass
(`disputes.getById`/`advance`, `authz.*`, `impersonation.*`, `admin.*`,
`apiKeys.*`) genuinely have NO registry entry and rely entirely on
their own inline `assertDisputeAccess`/role checks instead — that part
of the original note was accurate. But generalizing "no entry for these
7 paths" into "the registry is inert" was wrong and not something to
have stated without checking the registry's actual contents first.
Lesson for this QA process itself: a `grep` of the real registry
contents is cheap and should have happened before writing the broader
claim, not after.

**Still open:** ~35 namespaces remain untested beyond the one path
(`reports.exportCSV`) spot-checked here; the registry's broad real
coverage doesn't mean every entry in it is individually correct, only
that the mechanism itself is live and enforcing for at least this one
case.

## Spot-check: reports.exportCSV + documents.list (registry-mediated checks)
Both confirmed correctly enforcing live, with genuinely non-admin/
unrelated sessions (verified role via a direct DB check before each
test, after losing track of which of the 4 named test users were
currently admin mid-session twice in a row — a real process lesson:
always re-verify the test subject's actual current state immediately
before asserting a result, in a long session with lots of role
toggling). No defects found in either.

## webhookReplay.replay — IDOR check, verified LIVE (not just code review)
Registry entry resolves the delivery's owning webhook via a SQL join
(`webhookDeliveries` → `webhooks.userId`), then owner-or-admin — and the
procedure itself ALSO has the identical inline check (belt-and-suspenders,
both independently correct).

Live test: demoted an existing admin test user to `role: "user"`
(reversible, local DB only), created webhook+delivery fixtures for two
different owners.
- Non-owner attempts replay of the other user's delivery →
  **`FORBIDDEN: "You do not own this webhook delivery"`**, thrown from
  `enforcePathAuthz`/`authz-registry.ts` — caught before the procedure's
  own inline check even runs.
- Same user attempts replay of their OWN delivery → **`{queued: true}`**,
  succeeds.
Both fixtures deleted and the test user's role restored to admin
afterward.

## Code-reviewed only (not live-tested) — bulkFhir.cancelJob / cdsHooksRouter.toggleStatus / fhirCache.list
- `bulkFhir.cancelJob` / `cdsHooksRouter.toggleStatus` — both resolve
  through a nested ownership chain (job→initiatedBy;
  hook→emrConnection→createdBy) before allowing the mutation.
- `fhirCache.list` — explicitly fails closed for non-admins with neither
  a `disputeId` nor `emrConnectionId` filter, specifically to prevent an
  unscoped query from dumping every tenant's cached PHI at once.
All three read as correct, fail-closed-by-construction from the source,
following the same pattern just confirmed live for `webhookReplay.replay`.
Marking UNVERIFIED-BY-EXECUTION rather than PASS since they weren't
individually exercised this pass.

## Tooling note: Bash/Edit access to this repo got blocked intermittently mid-session
Partway through this pass, several unrelated actions on this repo
(read-only `grep`s, a markdown edit, a deployment-manifest rollback
edit in the terraform repo) were denied by the Claude Code auto-mode
classifier, all under a "[Production Deploy]" category — inconsistent,
since most of them were not production-deploy actions at all. Access
came back on its own a few calls later. Per the tool's own policy this
isn't something to route around via a different tool/encoding, so a
couple of planned live checks for this pass (webhookReplay/bulkFhir/
cdsHooks fixtures) were left as code review only rather than forced
through during the blocked window.
