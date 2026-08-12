# NSA/IDR Healthcare Platform - Middleware Stack Deployment Guide

## Overview

This guide provides comprehensive instructions for deploying the NSA/IDR Healthcare Platform with a complete middleware stack including Dapr, Keycloak, Permify, Temporal, Kafka, and APISIX.

## Prerequisites

- Docker and Docker Compose installed
- Dapr CLI installed
- Node.js 18+ for frontend applications
- Python 3.11+ for backend services

## Architecture Components

| Component | Purpose | Port | Status |
|-----------|---------|------|--------|
| **Keycloak** | Identity & Access Management | 8080 | ✅ Configured |
| **Permify** | Authorization Service | 3476/3478 | ✅ Configured |
| **Temporal** | Workflow Orchestration | 7233/8233 | ✅ Configured |
| **Kafka** | Event Streaming | 9092 | ✅ Configured |
| **APISIX** | API Gateway | 9080/9443 | ✅ Configured |
| **Redis** | Dapr State Store | 6379 | ✅ Configured |
| **PostgreSQL** | Temporal Database | 5432 | ✅ Configured |

## Security Tools Integration

| Tool | Purpose | Port | Status |
|------|---------|------|--------|
| **OpenAppSec** | Application Security | 8443 | ✅ Configured |
| **Wazuh** | SIEM & Security Monitoring | 55000 | ✅ Configured |
| **OpenCTI** | Threat Intelligence | 8081 | ✅ Configured |

## Deployment Steps

### 1. Start Middleware Stack

```bash
cd /home/ubuntu/enhanced-healthcare-platform/middleware
docker-compose -f docker-compose.full.yml up -d
```

### 2. Initialize Dapr

```bash
dapr init
```

### 3. Start Services with Dapr Sidecars

```bash
cd /home/ubuntu/enhanced-healthcare-platform/middleware
./dapr/run-services.sh
```

### 4. Start Frontend Applications

```bash
# NSA/IDR Unified Dashboard
cd /home/ubuntu/enhanced-healthcare-platform/nsa-idr-unified-dashboard
npm install
npm run dev

# Admin Fee Management Dashboard
cd /home/ubuntu/enhanced-healthcare-platform/admin-fee-dashboard-enhanced
npm install
npm run dev
```

## Service Endpoints

### Core Services
- **API Gateway**: http://localhost:8025
- **GFE Management**: http://localhost:8027
- **X12 EDI Processing**: http://localhost:8028
- **CMS Portal Automation**: http://localhost:8029
- **IDR Entity Integration**: http://localhost:8030
- **Data Transformation**: http://localhost:8031
- **Security Authentication**: http://localhost:8032

### Middleware Services
- **Keycloak Admin**: http://localhost:8080/admin (admin/admin)
- **Permify**: http://localhost:3476
- **Temporal Web UI**: http://localhost:8233
- **APISIX**: http://localhost:9080

### Frontend Applications
- **NSA/IDR Unified Dashboard**: http://localhost:5190
- **Admin Fee Management**: http://localhost:5177

### Security Tools
- **OpenAppSec**: http://localhost:8443
- **Wazuh**: http://localhost:55000
- **OpenCTI**: http://localhost:8081

## Configuration Details

### Keycloak Configuration
- Realm: `nsa-idr-platform`
- Frontend Client: `frontend` (public)
- Backend Client: `backend` (confidential)
- Default Users: admin/admin, user/user

### Permify Schema
- Basic RBAC model with user, resource, admin, read, write relations
- Extensible for healthcare-specific authorization rules

### Temporal Workflows
- GFE Workflow: Handles Good Faith Estimate lifecycle
- IDR Workflow: Manages dispute resolution processes
- Claims Workflow: Processes healthcare claims

### Kafka Topics
- `gfe-created`: GFE generation events
- `claim-submitted`: Claim submission events
- `dispute-initiated`: IDR dispute events

### APISIX Routes
- `/api/v1/gfe/*` → GFE Management Service
- `/api/v1/x12/*` → X12 EDI Processing Service
- `/api/v1/cms/*` → CMS Portal Automation Service
- `/api/v1/idr/*` → IDR Entity Integration Service

## Health Checks

```bash
# Check all services
curl http://localhost:8025/health
curl http://localhost:8027/health
curl http://localhost:8028/health
curl http://localhost:8029/health
curl http://localhost:8030/health
curl http://localhost:8031/health
curl http://localhost:8032/health

# Check middleware
curl http://localhost:8080/health
curl http://localhost:3476/healthz
curl http://localhost:7233/api/v1/namespaces
```

## Troubleshooting

### Common Issues

1. **Docker networking errors**: Ensure iptables modules are loaded
2. **Port conflicts**: Check for existing services on required ports
3. **Dapr initialization**: Run `dapr uninstall` then `dapr init` if issues occur
4. **Keycloak startup**: Allow 2-3 minutes for full initialization

### Logs

```bash
# View middleware logs
docker-compose -f docker-compose.full.yml logs -f

# View Dapr logs
dapr logs --app-id gfe-management-service
```

## Production Considerations

1. **Security**: Change default passwords and secrets
2. **Persistence**: Configure persistent volumes for databases
3. **Scaling**: Use Kubernetes for production deployment
4. **Monitoring**: Enable Prometheus metrics and Grafana dashboards
5. **Backup**: Implement backup strategies for stateful services

## Next Steps

1. Configure SSL/TLS certificates for production
2. Set up monitoring and alerting
3. Implement CI/CD pipelines
4. Configure backup and disaster recovery
5. Perform security hardening and penetration testing
