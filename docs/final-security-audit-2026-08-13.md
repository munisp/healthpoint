# Final Security Audit and Vulnerability Scan — 2026-08-13

## Scope and Revision

This audit covers the active HealthPoint workspace derived from GitHub `main`, including Node, Python, and Go services; deployment topology; settlement controls; container configuration; and dependency supply-chain checks. It is an **evidence-based engineering audit**, not an authorization to process real money or a substitute for an independent penetration test, regulatory review, or provider certification.

## Executive Result

| Decision | Result |
|---|---|
| Repository-controlled critical/high Node dependency findings | **Remediated to 0 critical / 0 high** |
| Functional regression checks | **Passed: TypeScript, 163 Vitest tests, production build, Python syntax** |
| Python dependency audit | **Passed: no known vulnerabilities in `ai-service/requirements.txt`** |
| Go test and vulnerability scan | **Not completed in this sandbox**; the required Go 1.24 toolchain and modules did not finish downloading after three bounded attempts |
| Container build and Compose parse | **Not completed in this sandbox** because Docker is unavailable |
| Production / real-money release | **Blocked** pending external environment, provider, scheduler, container, and independent security evidence |

> **Release posture:** The repository may proceed to controlled deployment preparation only. Real-money initiation remains disabled, and no production release is authorized by this report.

## Verified Findings and Remediation

| ID | Severity before remediation | Finding | Remediation | Verification |
|---|---:|---|---|---|
| DEP-01 | Critical / High | `pnpm audit` initially reported 3 critical and 49 high findings across AWS SDK, tRPC, Axios, Drizzle, Vite/Vitest, Tailwind, Dapr, and transitive packages. | Upgraded direct dependency roots; added a patched Lodash override for Recharts compatibility; added `pnpm audit:dependencies` gate. | Final audit: 0 critical, 0 high, 1 moderate, 0 low. |
| APP-01 | High | The AI service allowed wildcard CORS together with credentials. | Production requires explicit `AI_ALLOWED_ORIGINS`; wildcard origins are rejected; documentation endpoints are disabled in production. | Python syntax check passed. |
| CTR-01 | Medium | The application image used a single build/runtime stage and ran as root. | Added a multi-stage image, minimal runtime copy, non-root `healthpoint` user, and `.dockerignore`. | Build source passes; Docker image build is still a required external release gate. |
| DEP-02 | Medium | No repository-enforced recurring dependency gate or static security workflow existed. | Added `pnpm audit:dependencies`, scheduled GitHub Actions Node/Python/Go/CodeQL gates, and a reusable audit summary script. | Workflow committed for CI execution; CI run is required before release. |
| TOP-01 | Medium | The development compose topology intentionally exposes simulators and insecure local defaults. | Added `docker-compose.deploy.yml`, which is separate from development compose, has no local data stores, requires immutable image references, runs read-only/non-root with dropped capabilities, and requires external managed endpoints. | Docker compose parse remains an external release gate because Docker is unavailable here. |

## Residual Findings and Required Decisions

| ID | Severity | Status | Required action |
|---|---:|---|---|
| DEP-03 | Moderate | One Node advisory remains after remediation. | Review the final `pnpm audit --json` result during release approval. Do not waive a finding without a documented exploitability and compensating-control assessment. |
| GO-01 | High assurance gap | Go static and vulnerability scan is unverified in this sandbox. | Execute `go vet ./...`, `go test ./...`, and `govulncheck ./...` in CI using Go 1.24 before release. |
| CTR-02 | High assurance gap | The hardened image and deploy Compose topology could not be built or parsed locally. | Run `docker build --pull --no-cache` and `docker compose -f docker-compose.deploy.yml config` in CI/staging. |
| EXT-01 | Critical release blocker | Managed PostgreSQL, provider/FSP sandbox, mTLS certificates, settlement-report contract, and deployed scheduler evidence are absent. | Follow `docs/production-transition-checklists.md`; retain `PAYMENT_EXECUTION_MODE=disabled` until evidence is independently verified. |
| OPS-01 | Critical release blocker | No independent penetration test, disaster-recovery exercise in the actual managed environment, or operator sign-off exists. | Obtain security, operations, and regulated-provider approval before production promotion. |

## Reproducible Security Gates

```bash
pnpm install --frozen-lockfile
pnpm audit:dependencies
pnpm check
pnpm test
pnpm build
python3 -m py_compile ai-service/main.py
pip-audit --requirement ai-service/requirements.txt --strict
(cd services/go && go vet ./... && go test ./... && govulncheck ./...)
docker build --pull --no-cache -t healthpoint:<immutable-release> .
docker compose -f docker-compose.deploy.yml --env-file <injected-env-file> config
```

The last three commands were not fully completed in this sandbox; they are mandatory staging/CI release gates, not optional suggestions.
