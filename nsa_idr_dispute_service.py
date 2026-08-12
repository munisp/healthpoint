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
from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import structlog

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = structlog.get_logger()

app = FastAPI(
    title="NSA/IDR Dispute Resolution Service",
    description="No Surprises Act Independent Dispute Resolution processing",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
DATABASE_URL = "postgresql://healthuser:healthpass123@localhost:5432/healthcare_platform"
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
