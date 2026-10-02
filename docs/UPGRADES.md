# Upgrade & Image Pinning Workflow

## Policy

Every container image deployed from this repo must be referenced by an
**immutable** identifier:

1. First-party images (`healthpoint/*`): tag = release version (chart
   `appVersion`), and in production additionally pin `digest`.
2. Third-party images: explicit version tag, and in production the registry
   digest (`image@sha256:...`).

Mutable tags (`latest`, `3.5`, `16-alpine`-style floating aliases) are fine
for local development only. They are **release-blocking** for production.

## How to pin a digest (requires registry access)

```bash
# Resolve the current digest for a tag
 docker buildx imagetools inspect ghcr.io/permify/permify:v1.4.5 \
   --format '{{.Manifest.Digest}}'
# or
crane digest ghcr.io/permify/permify:v1.4.5
```

Then set it:

- **Helm**: `deploy/helm/healthpoint/values.yaml` → `<component>.image.digest: "sha256:..."`
  (digest wins over tag; see `templates/_helpers.tpl` → `healthpoint.image`).
- **Compose**: `image: ghcr.io/permify/permify:v1.4.5@sha256:<digest>`.

Commit the digest with a message like `chore(deps): pin permify v1.4.5 digest`.

## Currently unpinned (owner action required with registry access)

These still carry mutable tags and must be pinned before any release:

| Image | Where | Current tag |
|---|---|---|
| `ghcr.io/permify/permify` | docker-compose.yml | `latest` |
| `ghcr.io/tigerbeetle/tigerbeetle` | docker-compose.yml | `latest` (app uses tigerbeetle-node 0.16.66 — align) |
| `minio/minio`, `minio/mc` | docker-compose.yml | `latest` |
| `mojaloop/simulator` | docker-compose.yml | `latest` (simulation profile only) |
| `openappsec/nginx` | docker-compose.yml | `latest` |
| `openappsec/agent`, `ghcr.io/permify/permify`, `ghcr.io/tigerbeetle/tigerbeetle` | middleware/docker-compose.production.yml (legacy) | `latest` |
| `healthpoint/*` first-party images | deploy/helm/healthpoint/values.yaml | defaults to chart appVersion; set `digest` in prod |

Dapr (`daprio/*`) and Fluvio (`infinyon/fluvio`) images were removed with
those stacks — do not reintroduce them unpinned.

## Upgrade procedure (per component)

1. Choose the new version; read its changelog (pay attention to Kafka
   inter-broker protocol, PostgreSQL major upgrades, Keycloak realm import
   changes, TigerBeetle data-file format flags).
2. Resolve and record the digest (above).
3. Upgrade in a staging environment first: `docker compose up -d <svc>` or
   `helm upgrade <release> deploy/helm/healthpoint -f values-staging.yaml`.
4. Verify `/healthz` and `/readyz` on the server and the compose
   `healthcheck`s for infrastructure.
5. For datastores, follow the operator/chart upgrade runbooks (bitnami
   charts document this under "Upgrading"); take backups/snapshots first.
6. Promote to production with the pinned digest; keep the previous digest in
   the commit history for rollback.

## Automation suggestion

Enable Renovate (or Dependabot for Docker) with digest pinning enabled so tag
bumps arrive as PRs with digests pre-resolved.
