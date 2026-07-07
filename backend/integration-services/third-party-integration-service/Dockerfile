# ─── Stage 1: Builder ────────────────────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /build

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ─── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

# Security: run as non-root user
RUN groupadd -r healthpoint && useradd -r -g healthpoint -u 1000 healthpoint

WORKDIR /app

# Install runtime system dependencies only
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy shared modules
COPY backend/shared/ /app/shared/

# Copy service code
COPY backend/integration-services/third-party-integration-service/main.py /app/main.py
COPY backend/integration-services/third-party-integration-service/requirements.txt /app/requirements.txt

# Security: read-only filesystem where possible
RUN chown -R healthpoint:healthpoint /app

USER healthpoint

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8035}/health || exit 1

EXPOSE 8035

# Use uvicorn directly (not debug mode)
CMD ["python", "-m", "uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8035", \
     "--workers", "2", \
     "--no-access-log", \
     "--timeout-keep-alive", "75"]
