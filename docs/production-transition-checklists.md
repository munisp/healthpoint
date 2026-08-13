# HealthPoint Production Transition Checklists

**Status:** Draft operating checklist for a controlled production transition.  
**Scope:** Managed PostgreSQL deployment, regulated provider/FSP sandbox onboarding, mutual-TLS callback contracts, and release verification.  
**Current application posture:** **Local-development and controlled-test only.** The code deliberately fails closed when the database URL is not PostgreSQL, and it does not support live transfer initiation.

> **Important:** This is technical and operational planning, not legal, regulatory, or financial advice. A qualified security lead, privacy counsel, compliance officer, and the selected provider/FSP must approve the contractual and regulated controls before any real-money activity.

## 1. Non-Negotiable Release Rules

HealthPoint must remain in `PAYMENT_EXECUTION_MODE=disabled` until every gate in both checklists is complete, evidenced, and approved. A successful local test, build, or sandbox callback **does not** authorize a production transfer. The current release gate should continue to return `NOT RELEASEABLE` until the managed PostgreSQL deployment, provider contract, mTLS interoperability, settlement-report feed, deployed schedule, and operational drills have real evidence.

| Rule | Required enforcement |
|---|---|
| Database | PostgreSQL only; do not use a MySQL/TiDB URL or local hostname in production. |
| Database transport | Require TLS server verification with `sslmode=verify-full` and a trusted CA certificate. PostgreSQL recommends `verify-full` in security-sensitive environments because it verifies both the chain and hostname.[1] |
| Secrets | Inject by a secret manager or equivalent deployment secret mechanism; never commit them or place them in client assets. |
| Payment execution | `disabled` until a provider-specific sandbox adapter and acceptance evidence exist. The current application accepts only `disabled` or `sandbox`; it intentionally rejects live initiation. |
| External callbacks | Require mTLS at the edge, trusted ingress assertion, timestamped HMAC validation, key ID, replay control, durable idempotency, and immutable callback evidence. |
| Recovery | Treat a restore drill on an isolated target as a release gate, not merely a backup-success metric. |

## 2. Managed PostgreSQL Transition Checklist

### 2.1 Choose and Provision the Production Service

Select a managed service that runs **upstream PostgreSQL** compatible with the project's tested PostgreSQL 16 schema and permits the required extensions, TLS configuration, point-in-time recovery, encrypted backups, network restrictions, and separate non-production environments. The product should be cloud-agnostic at the application layer: HealthPoint needs a standard PostgreSQL URI and does not rely on a vendor-specific query API.

| Check | Owner | Evidence required | Gate |
|---|---|---|---|
| Production, staging, and isolated restore targets are distinct databases/projects. | Platform owner | Network diagram and database identifiers | Required before migration |
| PostgreSQL major version is approved against the application migration chain. | Database owner | `SELECT version();` from staging and production | Required before migration |
| Private network path, firewall/security group, and DNS name are provisioned. | Platform owner | Approved network rule and DNS record | Required before secret injection |
| TLS server certificate chain and CA bundle are available to the application. | Provider/platform owner | CA PEM source and expiry record | Required before connectivity test |
| Automated backups, PITR window, retention, encryption, and restore permissions are documented. | Database owner | Provider settings and recovery objective approval | Required before cutover |
| Monitoring covers availability, connections, storage, replication/backup failures, query saturation, and authentication errors. | SRE owner | Dashboard and alert test | Required before go-live |

### 2.2 Create Least-Privilege Database Roles

Create separate identities rather than reusing a superuser. The exact grants must be reviewed against the final migration set and the managed service's role model.

| Identity | Purpose | Minimum operating rule |
|---|---|---|
| `healthpoint_migrator` | Applies reviewed Drizzle migrations during a controlled deployment. | Time-bound access; not used by the application runtime. |
| `healthpoint_app` | Normal API/runtime reads and writes. | Only application schema privileges; no role creation, database creation, or superuser rights. |
| `healthpoint_backup` | Executes approved backup export or accesses provider backup controls. | No application mutation privileges. |
| `healthpoint_restore` | Restores only to an isolated drill target. | Never receives production-target credentials. |
| `healthpoint_readonly_audit` | Optional reconciliation and audit review. | Read-only, separately authenticated, and logged. |

Record ownership of the `public` schema, default privileges, role rotation procedure, and emergency break-glass approval. Test that `healthpoint_app` cannot execute schema-altering statements or read secret-manager metadata.

### 2.3 Set the Production Environment Contract

Set these values through the deployment platform's secret/configuration facility. Do not put literal values in `.env.example`, compose files, browser code, database rows, tickets, or chat transcripts.

| Variable | Production requirement | Verification |
|---|---|---|
| `NODE_ENV` | Exactly `production`. | `pnpm validate:production-config` succeeds. |
| `DATABASE_URL` | PostgreSQL URI using a managed hostname, non-local host, and `sslmode=verify-full`; supply `sslrootcert` or equivalent trusted CA path. | `psql "$DATABASE_URL" -c 'select version()'`; application health reports database connected. |
| `JWT_SECRET` | At least 32 high-entropy characters; rotate under a controlled session-invalidation plan. | Validator passes; rotation runbook approved. |
| `SETTLEMENT_CALLBACK_KEYRING` | JSON object of versioned key IDs mapped to 32+-character secrets, for example `{"2026-01":"<secret>"}`. | Validator and callback test pass. |
| `SETTLEMENT_MTLS_CLIENT_CA_PEM` | Provider or enterprise trust-anchor PEM, mounted as a secret. | Chain and expiry validation complete. |
| `SETTLEMENT_MTLS_CLIENT_FINGERPRINTS` | Approved provider certificate fingerprint allow-list, in the application’s expected format. | Test callback with known-good and known-bad peer certificate assertions. |
| `SETTLEMENT_MTLS_INGRESS_TOKEN` | 32+-character secret shared only between trusted edge and application. | Direct callback without the edge assertion is rejected. |
| `BACKUP_ENCRYPTION_PASSPHRASE` | 32+-character secret held outside the database and backup storage account. | Encrypted backup and isolated restore drill pass. |
| `INTERNAL_SERVICE_TOKEN` | High-entropy internal service authorization secret. | Sidecar rejects omitted/incorrect token. |
| `EMR_CREDENTIALS_ENCRYPTION_KEY` | Exactly 64 hexadecimal characters for the AES-256-GCM envelope key. | Credential encryption/tamper tests pass. |
| `PAYMENT_EXECUTION_MODE` | `disabled` during database cutover; `sandbox` only after provider sandbox acceptance. | Validator passes. |
| `ALLOW_LOCAL_DATABASE` / `ALLOW_INSECURE_INTERNAL_TRANSPORT` | Unset or `false`. | Validator rejects any insecure override. |

> The application validator rejects a `DATABASE_URL` that is not PostgreSQL, points to `localhost`, `127.0.0.1`, or the compose hostname in production. It also rejects `PAYMENT_EXECUTION_MODE=live`; no configuration change can safely enable live initiation in the current codebase.

**Connection-string pattern** (replace placeholders in the secret store only):

```text
postgresql://healthpoint_app:<url-encoded-password>@pg-prod.example.net:5432/healthpoint?sslmode=verify-full&sslrootcert=/run/secrets/postgres-ca.pem
```

PostgreSQL documents that `verify-full` checks the certificate chain and server hostname; the default `sslmode=prefer` is not recommended for secure deployments.[1]

### 2.4 Rehearse Migration in Staging First

1. Pin the exact Git commit and reviewed migration directory to deploy. Do **not** generate migrations in the production job.
2. Create a fresh staging database from the provider's safe template or an approved masked restore.
3. Set the staging secret contract, using a staging PostgreSQL URI and staging mTLS material only.
4. Run the configuration gate:

   ```bash
   NODE_ENV=production pnpm validate:production-config
   ```

5. Run only the already-reviewed migration set:

   ```bash
   pnpm exec drizzle-kit migrate
   ```

   Do not use the repository's `pnpm db:push` convenience script in production because it invokes migration generation as well as migration execution.
6. Build and start the application from the pinned revision:

   ```bash
   pnpm build
   NODE_ENV=production pnpm start
   ```

7. Confirm `GET /api/health` reports a connected database, then run a read-only SQL inventory, migration-table check, application smoke test, settlement callback rejection test, and scheduled-proof authorization test.
8. Measure migration duration, application warm-up, connection-pool use, lock waits, and error rate. Record the results and rollback decision point.

### 2.5 Backup, Restore, and Cutover Gates

The repository has an encrypted logical backup script at `scripts/db-backup.sh`. It creates a compressed custom `pg_dump` archive, encrypts it with GPG AES-256, and writes checksum metadata. PostgreSQL documents that custom and directory archive formats are designed for selective restore and support flexible restoration; `pg_dump` is a logical export and is not itself a complete regular-production-backup strategy.[2] Use provider PITR/physical backup capabilities in addition to this application-level evidence backup.

| Stage | Exact action | Pass condition |
|---|---|---|
| Pre-cutover backup | `BACKUP_OUTPUT_DIR=/secure/backup/mount ./scripts/db-backup.sh` | Encrypted file and manifest exist; checksums are captured in immutable operational evidence. |
| Archive inspection | `pg_restore --list <decrypted-custom-archive>` | Archive parses; expected schema objects are present. |
| Isolated restore | Set `RESTORE_DATABASE_URL` to a separate restore database and run `ALLOW_DESTRUCTIVE_RESTORE=true ./scripts/db-restore-verify.sh /secure/backup/mount/<backup>.dump.gpg`. | Script rejects equal source/target URLs, restore exits on error, and integrity counts are produced. |
| Provider PITR test | Restore to a separate provider-created target at an approved recovery point. | Application schema/migration state and sampled reconciliation records match expectations. |
| Cutover | Freeze schema changes, take final backup, deploy pinned artifact, run reviewed migrations once, enable new application instances, and drain old instances. | Health, error budget, latency, migration, and database connection checks all meet agreed thresholds. |
| Rollback | Stop new writes if integrity or availability gate fails; revert application artifact and restore/point-in-time recover only under the approved incident runbook. | Incident commander and database owner sign off. |

`pg_restore` can restore custom archives directly into a target database and its `--exit-on-error` option stops on SQL errors; restoring a dump can execute source-superuser-controlled content, so only restore trusted archives.[3]

### 2.6 Post-Cutover Acceptance

Do not promote the release based only on a green HTTP response. Capture the following evidence in the deployment record:

1. Production commit SHA, migration IDs, PostgreSQL version, TLS verification result, and role-grant review.
2. Health/readiness response showing database connectivity without exposing credentials.
3. A completed encrypted backup and isolated restore drill timestamped after production cutover.
4. Baseline connection, latency, lock, query-error, storage, and backup-health dashboards.
5. A controlled disabled-payment settlement workflow run showing maker-checker separation, outbox delivery, reconciliation evidence, and daily proof generation.
6. An incident and rollback owner roster, with provider, platform, database, and security contacts.

## 3. Regulated Provider/FSP Sandbox and mTLS Contract Checklist

This checklist intentionally avoids naming a provider because provider APIs, regulations, geography, rails, onboarding standards, and contractual obligations differ. It is the minimum evidence package to request from the selected regulated provider/FSP and to have reviewed by your organization’s legal, compliance, privacy, security, and operational owners.

### 3.1 Commercial, Legal, and Compliance Intake

| Check | Required artifact | Exit criterion |
|---|---|---|
| Identify the regulated entity and transaction role | Signed architecture and responsibility map: HealthPoint, healthcare organization, payer, provider/FSP, bank/rail, arbitrator, and report source. | Every transfer state has a legally accountable party. |
| Provider due diligence | Licensing/authorization evidence appropriate to jurisdiction and rail; insurance, audited controls, incident history, and subcontractor list. | Compliance/legal approval recorded. |
| Contract | Sandbox and production agreements, service description, fees, settlement timing, reversal/finality rules, dispute handling, SLA, audit/inspection rights, data retention, breach notification, termination, and record export. | Counsel confirms obligations and system behavior align. |
| Privacy and healthcare data | DPA, and BAA or equivalent only if applicable to the actual data flow; data classification and minimization design. | Privacy/security approval and no unnecessary PHI in payment payloads. |
| Financial-crime / sanctions / KYB | Provider-specific onboarding package, beneficial-ownership/business verification, sanctions/AML responsibilities, and escalation paths. | Provider approves sandbox account and required identities. |
| Operational governance | Named maker, checker, release manager, incident commander, reconciliation owner, and 24/7 escalation contacts. | Dual-control and emergency roles are staffed. |

### 3.2 Sandbox Technical Enrollment

Request the following in writing from the provider. Do not infer behavior from a simulator.

1. **Endpoint inventory:** sandbox base URLs, authorization endpoint, token endpoint, callback/report endpoints, IP ranges, DNS names, TLS versions/cipher requirements, maintenance windows, and rate limits.
2. **API contract:** versioned OpenAPI/schema, required and optional fields, idempotency semantics, request/response examples with non-sensitive test data, pagination, time-zone/currency conventions, error taxonomy, retry rules, and deprecation policy.
3. **Settlement semantics:** when a transfer is `accepted`, `settled`, `failed`, `reversed`, or `reconciled`; finality definition; reconciliation window; duplicate/out-of-order report behavior; and whether a provider report can amend a prior state.
4. **Sandbox identities:** non-production client ID, test accounts/participants, test settlement cases, callback registration process, report-feed access, and provider support channel.
5. **Evidence feed:** authoritative report identifiers, event IDs, timestamps, provider transaction IDs, sequence ordering, report retention, export format, and integrity/signature method.
6. **Acceptance plan:** provider-defined scenarios for happy path, duplicate request, timeout, retry, reject, failure, reversal, delayed callback, out-of-order report, partial settlement, reconciliation mismatch, certificate rotation, and incident escalation.

### 3.3 Mutual-TLS Certificate and Callback Contract

RFC 8705 describes mutual TLS as X.509 client authentication and, when supported by the provider, certificate-bound access tokens. It requires the authorization server to reject a client if no expected certificate is presented or if the certificate does not match the registered client configuration.[4] Use the provider's exact policy; do not substitute the local development CA in a provider sandbox.

| Check | HealthPoint-side action | Provider-side evidence |
|---|---|---|
| Trust model | Confirm whether the provider uses a public/enterprise PKI chain or registered self-signed client certificates. | CA bundle, policy, SAN/DN/JWKS registration requirements, revocation method. |
| Certificate generation | Generate private keys in the approved secret/HSM/KMS boundary; record CSR subject/SAN exactly as provider requires. | Signed client certificate, intermediate chain, expiry, and accepted fingerprint. |
| Server verification | Pin the provider CA/hostname policy for outbound calls; use TLS verification, never `skip verify`. | Provider TLS endpoint and certificate chain tested from the deployment network. |
| Client verification | Configure provider CA/fingerprint allow-list at the ingress/edge. | Provider proves a known-good callback and known-bad certificate is rejected. |
| Callback signing | Set a versioned `SETTLEMENT_CALLBACK_KEYRING`; map each provider key ID to an active key. | Provider key IDs, HMAC algorithm, canonicalization, rotation notice, and test vectors. |
| Callback metadata | Require immutable event ID, timestamp, key ID, signature, and raw-body validation. | Provider contract confirms retry, replay, duplicate, and clock-skew behavior. |
| Token binding | If OAuth mTLS is used, require provider documentation for client certificate binding and protected-resource enforcement. | Access token/certificate binding evidence. |
| Rotation | Maintain overlapping old/new certificate and callback-key versions; test both before retiring old material. | Provider acceptance of rotation and emergency revocation process. |

HealthPoint’s callback verifier currently expects these headers:

```text
x-settlement-signature
x-settlement-timestamp
x-settlement-event-id
x-settlement-key-id
```

It signs/verifies the canonical value `timestamp + "." + rawRequestBody` with HMAC-SHA-256, rejects missing/invalid signatures, and defaults to a five-minute timestamp window. The provider contract must explicitly agree to this scheme or a reviewed provider-specific adapter must be implemented and tested. Do not silently translate an incompatible provider callback into an accepted settlement event.

### 3.4 Sandbox Acceptance and Controlled Promotion

Run every case below against the provider sandbox with the actual deployed staging topology and capture provider-visible and HealthPoint-visible evidence.

| Scenario | Required expected result |
|---|---|
| Valid signed callback through mTLS | Exactly one immutable callback record; exactly one state transition/outbox event; provider and HealthPoint IDs correlate. |
| Missing client certificate or invalid fingerprint | Rejected at edge; no application settlement mutation. |
| Invalid HMAC, stale timestamp, unknown key ID, altered body | Rejected; evidence retained without accepting settlement state. |
| Duplicate callback/event ID | Idempotent result; no duplicate ledger/outbox/reconciliation effect. |
| Provider accepts then reports settlement | Transfer moves only through allowed lifecycle states; independent report creates reconciliation evidence. |
| Provider failure/reversal | Failure or reversal state plus immutable compensating ledger/reconciliation evidence; no destructive rewrite. |
| Delayed/out-of-order report | Exception review is created; daily balance proof records the mismatch; reviewer decision is immutable. |
| Certificate/key rotation | Old and new approved versions work during overlap; revoked/retired material fails after cutover. |
| Provider incident simulation | Dual-control pause, alerts, evidence export, and provider escalation meet agreed runbook timings. |

### 3.5 Production Promotion Gate

Production promotion requires all of the following, signed off by named owners:

1. Managed PostgreSQL checklist complete, including production backup/PITR and restore evidence.
2. Provider/FSP sandbox acceptance complete for every scenario above; the provider has approved the production credential request.
3. Provider-issued production mTLS materials and callback/report contracts are installed through the production secret mechanism and verified from the production network.
4. A provider-specific execution adapter has been designed, peer-reviewed, tested, and formally enabled. **The current code does not satisfy this item because live initiation is intentionally unsupported.**
5. Maker-checker, daily balance proof, reconciliation, exception review, audit export, monitoring, alerting, incident response, and rollback owners complete a tabletop exercise.
6. Legal/compliance/security approval confirms that the actual geographic, healthcare, privacy, funds-flow, record-retention, and licensing obligations are met.
7. The release gate changes only when each material claim has independent evidence; no operator should override it based on schedule pressure.

## 4. Evidence Pack Template

Create a controlled deployment record containing:

| Item | Record |
|---|---|
| Software | Git SHA, container digest, signed artifact reference, dependency lockfile hash, migration IDs. |
| Database | PostgreSQL version, URI redacted to hostname, TLS verification output, role/grant review, backup/PITR configuration, restore-drill evidence. |
| Provider | Contract version, sandbox ticket, endpoints, test account identifiers, mTLS certificate serial/fingerprint/expiry, callback/report contract version. |
| Tests | Results for all sandbox acceptance cases, local regression suite, recovery drill, load drill, failure/reversal and reconciliation evidence. |
| Operations | Dashboard URLs, alert test evidence, on-call roster, incident runbook, rollback decision owner, dual-control approvers. |
| Decision | Explicit `GO`, `NO-GO`, or `CONDITIONAL GO` with open risks, expiry of approval, and signatories. |

## 5. Current Practical Next Step

Because no production dependencies are currently available, the correct next step is to keep `PAYMENT_EXECUTION_MODE=disabled`, retain the local PostgreSQL development setup, and use this checklist to obtain a provider/FSP sandbox and a managed PostgreSQL service. Do not create synthetic production evidence or set a live execution flag to bypass the release gate.

## References

[1]: https://www.postgresql.org/docs/current/libpq-ssl.html "PostgreSQL: SSL Support"
[2]: https://www.postgresql.org/docs/current/app-pgdump.html "PostgreSQL: pg_dump"
[3]: https://www.postgresql.org/docs/current/app-pgrestore.html "PostgreSQL: pg_restore"
[4]: https://datatracker.ietf.org/doc/html/rfc8705 "RFC 8705: OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens"
