# HealthPoint IDR Platform — Helm (LEGACY chart)

> **Status: legacy / reference only.** The supported Helm chart is
> [`deploy/helm/healthpoint/`](../deploy/helm/healthpoint/) — pinned images
> (no `:latest`), no Dapr/Fluvio, secrets referenced by name only. The chart
> in this directory (`helm/idr-platform`) predates the 2026-09-05 remediation
> and still contains rough edges (e.g. it vendors datastore subcharts inline).
> Prefer the new chart for any real deployment.
>
> Dapr and Fluvio were removed from the platform (orphan infrastructure);
> their templates and values have been deleted from this chart.

## What this chart deploys

Application Deployments (app, go-services, rust-services, temporal-worker,
lakehouse), Permify, TigerBeetle StatefulSet, Caddy edge layer, plus datastore
subchart configuration via `values.yaml` (bitnami-style values for postgresql,
kafka, redis, opensearch, keycloak, temporal, minio, apisix).

## Usage (if you must)

```bash
kubectl create namespace idr

# Secrets are required first — the chart ships only an empty placeholder
# (helm/idr-platform/templates/infrastructure.yaml). Prefer the pattern in
# docs/SECRETS.md (sealed-secrets / external-secrets).
kubectl create secret generic idr-secrets --namespace idr \
  --from-literal=database-url="postgresql://idr:CHANGE_ME@postgresql:5432/idr" \
  --from-literal=jwt-secret="CHANGE_ME" \
  --from-literal=keycloak-url="http://keycloak:80" \
  --from-literal=keycloak-realm="healthpoint" \
  --from-literal=keycloak-client-id="idr-app" \
  --from-literal=keycloak-client-secret="CHANGE_ME" \
  --from-literal=redis-url="redis://redis-master:6379" \
  --from-literal=kafka-brokers="kafka:9092" \
  --from-literal=opensearch-url="http://opensearch-cluster-master:9200" \
  --from-literal=permify-url="http://permify:3476" \
  --from-literal=permify-database-uri="postgresql://permify:CHANGE_ME@postgresql:5432/permify" \
  --from-literal=temporal-host="temporal-frontend:7233" \
  --from-literal=tigerbeetle-addresses="tigerbeetle:3000" \
  --from-literal=mojaloop-hub-url="http://mojaloop-central-ledger:3001" \
  --from-literal=minio-access-key="CHANGE_ME" \
  --from-literal=minio-secret-key="CHANGE_ME"

# Image tags in values.yaml are intentionally empty — set immutable tags or
# digests for every healthpoint/* image before installing.
helm install idr-platform ./helm/idr-platform \
  --namespace idr \
  --set app.image.tag=<immutable-tag> \
  --set goServices.image.tag=<immutable-tag> \
  --set rustServices.image.tag=<immutable-tag> \
  --set temporalWorker.image.tag=<immutable-tag> \
  --set lakehousePipeline.image.tag=<immutable-tag>
```

## Component endpoints (internal)

| Service | Internal DNS | Port |
|---|---|---|
| IDR App | `idr-platform-app:3000` | 3000 |
| Go Services | `idr-platform-go-services:8090` | 8090 |
| Rust Services | `idr-platform-rust-services:8091` | 8091 |
| Permify HTTP/gRPC | `idr-platform-permify` | 3476/3478 |
| TigerBeetle | `idr-platform-tigerbeetle:3000` | 3000 |
| Caddy edge | LoadBalancer | 80/443 + L4 mTLS (Kafka 9093, Temporal 7234, TigerBeetle 3001, Redis 6380, OpenSearch 9201) |

## Uninstalling

```bash
helm uninstall idr-platform --namespace idr
kubectl delete pvc --all -n idr   # PVCs are retained by default
```
