# ── Stage 1: builder ────────────────────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /build

# Install build dependencies including those needed for ML libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libpq-dev \
    libopenblas-dev \
    liblapack-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir --prefix=/install -r requirements.txt

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

# Install runtime system dependencies for ML (BLAS/LAPACK)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    libopenblas0 \
    liblapack3 \
    curl \
    && rm -rf /var/lib/apt/lists/* \
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
EXPOSE 8018

# Health check
HEALTHCHECK --interval=30s --timeout=15s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8018/health || exit 1

# Run the service (single worker for ML to avoid model duplication)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8018", "--workers", "1", "--log-level", "info"]
