# ci/ — GitHub Actions workflow pending manual installation

**Why this file exists:** the automation token used by the remediation pipeline
lacks the `workflow` OAuth scope, so pushing to `.github/workflows/` returns
HTTP 403. The CI pipeline definition therefore lives here until a maintainer
copies it into place.

## Install (one-time, requires `workflow` scope)

```bash
mkdir -p .github/workflows
cp ci/github-actions.ci.yml .github/workflows/ci.yml
git add .github/workflows/ci.yml
git commit -m "ci: enable CI pipeline"
git push
```

No edits are needed — the file is a complete, self-contained workflow.

## What the workflow does

| Job | Steps |
| --- | --- |
| `node` | `pnpm install --frozen-lockfile` → `pnpm check` (tsc --noEmit) → vitest unit suite (live-infra connectivity suites excluded, they need running Redis/Kafka/Permify/TigerBeetle) → `pnpm build` (client + server) |
| `python` | `python -m compileall` over `ai-service`, `services`, `scripts`, and root-level `*.py` |
| `go` | `go build ./...` + `go vet ./...` in `services/go` (module cache enabled) |
| `rust` | `cargo check` in `services/rust` (Swatinem/rust-cache) |
| `integration` | postgres:16-alpine + redis:7-alpine service containers → `RUN_INTEGRATION=1 pnpm vitest run server/tests/integration` (the harness applies drizzle migrations itself) |
| `gitleaks` | gitleaks-action@v2 full-history secret scan |

Triggers: pushes to `main` and `assurance/**`, and PRs to `main`.
