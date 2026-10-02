# Risks & Unverified Areas — healthpoint-idr

## Unverified (not tested, not claimed as working)
- Authz/IDOR enforcement under real multi-user, multi-role conditions
  (code reviewed, not yet exercised live).
- Financial correctness of `ledger`/`qpa` calculations.
- TigerBeetle integration (feature-flagged off locally; untested).
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
