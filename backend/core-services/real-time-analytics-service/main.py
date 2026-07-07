"""
Real-Time Analytics Service — Full Production Implementation
Provides real-time metrics, aggregations, and event streaming for the HealthPoint IDR Platform.
"""
import asyncio, json, logging, os, time, uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, AsyncGenerator, Dict, List, Optional

import asyncpg

# ── Shared HealthPoint infrastructure ─────────────────────────────────────────
import sys, os as _os
_repo_root = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)
from backend.shared.database import fetch, fetchrow, execute, fetchval, transaction, bootstrap_schema, get_pool
from backend.shared.cache import get_client as get_redis_client, rate_limit_check, set_json, get_json
from backend.shared.auth import get_current_user, require_role, require_admin, require_provider, security_headers_middleware, TokenPayload
from backend.shared.messaging import publish, Topics
# ─────────────────────────────────────────────────────────────────────────────

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DATABASE_URL = os.environ["DATABASE_URL"]
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

app = FastAPI(title="HealthPoint Real-Time Analytics Service", version="2.0.0")

app.middleware("http")(security_headers_middleware)
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","), allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

_pool: Optional[asyncpg.Pool] = None
_redis: Optional[Any] = None
_event_subscribers: List[asyncio.Queue] = []
_metrics_cache: Dict[str, Any] = {}
_recent_events: deque = deque(maxlen=1000)

async def get_db():
    global _pool
    if _pool is None:
        try:
            _pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
        except Exception as e:
            logger.warning(f"DB pool failed: {e}")
    return _pool

async def get_redis():
    global _redis
    if _redis is None:
        try:
            _redis = get_redis_client()
        except Exception as e:
            logger.warning(f"Redis connection failed: {e}")
    return _redis

class MetricType(str, Enum):
    COUNTER = "counter"; GAUGE = "gauge"; HISTOGRAM = "histogram"; RATE = "rate"

class EventType(str, Enum):
    DISPUTE_CREATED = "dispute_created"; DISPUTE_RESOLVED = "dispute_resolved"
    CLAIM_SUBMITTED = "claim_submitted"; CLAIM_APPROVED = "claim_approved"
    CLAIM_DENIED = "claim_denied"; PAYMENT_PROCESSED = "payment_processed"
    FRAUD_DETECTED = "fraud_detected"; USER_LOGIN = "user_login"
    FILE_UPLOADED = "file_uploaded"; DOCUMENT_GENERATED = "document_generated"

class AnalyticsEvent(BaseModel):
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    event_type: EventType; tenant_id: str; user_id: Optional[str] = None
    entity_id: Optional[str] = None; entity_type: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    amount: Optional[float] = None; timestamp: datetime = Field(default_factory=datetime.utcnow)

class MetricQuery(BaseModel):
    metric_name: str; start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None; tenant_id: Optional[str] = None
    granularity: str = "hour"

async def publish_event(event: AnalyticsEvent):
    """Publish event to all SSE subscribers and Redis."""
    _recent_events.append(event.dict())
    redis = await get_redis()
    if redis:
        try:
            await redis.lpush("analytics:events", event.json())
            await redis.ltrim("analytics:events", 0, 9999)
            await redis.publish(f"analytics:{event.tenant_id}", event.json())
        except Exception as e:
            logger.warning(f"Redis publish failed: {e}")
    for q in list(_event_subscribers):
        try:
            q.put_nowait(event.dict())
        except asyncio.QueueFull:
            logger.warning("Non-fatal analytics exception suppressed")

async def compute_dispute_metrics(pool, tenant_id: Optional[str], start: datetime, end: datetime):
    if not pool:
        return {}
    where = "WHERE created_at BETWEEN $1 AND $2"
    params = [start, end]
    if tenant_id:
        where += " AND tenant_id = $3"; params.append(tenant_id)
    try:
        rows = await pool.fetch(f"""
            SELECT status, COUNT(*) as count, AVG(disputed_amount) as avg_amount,
                   SUM(disputed_amount) as total_amount
            FROM nsa_disputes {where} GROUP BY status""", *params)
        return {r["status"]: {"count": r["count"], "avg_amount": float(r["avg_amount"] or 0),
                               "total_amount": float(r["total_amount"] or 0)} for r in rows}
    except Exception as e:
        logger.warning(f"Dispute metrics query failed: {e}"); return {}

async def compute_claim_metrics(pool, tenant_id: Optional[str], start: datetime, end: datetime):
    if not pool:
        return {}
    where = "WHERE created_at BETWEEN $1 AND $2"
    params = [start, end]
    if tenant_id:
        where += " AND tenant_id = $3"; params.append(tenant_id)
    try:
        rows = await pool.fetch(f"""
            SELECT status, COUNT(*) as count, SUM(billed_amount) as total_billed,
                   SUM(allowed_amount) as total_allowed
            FROM claims {where} GROUP BY status""", *params)
        return {r["status"]: {"count": r["count"],
                               "total_billed": float(r["total_billed"] or 0),
                               "total_allowed": float(r["total_allowed"] or 0)} for r in rows}
    except Exception as e:
        logger.warning(f"Claim metrics query failed: {e}"); return {}

async def compute_fraud_metrics(pool, tenant_id: Optional[str], start: datetime, end: datetime):
    if not pool:
        return {}
    where = "WHERE detected_at BETWEEN $1 AND $2"
    params = [start, end]
    if tenant_id:
        where += " AND tenant_id = $3"; params.append(tenant_id)
    try:
        rows = await pool.fetch(f"""
            SELECT risk_level, COUNT(*) as count, AVG(confidence_score) as avg_confidence
            FROM fraud_detections {where} GROUP BY risk_level""", *params)
        return {r["risk_level"]: {"count": r["count"],
                                   "avg_confidence": float(r["avg_confidence"] or 0)} for r in rows}
    except Exception as e:
        logger.warning(f"Fraud metrics query failed: {e}"); return {}

async def compute_payment_metrics(pool, tenant_id: Optional[str], start: datetime, end: datetime):
    if not pool:
        return {}
    where = "WHERE created_at BETWEEN $1 AND $2"
    params = [start, end]
    if tenant_id:
        where += " AND tenant_id = $3"; params.append(tenant_id)
    try:
        rows = await pool.fetch(f"""
            SELECT status, COUNT(*) as count, SUM(amount) as total_amount
            FROM payments {where} GROUP BY status""", *params)
        return {r["status"]: {"count": r["count"],
                               "total_amount": float(r["total_amount"] or 0)} for r in rows}
    except Exception as e:
        logger.warning(f"Payment metrics query failed: {e}"); return {}

async def get_time_series(pool, metric: str, start: datetime, end: datetime,
                           tenant_id: Optional[str], granularity: str):
    if not pool:
        return []
    trunc = {"hour": "hour", "day": "day", "week": "week", "month": "month"}.get(granularity, "hour")
    table_map = {
        "disputes": ("nsa_disputes", "id", "created_at"),
        "claims": ("claims", "id", "created_at"),
        "payments": ("payments", "id", "created_at"),
        "fraud": ("fraud_detections", "id", "detected_at"),
    }
    if metric not in table_map:
        return []
    table, id_col, ts_col = table_map[metric]
    where = f"WHERE {ts_col} BETWEEN $1 AND $2"
    params = [start, end]
    if tenant_id:
        where += " AND tenant_id = $3"; params.append(tenant_id)
    try:
        rows = await pool.fetch(f"""
            SELECT date_trunc('{trunc}', {ts_col}) as period, COUNT({id_col}) as count
            FROM {table} {where} GROUP BY period ORDER BY period""", *params)
        return [{"period": str(r["period"]), "count": r["count"]} for r in rows]
    except Exception as e:
        logger.warning(f"Time series query failed: {e}"); return []

@app.get("/health")
async def health():
    return {"status": "healthy", "service": "real-time-analytics", "version": "2.0.0"}

@app.post("/api/v1/analytics/events", status_code=201)
async def ingest_event(event: AnalyticsEvent,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Ingest a single analytics event."""
    await publish_event(event)
    pool = await get_db()
    if pool:
        try:
            await pool.execute("""
                INSERT INTO audit_log (id, event_type, entity_id, entity_type,
                    user_id, tenant_id, metadata, created_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING""",
                event.event_id, event.event_type.value, event.entity_id,
                event.entity_type, event.user_id, event.tenant_id,
                json.dumps(event.metadata), event.timestamp)
        except Exception as e:
            logger.warning(f"Event persistence failed: {e}")
    return {"event_id": event.event_id, "status": "ingested"}

@app.post("/api/v1/analytics/events/bulk", status_code=201)
async def ingest_events_bulk(events: List[AnalyticsEvent],
    current_user: TokenPayload = Depends(get_current_user),
):
    if len(events) > 500:
        raise HTTPException(400, "Maximum 500 events per bulk request")
    for event in events:
        await publish_event(event)
    return {"ingested": len(events), "status": "ok"}

@app.get("/api/v1/analytics/dashboard")
async def get_dashboard(tenant_id: Optional[str] = None,
                         period_hours: int = Query(default=24, ge=1, le=720),
                             current_user: TokenPayload = Depends(get_current_user),
                         ):
    """Get comprehensive dashboard metrics."""
    end = datetime.utcnow()
    start = end - timedelta(hours=period_hours)
    pool = await get_db()
    disputes = await compute_dispute_metrics(pool, tenant_id, start, end)
    claims = await compute_claim_metrics(pool, tenant_id, start, end)
    fraud = await compute_fraud_metrics(pool, tenant_id, start, end)
    payments = await compute_payment_metrics(pool, tenant_id, start, end)
    return {
        "period": {"start": start.isoformat(), "end": end.isoformat(), "hours": period_hours},
        "disputes": disputes, "claims": claims, "fraud": fraud, "payments": payments,
        "recent_events_count": len(_recent_events),
        "generated_at": datetime.utcnow().isoformat(),
    }

@app.get("/api/v1/analytics/metrics/disputes")
async def dispute_metrics(tenant_id: Optional[str] = None, period_hours: int = 24,
    current_user: TokenPayload = Depends(get_current_user),
):
    end = datetime.utcnow(); start = end - timedelta(hours=period_hours)
    pool = await get_db()
    return await compute_dispute_metrics(pool, tenant_id, start, end)

@app.get("/api/v1/analytics/metrics/claims")
async def claim_metrics(tenant_id: Optional[str] = None, period_hours: int = 24,
    current_user: TokenPayload = Depends(get_current_user),
):
    end = datetime.utcnow(); start = end - timedelta(hours=period_hours)
    pool = await get_db()
    return await compute_claim_metrics(pool, tenant_id, start, end)

@app.get("/api/v1/analytics/metrics/fraud")
async def fraud_metrics(tenant_id: Optional[str] = None, period_hours: int = 24,
    current_user: TokenPayload = Depends(get_current_user),
):
    end = datetime.utcnow(); start = end - timedelta(hours=period_hours)
    pool = await get_db()
    return await compute_fraud_metrics(pool, tenant_id, start, end)

@app.get("/api/v1/analytics/metrics/payments")
async def payment_metrics(tenant_id: Optional[str] = None, period_hours: int = 24,
    current_user: TokenPayload = Depends(get_current_user),
):
    end = datetime.utcnow(); start = end - timedelta(hours=period_hours)
    pool = await get_db()
    return await compute_payment_metrics(pool, tenant_id, start, end)

@app.get("/api/v1/analytics/timeseries/{metric}")
async def time_series(metric: str, tenant_id: Optional[str] = None,
                       period_hours: int = 168, granularity: str = "hour",
                           current_user: TokenPayload = Depends(get_current_user),
                       ):
    end = datetime.utcnow(); start = end - timedelta(hours=period_hours)
    pool = await get_db()
    data = await get_time_series(pool, metric, start, end, tenant_id, granularity)
    return {"metric": metric, "granularity": granularity, "data": data}

@app.get("/api/v1/analytics/events/stream")
async def event_stream(tenant_id: Optional[str] = None,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Server-Sent Events stream for real-time analytics."""
    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    _event_subscribers.append(queue)

    async def generate() -> AsyncGenerator[str, None]:
        try:
            yield f"data: {json.dumps({'type': 'connected', 'timestamp': datetime.utcnow().isoformat()})}\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                    if tenant_id is None or event.get("tenant_id") == tenant_id:
                        yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'type': 'heartbeat', 'timestamp': datetime.utcnow().isoformat()})}\n\n"
        finally:
            if queue in _event_subscribers:
                _event_subscribers.remove(queue)

    return StreamingResponse(generate(), media_type="text/event-stream",
                              headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@app.get("/api/v1/analytics/events/recent")
async def recent_events(limit: int = Query(50, le=200), tenant_id: Optional[str] = None,
    current_user: TokenPayload = Depends(get_current_user),
):
    events = list(_recent_events)
    if tenant_id:
        events = [e for e in events if e.get("tenant_id") == tenant_id]
    return {"events": events[-limit:], "total": len(events)}

@app.get("/api/v1/analytics/kpis")
async def get_kpis(tenant_id: Optional[str] = None,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get key performance indicators."""
    end = datetime.utcnow()
    start_24h = end - timedelta(hours=24)
    start_7d = end - timedelta(days=7)
    pool = await get_db()
    disputes_24h = await compute_dispute_metrics(pool, tenant_id, start_24h, end)
    disputes_7d = await compute_dispute_metrics(pool, tenant_id, start_7d, end)
    claims_24h = await compute_claim_metrics(pool, tenant_id, start_24h, end)
    total_disputes_24h = sum(v["count"] for v in disputes_24h.values())
    total_claims_24h = sum(v["count"] for v in claims_24h.values())
    resolved_24h = disputes_24h.get("resolved", {}).get("count", 0)
    resolution_rate = (resolved_24h / total_disputes_24h * 100) if total_disputes_24h > 0 else 0
    return {
        "disputes_last_24h": total_disputes_24h,
        "disputes_last_7d": sum(v["count"] for v in disputes_7d.values()),
        "claims_last_24h": total_claims_24h,
        "dispute_resolution_rate_24h": round(resolution_rate, 2),
        "generated_at": end.isoformat(),
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8032")))