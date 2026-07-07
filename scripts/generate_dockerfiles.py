#!/usr/bin/env python3
"""
Generate Dockerfiles for all HealthPoint services.
- Standard services: python:3.11-slim multi-stage build
- ML services: python:3.11-slim with scipy/sklearn extras
- Subdirectory services (with their own main.py): placed in their directory
- Flat-file services: placed in backend/core-services/<name>/
"""
import os
import re
import shutil

REPO = "/home/ubuntu/healthpoint-repo"

STANDARD_DOCKERFILE = """\
# ── Stage 1: builder ────────────────────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /build

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \\
    gcc \\
    libpq-dev \\
    curl \\
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \\
    pip install --no-cache-dir --prefix=/install -r requirements.txt

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

# Install runtime system dependencies only
RUN apt-get update && apt-get install -y --no-install-recommends \\
    libpq5 \\
    curl \\
    && rm -rf /var/lib/apt/lists/* \\
    && groupadd -r appuser && useradd -r -g appuser -u 1000 appuser

# Copy installed packages from builder
COPY --from=builder /install /usr/local

WORKDIR /app

# Copy application source
COPY . .

# Set ownership
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose service port
EXPOSE {port}

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \\
    CMD curl -f http://localhost:{port}/health || exit 1

# Run the service
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "{port}", "--workers", "2", "--log-level", "info"]
"""

ML_DOCKERFILE = """\
# ── Stage 1: builder ────────────────────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /build

# Install build dependencies including those needed for ML libraries
RUN apt-get update && apt-get install -y --no-install-recommends \\
    gcc \\
    g++ \\
    libpq-dev \\
    libopenblas-dev \\
    liblapack-dev \\
    curl \\
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \\
    pip install --no-cache-dir --prefix=/install -r requirements.txt

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

# Install runtime system dependencies for ML (BLAS/LAPACK)
RUN apt-get update && apt-get install -y --no-install-recommends \\
    libpq5 \\
    libopenblas0 \\
    liblapack3 \\
    curl \\
    && rm -rf /var/lib/apt/lists/* \\
    && groupadd -r appuser && useradd -r -g appuser -u 1000 appuser

# Copy installed packages from builder
COPY --from=builder /install /usr/local

WORKDIR /app

# Copy application source
COPY . .

# Create model cache directory
RUN mkdir -p /app/models && chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose service port
EXPOSE {port}

# Health check
HEALTHCHECK --interval=30s --timeout=15s --start-period=60s --retries=3 \\
    CMD curl -f http://localhost:{port}/health || exit 1

# Run the service (single worker for ML to avoid model duplication)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "{port}", "--workers", "1", "--log-level", "info"]
"""

SHARED_REQUIREMENTS = """\
fastapi==0.104.1
uvicorn[standard]==0.24.0
pydantic==2.5.0
asyncpg==0.29.0
redis==5.0.1
aiokafka==0.10.0
python-jose[cryptography]==3.3.0
httpx==0.25.2
python-multipart==0.0.6
prometheus-fastapi-instrumentator==6.1.0
opentelemetry-api==1.21.0
opentelemetry-sdk==1.21.0
opentelemetry-exporter-otlp==1.21.0
opentelemetry-instrumentation-fastapi==0.42b0
opentelemetry-instrumentation-asyncpg==0.42b0
opentelemetry-instrumentation-redis==0.42b0
hvac==2.0.0
cryptography==41.0.7
"""

ML_EXTRA_REQUIREMENTS = """\
numpy==1.26.2
pandas==2.1.3
scikit-learn==1.3.2
joblib==1.3.2
"""

# ── Service definitions ───────────────────────────────────────────────────────
# (name, port, is_ml, is_subdir)
SERVICES = [
    # Flat-file core services
    ("admin_fee_management_service",       8025, False, False),
    ("aggregator_reconciliation_service",  8021, False, False),
    ("ai_fraud_detection_service_enhanced",8001, True,  False),
    ("analytics_reporting_service",        8007, True,  False),
    ("api_gateway_service",                8000, False, False),
    ("appeal_escalation_service",          8025, False, False),
    ("audit_compliance_service",           8005, False, False),
    ("backup_service",                     8014, False, False),
    ("claims_processing_service",          8004, False, False),
    ("cms_idr_integration_service",        8020, False, False),
    ("comprehensive_notification_service", 8023, False, False),
    ("configuration_service",              8012, False, False),
    ("data_validation_service",            8017, False, False),
    ("digital_contract_management_service",8023, False, False),
    ("document_management_service",        8009, False, False),
    ("enhanced_billing_service",           8026, False, False),
    ("flexible_refund_processing_service", 8024, False, False),
    ("integration_service",                8010, False, False),
    ("monitoring_service",                 8013, False, False),
    ("notification_service",               8007, False, False),
    ("nsa_idr_dispute_service",            8016, False, False),
    ("patient_management_service",         8004, False, False),
    ("payment_processing_service",         8016, False, False),
    ("per_provider_billing_service",       8022, False, False),
    ("predictive_modeling_service",        8018, True,  False),
    ("provider_management_service",        8002, False, False),
    ("provider_payment_details_service",   8023, False, False),
    ("security_service",                   8015, False, False),
    ("training_support_service",           8024, False, False),
    ("user_management_service",            8001, False, False),
    ("workflow_engine_service",            8011, False, False),
    # Subdirectory services
    ("data-transformation-service",        8030, False, True),
    ("document-generation-service",        8029, False, True),
    ("enhanced-eligibility-validation-service", 8084, False, True),
    ("enhanced-entity-selection-service",  8085, False, True),
    ("file-upload-service",                8031, False, True),
    ("gfe-management-service",             8036, False, True),
    ("idr-entity-selection-service",       8082, False, True),
    ("predictive-analytics-service",       8081, True,  True),
    ("puf-data-service",                   8086, False, True),
    ("real-time-analytics-service",        8032, False, True),
    ("security-authentication-service",    8031, False, True),
    ("third-party-integration-service",    8083, False, True),
    ("volume-management-service",          8087, False, True),
    ("x12-edi-processing-service",         8088, False, True),
    # Integration services
    ("cms-portal-automation-service",      8089, False, "integration"),
    ("idr-entity-integration-service",     8090, False, "integration"),
    ("notification-service",               8091, False, "integration"),
    ("third-party-integration-service-int",8092, False, "integration"),
    # Middleware services
    ("api-gateway-service",                8000, False, "middleware"),
]

created = []
skipped = []

for name, port, is_ml, location in SERVICES:
    template = ML_DOCKERFILE if is_ml else STANDARD_DOCKERFILE
    dockerfile_content = template.format(port=port)

    if location == "integration":
        # Map to integration-services directory
        svc_name = name.replace("-int", "")
        svc_dir = os.path.join(REPO, "backend", "integration-services", svc_name)
    elif location == "middleware":
        svc_dir = os.path.join(REPO, "backend", "middleware", name)
    elif location is True:
        # Subdirectory service
        svc_dir = os.path.join(REPO, "backend", "core-services", name)
    else:
        # Flat-file service — create a directory for it
        svc_dir = os.path.join(REPO, "backend", "core-services", name)
        os.makedirs(svc_dir, exist_ok=True)
        # Copy the flat .py file into the directory as main.py if not already there
        src_py = os.path.join(REPO, "backend", "core-services", f"{name}.py")
        dst_py = os.path.join(svc_dir, "main.py")
        if os.path.exists(src_py) and not os.path.exists(dst_py):
            shutil.copy2(src_py, dst_py)

    os.makedirs(svc_dir, exist_ok=True)

    # Write Dockerfile
    dockerfile_path = os.path.join(svc_dir, "Dockerfile")
    with open(dockerfile_path, "w") as f:
        f.write(dockerfile_content)

    # Write requirements.txt if missing
    req_path = os.path.join(svc_dir, "requirements.txt")
    if not os.path.exists(req_path):
        reqs = SHARED_REQUIREMENTS
        if is_ml:
            reqs += ML_EXTRA_REQUIREMENTS
        with open(req_path, "w") as f:
            f.write(reqs)

    # Write .dockerignore
    dockerignore_path = os.path.join(svc_dir, ".dockerignore")
    if not os.path.exists(dockerignore_path):
        with open(dockerignore_path, "w") as f:
            f.write("__pycache__\n*.pyc\n*.pyo\n*.pyd\n.Python\n*.egg-info\ndist\nbuild\n.git\n.env\n*.log\ntests/\n.pytest_cache\n")

    created.append(dockerfile_path)

print(f"Created {len(created)} Dockerfiles")
for p in created[:10]:
    print(f"  {p}")
print(f"  ... and {len(created)-10} more")
