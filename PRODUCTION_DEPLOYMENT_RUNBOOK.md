# HealthPoint NSA/IDR Platform — Production Deployment Runbook

**Version:** 3.0 | **Last Updated:** 2024-01-04 | **Status:** Ready for Production Deployment

This runbook covers every step required to bring the HealthPoint platform from a fresh Kubernetes cluster to a fully operational production environment. Execute steps in order. Do not skip any step.

---

## Prerequisites

| Requirement | Minimum Spec |
|---|---|
| Kubernetes cluster | 1.28+, 3 control-plane nodes, 6+ worker nodes |
| Worker node size | 8 vCPU, 32 GB RAM, 500 GB NVMe SSD |
| PostgreSQL | 16.x, 3-node HA (Patroni or CloudNativePG) |
| Redis | 7.x, 3-node Sentinel or Cluster mode |
| Kafka | 3.x, 3 brokers, 3 ZooKeeper nodes |
| Container registry | GHCR or private registry at `ghcr.io/munisp/healthpoint` |
| Domain | `healthpoint.io` with wildcard TLS cert |
| AWS S3 | Bucket `healthpoint-fhir-exports` in target region |

---

## Step 1: Build and Push All Docker Images

```bash
# Set your registry and tag
export REGISTRY=ghcr.io/munisp/healthpoint
export IMAGE_TAG=$(git rev-parse --short HEAD)

# Authenticate to GHCR
echo $GITHUB_TOKEN | docker login ghcr.io -u munisp --password-stdin

# Build and push all 52 service images
cd /path/to/healthpoint-repo
chmod +x scripts/build_and_push_images.sh
./scripts/build_and_push_images.sh

# Verify images are available
docker manifest inspect $REGISTRY/nsa-idr-dispute-service:$IMAGE_TAG
```

**Expected output:** All 52 images pushed successfully. Build time: ~45 minutes on 8-core machine.

---

## Step 2: Create Kubernetes Namespaces and RBAC

```bash
kubectl apply -f kubernetes/namespaces/namespaces.yaml
kubectl apply -f kubernetes/rbac/rbac.yaml

# Verify
kubectl get namespaces | grep healthpoint
# Expected: healthpoint-core, healthpoint-integration, healthpoint-middleware, healthpoint-monitoring
```

---

## Step 3: Initialize HashiCorp Vault (HA Raft, 3 nodes)

```bash
# Deploy Vault StatefulSet
kubectl apply -f infrastructure/vault/vault-statefulset.yaml

# Wait for pods to be Running
kubectl -n healthpoint-middleware wait pod -l app=vault --for=condition=Ready --timeout=120s

# Initialize Vault (run ONCE — save output securely)
kubectl -n healthpoint-middleware exec vault-0 -- vault operator init \
  -key-shares=5 \
  -key-threshold=3 \
  -format=json > /secure/vault-init-keys.json

# CRITICAL: Store vault-init-keys.json in a secure offline location (e.g., HSM or sealed envelope)

# Unseal all 3 nodes (use 3 of the 5 keys)
for i in 0 1 2; do
  for key in $(jq -r '.unseal_keys_b64[0:3][]' /secure/vault-init-keys.json); do
    kubectl -n healthpoint-middleware exec vault-$i -- vault operator unseal $key
  done
done

# Verify Vault cluster is active
kubectl -n healthpoint-middleware exec vault-0 -- vault status

# Run the full provisioning script (creates policies, roles, secrets)
export VAULT_ROOT_TOKEN=$(jq -r '.root_token' /secure/vault-init-keys.json)
chmod +x infrastructure/vault/vault_init.sh
VAULT_ADDR=https://vault.healthpoint-middleware.svc.cluster.local:8200 \
  VAULT_TOKEN=$VAULT_ROOT_TOKEN \
  ./infrastructure/vault/vault_init.sh
```

**Vault provisioning creates:**
- AppRole auth for all 52 services
- Dynamic PostgreSQL credentials (15-minute TTL)
- KV secrets: Stripe, Twilio, SMTP, Keycloak client secrets, JWT signing key
- Policies: `healthpoint-services`, `healthpoint-admin`, `healthpoint-readonly`

---

## Step 4: Deploy PostgreSQL (Primary + 2 Replicas)

```bash
# Apply PgBouncer and PostgreSQL configs
kubectl apply -f infrastructure/pgbouncer/pgbouncer.yaml

# Run database initialization
export DB_URL="postgresql://admin:$(vault kv get -field=password secret/healthpoint/postgres)@postgres-primary:5432/healthpoint"

# Run Alembic migrations (creates all 26 tables)
cd /path/to/healthpoint-repo
pip install alembic asyncpg sqlalchemy
DATABASE_URL=$DB_URL alembic upgrade head

# Verify all migrations applied
DATABASE_URL=$DB_URL alembic current
# Expected: 20240104_0004_medplum_emr_connector (head)

# Verify table count
psql $DB_URL -c "\dt" | wc -l
# Expected: ~30 tables (26 app tables + system tables)
```

---

## Step 5: Deploy Keycloak with HealthPoint Realm

```bash
# Keycloak is included in docker-compose.production.yml
# For Kubernetes, deploy via Helm:
helm repo add codecentric https://codecentric.github.io/helm-charts
helm install keycloak codecentric/keycloak \
  --namespace healthpoint-middleware \
  --set postgresql.enabled=false \
  --set externalDatabase.host=postgres-primary \
  --set externalDatabase.database=keycloak \
  --set externalDatabase.user=keycloak \
  --set externalDatabase.password=$(vault kv get -field=keycloak_db_password secret/healthpoint/postgres)

# Wait for Keycloak to be ready
kubectl -n healthpoint-middleware wait pod -l app.kubernetes.io/name=keycloak \
  --for=condition=Ready --timeout=300s

# Import the HealthPoint realm
KEYCLOAK_URL=https://auth.healthpoint.io
ADMIN_PASSWORD=$(vault kv get -field=keycloak_admin_password secret/healthpoint/keycloak)

# Get admin token
TOKEN=$(curl -s -X POST "$KEYCLOAK_URL/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli&grant_type=password&username=admin&password=$ADMIN_PASSWORD" \
  | jq -r '.access_token')

# Import realm
curl -s -X POST "$KEYCLOAK_URL/admin/realms" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @middleware/keycloak/realm-export.json

# Verify realm imported
curl -s "$KEYCLOAK_URL/realms/healthpoint" | jq '.realm'
# Expected: "healthpoint"
```

---

## Step 6: Deploy Medplum FHIR Server

```bash
# Deploy Medplum StatefulSet
kubectl apply -f infrastructure/medplum/medplum-statefulset.yaml

# Wait for Medplum to be ready
kubectl -n healthpoint-core wait pod -l app=medplum --for=condition=Ready --timeout=180s

# Initialize Medplum superadmin
MEDPLUM_URL=https://fhir.healthpoint.io
curl -s -X POST "$MEDPLUM_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "HealthPoint",
    "lastName": "Admin",
    "email": "admin@healthpoint.io",
    "password": "'$(vault kv get -field=medplum_admin_password secret/healthpoint/medplum)'",
    "projectName": "HealthPoint NSA/IDR"
  }'

# Get superadmin token and create service account client
# (See medplum/config/medplum.config.json for client_id)

# Deploy Medplum Bots
cd medplum/bots
npm install
npx medplum deploy-bot idr-workflow-bot.ts
npx medplum deploy-bot payment-reconciliation-bot.ts
npx medplum deploy-bot appeal-status-bot.ts

# Verify bots deployed
curl -s -H "Authorization: Bearer $MEDPLUM_TOKEN" \
  "$MEDPLUM_URL/fhir/R4/Bot" | jq '.total'
# Expected: 3
```

---

## Step 7: Deploy All Application Services

```bash
# Apply ConfigMaps and ExternalSecrets
kubectl apply -f kubernetes/configmaps/platform-config.yaml
kubectl apply -f kubernetes/secrets/external-secrets.yaml

# Deploy all services
kubectl apply -f kubernetes/deployments/core-services.yaml

# Deploy Kubernetes Services (ClusterIP/LoadBalancer)
kubectl apply -f kubernetes/services/core-services.yaml

# Deploy Ingress with TLS
kubectl apply -f kubernetes/ingress/ingress.yaml

# Deploy HPAs
kubectl apply -f kubernetes/hpa/hpa.yaml

# Wait for all deployments to be ready
kubectl -n healthpoint-core wait deployment --all --for=condition=Available --timeout=600s
kubectl -n healthpoint-integration wait deployment --all --for=condition=Available --timeout=600s

# Verify pod count
kubectl get pods -n healthpoint-core | grep Running | wc -l
# Expected: 19+ pods (one per core service, some replicated)
```

---

## Step 8: Deploy Middleware Stack

```bash
# OpenSearch 3-node cluster
kubectl apply -f infrastructure/opensearch/opensearch-cluster.yaml
kubectl -n healthpoint-middleware wait pod -l app=opensearch --for=condition=Ready --timeout=300s

# Apply index templates
OPENSEARCH_URL=https://search.healthpoint.io
curl -s -X PUT "$OPENSEARCH_URL/_index_template/idr-disputes" \
  -H "Content-Type: application/json" \
  -d @infrastructure/opensearch/index-templates.json

# Kafka topics (via Strimzi)
kubectl apply -f infrastructure/kafka/topic-config.yaml

# Temporal workflow engine
helm repo add temporal https://charts.temporal.io
helm install temporal temporal/temporal \
  --namespace healthpoint-middleware \
  --set server.config.persistence.defaultStore=sql \
  --set server.config.persistence.sql.driver=postgres12 \
  --set server.config.persistence.sql.host=postgres-primary

# Permify authorization
kubectl apply -f infrastructure/permify/ 2>/dev/null || echo "Permify manifests not yet created"

# Dapr
helm repo add dapr https://dapr.github.io/helm-charts
helm install dapr dapr/dapr --namespace dapr-system --create-namespace
```

---

## Step 9: Deploy OpenTelemetry and Monitoring

```bash
# OTel Collector
kubectl apply -f infrastructure/otel/otel-collector.yaml

# Prometheus + Grafana (included in docker-compose.production.yml)
# For Kubernetes:
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --namespace monitoring --create-namespace

# Jaeger for distributed tracing
helm repo add jaegertracing https://jaegertracing.github.io/helm-charts
helm install jaeger jaegertracing/jaeger \
  --namespace monitoring \
  --set provisionDataStore.cassandra=false \
  --set allInOne.enabled=true
```

---

## Step 10: EMR App Registration

### Epic App Orchard

1. Go to [https://appmarket.epic.com/Gallery](https://appmarket.epic.com/Gallery)
2. Click **Submit an App**
3. Use values from `medplum/emr-registration/epic-app-orchard.json`
4. Generate JWKS: `chmod +x medplum/emr-registration/generate_jwks.sh && ./medplum/emr-registration/generate_jwks.sh`
5. Store private key in Vault: `vault kv put secret/healthpoint/epic-private-key @medplum/emr-registration/keys/healthpoint-epic-private.pem`
6. Serve `medplum/emr-registration/keys/jwks.json` at `https://fhir.healthpoint.io/.well-known/jwks.json`
7. Register the `kid` value from JWKS in Epic App Orchard under **Public Keys**
8. Update `EPIC_CLIENT_ID` in Vault: `vault kv put secret/healthpoint/emr epic_client_id=<from_epic>`

### Cerner Code Console

1. Go to [https://code.cerner.com/developer/smart-on-fhir/apps](https://code.cerner.com/developer/smart-on-fhir/apps)
2. Click **Begin Registration**
3. Use values from `medplum/emr-registration/cerner-code-console.json`
4. Update Vault: `vault kv put secret/healthpoint/emr cerner_client_id=<id> cerner_client_secret=<secret>`

---

## Step 11: CI/CD Pipeline (GitHub Actions)

The CI/CD workflow file cannot be pushed automatically due to GitHub App permissions. Add it manually:

1. Go to [https://github.com/munisp/healthpoint/actions](https://github.com/munisp/healthpoint/actions)
2. Click **New workflow** → **Set up a workflow yourself**
3. Copy the full content from `scripts/ci-cd-workflow-content.txt`
4. Paste into the editor and commit as `.github/workflows/ci-cd.yml`
5. Add the following repository secrets in GitHub Settings → Secrets:
   - `GHCR_TOKEN` — GitHub personal access token with `write:packages`
   - `KUBE_CONFIG` — base64-encoded kubeconfig for production cluster
   - `VAULT_ADDR` — Vault cluster address
   - `VAULT_TOKEN` — Vault CI/CD service token (limited policy)

---

## Step 12: HIPAA BAA and Compliance

Before accepting any real patient data:

- [ ] Sign HIPAA Business Associate Agreement with hosting provider
- [ ] Sign HIPAA BAA with AWS (for S3 FHIR exports)
- [ ] Complete SOC 2 Type II audit (or equivalent)
- [ ] Complete HITRUST CSF assessment
- [ ] Register as a HIPAA-covered entity or business associate with HHS
- [ ] Enable CloudTrail / audit logging on all S3 buckets
- [ ] Enable encryption at rest on all PostgreSQL instances (AES-256)
- [ ] Enable TLS 1.2+ on all inter-service communication

---

## Verification Checklist

Run after all steps complete:

```bash
# Health check all services
for svc in nsa-idr-dispute payment-processing gfe-management claims-processing \
           eligibility-validation admin-fee-management appeal-escalation \
           cms-portal-automation check-payment mpi-patient-matching \
           fhir-terminology fhir-bulk-export cds-hooks hl7v2-ingest \
           fhir-subscription smart-launch emr-connector; do
  STATUS=$(curl -sf "https://api.healthpoint.io/$svc/health" | jq -r '.status' 2>/dev/null || echo "FAILED")
  echo "$svc: $STATUS"
done

# Verify Medplum FHIR server
curl -s https://fhir.healthpoint.io/fhir/R4/metadata | jq '.fhirVersion'
# Expected: "4.0.1"

# Verify Keycloak realm
curl -s https://auth.healthpoint.io/realms/healthpoint/.well-known/openid-configuration \
  | jq '.issuer'
# Expected: "https://auth.healthpoint.io/realms/healthpoint"

# Verify database migrations
DATABASE_URL=$DB_URL alembic current
# Expected: 20240104_0004_medplum_emr_connector (head)

# Run integration test suite
cd /path/to/healthpoint-repo
pytest tests/test_production_scenarios.py -v --timeout=120
# Expected: All 10 scenario tests pass
```

---

## Rollback Procedure

If any deployment fails:

```bash
# Roll back a specific deployment
kubectl -n healthpoint-core rollout undo deployment/nsa-idr-dispute-service

# Roll back all core services to previous image tag
export PREV_TAG=$(git rev-parse --short HEAD~1)
kubectl -n healthpoint-core set image deployment/nsa-idr-dispute-service \
  nsa-idr-dispute-service=ghcr.io/munisp/healthpoint/nsa-idr-dispute-service:$PREV_TAG

# Roll back database migration
DATABASE_URL=$DB_URL alembic downgrade -1
```

---

## Estimated Deployment Time

| Step | Time |
|---|---|
| Build and push images | 45 min |
| Vault init and provisioning | 20 min |
| Database migrations | 5 min |
| Keycloak realm import | 10 min |
| Medplum setup + Bots | 15 min |
| All service deployments | 20 min |
| Middleware stack | 30 min |
| EMR app registration (Epic) | 2–4 weeks (Epic review) |
| HIPAA BAA | 1–2 weeks (legal review) |
| **Total (excluding external reviews)** | **~3 hours** |
