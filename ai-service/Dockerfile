# HealthPoint AI service (LangGraph/FastAPI agents)
# The compose healthcheck curls /health, so curl is installed explicitly.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# curl: used by the docker-compose healthcheck (GET /health)
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

EXPOSE 8000

# AI_SERVICE_PORT is provided by docker-compose (default 8000)
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${AI_SERVICE_PORT:-8000}"]
