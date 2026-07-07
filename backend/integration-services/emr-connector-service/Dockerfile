# ── Build stage ───────────────────────────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev && \
    rm -rf /var/lib/apt/lists/*

COPY backend/integration-services/emr-connector-service/requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 curl && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd -r appgroup && useradd -r -g appgroup -u 1000 appuser

WORKDIR /app

COPY --from=builder /install /usr/local
COPY backend/shared /app/backend/shared
COPY backend/integration-services/emr-connector-service /app/backend/integration-services/emr-connector-service

USER appuser

EXPOSE 8120

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8120/health || exit 1

CMD ["uvicorn", "backend.integration-services.emr-connector-service.main:app", \
     "--host", "0.0.0.0", "--port", "8120", "--workers", "2"]
