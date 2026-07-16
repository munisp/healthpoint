# HealthPoint IDR Platform — Helm Deployment Guide

This Helm chart deploys the complete HealthPoint IDR platform with all 14 middleware components to a Kubernetes cluster.

## Architecture Overview

```
Internet
   │
   ▼
┌──────────────────────────────────────────────────────────────────────┐
│  APISIX API Gateway (rate limiting, JWT auth, routing)               │
│  OpenAppsec WAF (OWASP protection, API schema validation)            │
└──────────────────────────────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  IDR App (Node.js / tRPC)   │  Go Services   │  Rust Services       │
│  ─ Dispute management       │  ─ Permify      │  ─ Fluvio streams   │
│  ─ Workflow orchestration   │  ─ TigerBeetle  │  ─ Kafka consumers  │
│  ─ Document management      │  ─ Mojaloop     │  ─ Event processing │
└─────────────────────────────────────────────────────────────────────┘
   │
   ├── PostgreSQL (primary data store)
   ├── Redis (caching, session, Redlock)
   ├── Kafka + Dapr (event streaming, pub/sub)
   ├── Fluvio (real-time stream processing)
   ├── Temporal (durable workflow orchestration)
   ├── Keycloak (OIDC identity provider)
   ├── Permify (ReBAC authorization)
   ├── OpenSearch (full-text search + analytics)
   ├── TigerBeetle (double-entry financial ledger)
   ├── Mojaloop (payment interoperability)
   └── MinIO + Iceberg (Lakehouse)
```

## Prerequisites

```bash
# Kubernetes 1.28+
kubectl version

# Helm 3.14+
helm version

# cert-manager (for TLS)
helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager --namespace cert-manager --create-namespace \
  --set installCRDs=true

# Dapr (required before chart install)
helm repo add dapr https://dapr.github.io/helm-charts
helm install dapr dapr/dapr --namespace dapr-system --create-namespace

# APISIX CRDs
helm repo add apisix https://charts.apiseven.com
helm install apisix-ingress-controller apisix/apisix-ingress-controller \
  --namespace ingress-apisix --create-namespace
```

## Quick Start

### 1. Add Helm repositories

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo add opensearch https://opensearch-project.github.io/helm-charts
helm repo add temporal https://go.temporal.io/helm-charts
helm repo update
```

### 2. Update chart dependencies

```bash
cd helm/idr-platform
helm dependency update
```

### 3. Create the secrets

```bash
kubectl create namespace idr

kubectl create secret generic idr-secrets \
  --namespace idr \
  --from-literal=database-url="postgresql://idr:password@postgresql:5432/idr" \
  --from-literal=jwt-secret="$(openssl rand -hex 32)" \
  --from-literal=keycloak-url="http://keycloak:80" \
  --from-literal=keycloak-realm="healthpoint" \
  --from-literal=keycloak-client-id="idr-app" \
  --from-literal=keycloak-client-secret="$(openssl rand -hex 32)" \
  --from-literal=redis-url="redis://redis-master:6379" \
  --from-literal=redis-password="$(openssl rand -hex 16)" \
  --from-literal=kafka-brokers="kafka:9092" \
  --from-literal=opensearch-url="http://opensearch-cluster-master:9200" \
  --from-literal=permify-url="http://permify:3476" \
  --from-literal=permify-database-uri="postgresql://permify:password@postgresql:5432/permify" \
  --from-literal=temporal-host="temporal-frontend:7233" \
  --from-literal=tigerbeetle-addresses="tigerbeetle-0.tigerbeetle:3000,tigerbeetle-1.tigerbeetle:3000,tigerbeetle-2.tigerbeetle:3000" \
  --from-literal=mojaloop-hub-url="http://mojaloop-central-ledger:3001" \
  --from-literal=minio-access-key="minioadmin" \
  --from-literal=minio-secret-key="$(openssl rand -hex 16)"
```

### 4. Install the chart

```bash
helm install idr-platform ./helm/idr-platform \
  --namespace idr \
  --create-namespace \
  --values helm/idr-platform/values.yaml \
  --wait \
  --timeout 20m
```

### 5. Verify deployment

```bash
kubectl get pods -n idr
kubectl get services -n idr
helm status idr-platform -n idr
```

## Production Overrides

Create a `production-values.yaml` for production-specific overrides:

```yaml
app:
  replicaCount: 4
  autoscaling:
    minReplicas: 4
    maxReplicas: 20

kafka:
  replicaCount: 5
  persistence:
    size: 100Gi

opensearch:
  replicas: 5
  persistence:
    size: 200Gi

tigerbeetle:
  replicaCount: 5
  persistence:
    size: 200Gi

postgresql:
  primary:
    persistence:
      size: 100Gi

ingress:
  hosts:
    - host: idr.your-domain.com
      paths:
        - path: /
          pathType: Prefix
          service: app
  tls:
    - secretName: idr-tls
      hosts:
        - idr.your-domain.com
```

```bash
helm upgrade idr-platform ./helm/idr-platform \
  --namespace idr \
  --values helm/idr-platform/values.yaml \
  --values production-values.yaml
```

## Component Endpoints (Internal)

| Service | Internal DNS | Port |
|---|---|---|
| IDR App | `idr-platform-app:3000` | 3000 |
| Go Services | `idr-platform-go-services:8090` | 8090 |
| Rust Services | `idr-platform-rust-services:8091` | 8091 |
| PostgreSQL | `idr-platform-postgresql:5432` | 5432 |
| Redis | `idr-platform-redis-master:6379` | 6379 |
| Kafka | `idr-platform-kafka:9092` | 9092 |
| OpenSearch | `opensearch-cluster-master:9200` | 9200 |
| Keycloak | `idr-platform-keycloak:80` | 80 |
| Temporal Frontend | `idr-platform-temporal-frontend:7233` | 7233 |
| Permify HTTP | `idr-platform-permify:3476` | 3476 |
| Permify gRPC | `idr-platform-permify:3478` | 3478 |
| TigerBeetle | `idr-platform-tigerbeetle:3000` | 3000 |
| Fluvio SC | `idr-platform-fluvio-sc:9003` | 9003 |
| MinIO | `idr-platform-minio:9000` | 9000 |

## Upgrading

```bash
helm upgrade idr-platform ./helm/idr-platform --namespace idr --reuse-values
```

## Uninstalling

```bash
helm uninstall idr-platform --namespace idr
# Note: PVCs are retained by default — delete manually if needed
kubectl delete pvc --all -n idr
```
