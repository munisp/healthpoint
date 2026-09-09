# Legacy / Quarantined Artifacts

**Quarantine record — 2026-09-05 assurance audit (branch `assurance/remediation-2026-09-05`).**

The files listed below were removed from the repository tree because the
2026-09-05 assurance audit (codebase verified at commit `642b193` on `main`)
found them to be **orphaned, undeployed dead code** that is nevertheless
dangerous if ever executed. They were not referenced by `docker-compose.yml`,
any referenced Dockerfile, any GitHub workflow, `kubernetes/`, `helm/`,
`services/`, or `server/`. Removal (not archival of full contents) is the
approved remediation; see `assurance/remediation-ledger.md` for the complete
ledger with evidence.

## Last functional copy

The last functional copy of every removed file lives in git history at:

- **commit `642b193bb131f1af7835426425a41c87088fb012` on `main`**

Retrieve any file read-only via, e.g.:
`git show 642b193:flexible_refund_processing_service.py`

**Restoration is prohibited until the cited security findings are remediated
and re-audited.** These files must never be restored as-is.

## A. Phantom / unsecured money-movement services (CRITICAL/HIGH)

| Finding | File removed | Why |
| --- | --- | --- |
| AUDIT-A1 (CRITICAL) | `flexible_refund_processing_service.py` | Fabricates ACH/wire transaction IDs from `uuid4()` with no real payment-rail integration (e.g. lines 602, 622, 646) — fake money-movement records. |
| AUDIT-A2 (CRITICAL) | `administrative_fee_payment_service.py` | Unauthenticated Stripe webhook (`/webhooks/stripe`, line 736) flips payments to `COMPLETED` with no signature verification ("Verify webhook signature in production" TODO, line 740). |
| AUDIT-A3 (HIGH) | `admin_fee_management_service.py` | Hardcoded admin token `admin-token-123` (line 216); CORS `allow_origins=["*"]` (line 29). |
| AUDIT-A4 (HIGH) | `admin_fee_management_service_enhanced.py` | Hardcoded admin token `admin-token-123` (line 97); CORS `allow_origins=["*"]` (line 32). |
| AUDIT-A5 (HIGH) | `enhanced_billing_service.py` | In-memory invoice/fee stores (`transaction_costs = {}`, `invoices = {}`, line ~206-209) — phantom billing records lost on restart. |
| AUDIT-A6 (HIGH) | `search_analytics_service.py` | SQL injection: filter field names interpolated into SQL via f-string (`sql += f" AND {field} = ${param_count}"`, line 510); CORS `*` (line 911). |
| AUDIT-A7 (HIGH) | `integration-plumbing-implementation.py` | Hardcoded JWT signing secret `healthpoint_secret_key_change_in_production` used to both sign (line 384-386) and verify (line 531-532) partner API keys. |
| AUDIT-A8 (HIGH) | `backend/middleware/mojaloop_client.py` | Fail-open fake-JWS Mojaloop client: sends unsigned requests when `MOJALOOP_JWS_KEY` unset (`_sign_request` returns `""`, lines 67-69); silently falls back to local PostgreSQL "SIMULATED" transfers. Entire `backend/` tree confirmed orphaned. |

## B. Broken / fraudulent deployment automation (CRITICAL/HIGH)

| Finding | File removed | Why |
| --- | --- | --- |
| AUDIT-B1 (CRITICAL) | `deploy.sh` | Deploys ~19 compose services that do not exist in `docker-compose.yml` (lines 183-205); writes `.env` with hardcoded passwords (`POSTGRES_PASSWORD=healthpass123`, line 85); advertises `admin`/`admin123` credentials (line 284). |
| AUDIT-B2 (CRITICAL) | `deploy-all-services.sh` | Launches uvicorn with hyphenated module names (guaranteed `ImportError`, lines 148-159); hardcoded `JWT_SECRET_KEY=healthcare-platform-super-secret-jwt-key-2025` (lines 114, 207); silently downgrades the database to SQLite (line 203). |
| AUDIT-B3 (HIGH) | `unified_deployment_script.sh` | Third, mutually inconsistent deployment topology (supervisor + port-scan service discovery, ports 8001-8017). |
| AUDIT-B4 (HIGH) | `Dockerfile.admin-fee` | Runs as root, `COPY . .` whole-repo context (line 8), unreferenced by any compose file or workflow. |
| AUDIT-B5 (HIGH) | `Dockerfile.ai-fraud` | Copies pickle-vulnerable fraud service (`ai_fraud_detection_service_enhanced.py`, line 30); unreferenced by any compose file or workflow. |
| AUDIT-B6 (MEDIUM) | `start-ai-fraud-detection-service.sh`, `start-api-gateway-service.sh`, `start-authentication-service.sh`, `start-claims-processing-service.sh`, `start-document-verification-service.sh`, `start-enhanced-user-management-service.sh`, `start-kyb-verification-service.sh`, `start-notification-service.sh`, `start-provider-management-service.sh`, `start-search-analytics-service.sh`, `start-user-management-service.sh` | 11 generated artifacts of the broken `deploy-all-services.sh`; hardcode `/home/ubuntu/healthcare-platform-complete` paths and reference the nonexistent deployment layout. |

## Reference-check methodology

Before each deletion, GitHub code search across the repo confirmed **zero
references** from deployed units (compose files, referenced Dockerfiles,
`.github/` workflows, `kubernetes/`, `helm/`, `services/`, `server/`).
Remaining references are documentation-only mentions (which are being
retracted or annotated separately) and non-deployed helper scripts under
`scripts/` owned by other remediation tracks.
