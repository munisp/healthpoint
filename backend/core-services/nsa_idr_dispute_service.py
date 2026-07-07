"""
NSA/IDR Dispute Resolution Service
Handles No Surprises Act Independent Dispute Resolution processes
Port: 8016
"""

import asyncio
import json
import logging
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from enum import Enum
from typing import Dict, List, Optional, Any

import httpx
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

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import structlog

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = structlog.get_logger()

app = FastAPI(

app.middleware("http")(security_headers_middleware)
    title="NSA/IDR Dispute Resolution Service",
    description="No Surprises Act Independent Dispute Resolution processing",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
DATABASE_URL = os.environ["DATABASE_URL"]
CMS_IDR_PORTAL_URL = "https://nsa-idr.cms.gov/paymentdisputes/api/v1"
IDR_ADMIN_FEE = Decimal("115.00")
NEGOTIATION_PERIOD_DAYS = 30
INITIATION_WINDOW_DAYS = 4

# Enums
class DisputeStatus(str, Enum):
    DRAFT = "draft"
    NEGOTIATION = "negotiation"
    READY_FOR_IDR = "ready_for_idr"
    IDR_INITIATED = "idr_initiated"
    IDR_IN_PROGRESS = "idr_in_progress"
    IDR_DECIDED = "idr_decided"
    SETTLED = "settled"
    CLOSED = "closed"

class DisputeType(str, Enum):
    EMERGENCY_SERVICES = "emergency_services"
    POST_STABILIZATION = "post_stabilization"
    NON_EMERGENCY_OON = "non_emergency_oon"
    AIR_AMBULANCE = "air_ambulance"

# Pydantic Models
class QualifiedIDRItem(BaseModel):
    service_date: datetime
    service_location: str
    service_type: DisputeType
    service_codes: List[str]
    claim_number: str
    billed_amount: Decimal

class BulkDisputeRequest(BaseModel):
    qualified_items: List[QualifiedIDRItem]
    negotiation_summary: str

class NSADisputeResponse(BaseModel):
    dispute_id: str
    status: DisputeStatus
    created_at: datetime
    total_items: int
    total_amount: Decimal

# Database connection
async def get_db():
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        yield conn
    finally:
        await conn.close()

@app.post("/disputes/bulk", response_model=NSADisputeResponse)
async def create_bulk_dispute(request: BulkDisputeRequest):
    """Create a bulk NSA dispute"""
    
    dispute_id = str(uuid.uuid4())
    total_amount = sum(item.billed_amount for item in request.qualified_items)
    
    return NSADisputeResponse(
        dispute_id=dispute_id,
        status=DisputeStatus.NEGOTIATION,
        created_at=datetime.utcnow(),
        total_items=len(request.qualified_items),
        total_amount=total_amount
    )

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "NSA/IDR Dispute Resolution",
        "timestamp": datetime.utcnow().isoformat()
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8016)
