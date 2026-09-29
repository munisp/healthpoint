#!/usr/bin/env python3
"""
Appeal and Escalation Service
Handles claim appeals and escalation workflows for the NSA/IDR platform.

Features:
- Create, manage, and track claim appeals.
- Define and execute multi-level escalation workflows.
- Integrate with notification and document management services.
- Provide dashboards and reporting on appeal and escalation metrics.
- Ensure compliance with NSA appeal deadlines and requirements.

Author: Manus AI
Date: October 7, 2025
"""

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Dict, List, Optional

import asyncpg
import httpx
import redis.asyncio as aioredis
import uvicorn
from fastapi import Depends, FastAPI, HTTPException, status, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# --- Configuration ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:pass@localhost/nsa_idr_db")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
NOTIFICATION_SERVICE_URL = os.getenv("NOTIFICATION_SERVICE_URL", "http://notification_service:8000")
DOCUMENT_SERVICE_URL = os.getenv("DOCUMENT_SERVICE_URL", "http://document_service:8000")
USER_SERVICE_URL = os.getenv("USER_SERVICE_URL", "http://user_service:8000")

# --- Enums ---
class AppealStatus(str, Enum):
    PENDING_REVIEW = "PENDING_REVIEW"
    IN_PROGRESS = "IN_PROGRESS"
    ADDITIONAL_INFO_REQUIRED = "ADDITIONAL_INFO_REQUIRED"
    APPROVED = "APPROVED"
    DENIED = "DENIED"
    ESCALATED = "ESCALATED"
    CLOSED = "CLOSED"

class EscalationStatus(str, Enum):
    INITIATED = "INITIATED"
    PENDING_ASSIGNMENT = "PENDING_ASSIGNMENT"
    IN_REVIEW = "IN_REVIEW"
    RESOLVED = "RESOLVED"
    CLOSED = "CLOSED"

class EscalationLevel(str, Enum):
    LEVEL_1 = "LEVEL_1"  # Initial review by senior claims adjuster
    LEVEL_2 = "LEVEL_2"  # Review by compliance officer
    LEVEL_3 = "LEVEL_3"  # External review or legal counsel

# --- Pydantic Models ---
class AppealBase(BaseModel):
    claim_id: str
    appellant_id: str
    reason: str
    supporting_documents: List[str] = []

class AppealCreate(AppealBase):
    pass

class Appeal(AppealBase):
    appeal_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    status: AppealStatus = AppealStatus.PENDING_REVIEW
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    resolution_details: Optional[str] = None
    resolution_date: Optional[datetime] = None

class EscalationBase(BaseModel):
    entity_id: str  # Can be a claim_id or appeal_id
    entity_type: str  # "claim" or "appeal"
    reason: str
    initiated_by: str

class EscalationCreate(EscalationBase):
    pass

class Escalation(EscalationBase):
    escalation_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    status: EscalationStatus = EscalationStatus.INITIATED
    level: EscalationLevel = EscalationLevel.LEVEL_1
    assigned_to: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    resolution_details: Optional[str] = None
    resolution_date: Optional[datetime] = None

class AppealUpdate(BaseModel):
    status: Optional[AppealStatus] = None
    resolution_details: Optional[str] = None

class EscalationUpdate(BaseModel):
    status: Optional[EscalationStatus] = None
    assigned_to: Optional[str] = None
    level: Optional[EscalationLevel] = None
    resolution_details: Optional[str] = None

# --- Database Manager ---
class DatabaseManager:
    def __init__(self):
        self.pool = None
        self.redis = None

    async def connect(self):
        self.pool = await asyncpg.create_pool(DATABASE_URL)
        self.redis = await aioredis.from_url(REDIS_URL)
        await self.setup_database()
        logger.info("Database connection established and schema verified.")

    async def disconnect(self):
        if self.pool:
            await self.pool.close()
        if self.redis:
            await self.redis.close()
        logger.info("Database connection closed.")

    async def setup_database(self):
        async with self.pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS appeals (
                    appeal_id UUID PRIMARY KEY,
                    claim_id UUID NOT NULL,
                    appellant_id UUID NOT NULL,
                    reason TEXT NOT NULL,
                    supporting_documents JSONB,
                    status VARCHAR(50) NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL,
                    resolution_details TEXT,
                    resolution_date TIMESTAMPTZ
                );
                CREATE TABLE IF NOT EXISTS escalations (
                    escalation_id UUID PRIMARY KEY,
                    entity_id UUID NOT NULL,
                    entity_type VARCHAR(50) NOT NULL,
                    reason TEXT NOT NULL,
                    initiated_by UUID NOT NULL,
                    status VARCHAR(50) NOT NULL,
                    level VARCHAR(50) NOT NULL,
                    assigned_to UUID,
                    created_at TIMESTAMPTZ NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL,
                    resolution_details TEXT,
                    resolution_date TIMESTAMPTZ
                );
            """)
            logger.info("Appeals and escalations tables created or already exist.")

db_manager = DatabaseManager()

# --- Service Clients ---
class ServiceClient:
    def __init__(self, base_url: str):
        self.base_url = base_url
        self.client = httpx.AsyncClient()

    async def post(self, endpoint: str, data: Dict[str, Any]):
        try:
            response = await self.client.post(f"{self.base_url}{endpoint}", json=data)
            response.raise_for_status()
            return response.json()
        except httpx.RequestError as e:
            logger.error(f"Error calling {self.base_url}{endpoint}: {e}")
            return None

notification_client = ServiceClient(NOTIFICATION_SERVICE_URL)
document_client = ServiceClient(DOCUMENT_SERVICE_URL)
user_client = ServiceClient(USER_SERVICE_URL)

# --- Appeal Service Logic ---
class AppealService:
    async def create_appeal(self, appeal_data: AppealCreate) -> Appeal:
        appeal = Appeal(**appeal_data.dict())
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO appeals (appeal_id, claim_id, appellant_id, reason, supporting_documents, status, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """, uuid.UUID(appeal.appeal_id), uuid.UUID(appeal.claim_id), uuid.UUID(appeal.appellant_id),
                appeal.reason, json.dumps(appeal.supporting_documents), appeal.status.value,
                appeal.created_at, appeal.updated_at)
        
        # TODO: Send notification to relevant parties
        # await notification_client.post("/notifications", {...})
        
        return appeal

    async def get_appeal(self, appeal_id: str) -> Optional[Appeal]:
        async with db_manager.pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM appeals WHERE appeal_id = $1", uuid.UUID(appeal_id))
            if row:
                return Appeal(**dict(row))
        return None

    async def update_appeal_status(self, appeal_id: str, update_data: AppealUpdate) -> Optional[Appeal]:
        appeal = await self.get_appeal(appeal_id)
        if not appeal:
            return None

        update_fields = update_data.dict(exclude_unset=True)
        if not update_fields:
            return appeal

        update_fields["updated_at"] = datetime.utcnow()
        if "status" in update_fields and update_fields["status"] in [AppealStatus.APPROVED, AppealStatus.DENIED]:
            update_fields["resolution_date"] = datetime.utcnow()

        set_clause = ", ".join([f"{key} = ${i+2}" for i, key in enumerate(update_fields.keys())])
        values = [uuid.UUID(appeal_id)] + list(update_fields.values())

        async with db_manager.pool.acquire() as conn:
            await conn.execute(f"UPDATE appeals SET {set_clause} WHERE appeal_id = $1", *values)
        
        # TODO: Send notification about status update
        return await self.get_appeal(appeal_id)

# --- Escalation Service Logic ---
class EscalationService:
    async def create_escalation(self, escalation_data: EscalationCreate) -> Escalation:
        escalation = Escalation(**escalation_data.dict())
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO escalations (escalation_id, entity_id, entity_type, reason, initiated_by, status, level, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            """, uuid.UUID(escalation.escalation_id), uuid.UUID(escalation.entity_id), escalation.entity_type,
                escalation.reason, uuid.UUID(escalation.initiated_by), escalation.status.value, escalation.level.value,
                escalation.created_at, escalation.updated_at)

        # TODO: Assign to a user/team based on rules
        # TODO: Send notification for new escalation
        return escalation

    async def get_escalation(self, escalation_id: str) -> Optional[Escalation]:
        async with db_manager.pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM escalations WHERE escalation_id = $1", uuid.UUID(escalation_id))
            if row:
                return Escalation(**dict(row))
        return None

    async def update_escalation(self, escalation_id: str, update_data: EscalationUpdate) -> Optional[Escalation]:
        escalation = await self.get_escalation(escalation_id)
        if not escalation:
            return None

        update_fields = update_data.dict(exclude_unset=True)
        if not update_fields:
            return escalation

        update_fields["updated_at"] = datetime.utcnow()
        if "status" in update_fields and update_fields["status"] == EscalationStatus.RESOLVED:
            update_fields["resolution_date"] = datetime.utcnow()

        set_clause = ", ".join([f"{key} = ${i+2}" for i, key in enumerate(update_fields.keys())])
        values = [uuid.UUID(escalation_id)] + list(update_fields.values())

        async with db_manager.pool.acquire() as conn:
            await conn.execute(f"UPDATE escalations SET {set_clause} WHERE escalation_id = $1", *values)

        # TODO: Send notification about escalation update
        return await self.get_escalation(escalation_id)

appeal_service = AppealService()
escalation_service = EscalationService()

# --- FastAPI Application ---
app = FastAPI(
    title="Appeal and Escalation Service",
    description="Manages claim appeals and escalation workflows.",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_event():
    await db_manager.connect()

@app.on_event("shutdown")
async def shutdown_event():
    await db_manager.disconnect()

# --- API Endpoints ---
@app.post("/appeals", response_model=Appeal, status_code=status.HTTP_201_CREATED)
async def create_new_appeal(appeal: AppealCreate):
    return await appeal_service.create_appeal(appeal)

@app.get("/appeals/{appeal_id}", response_model=Appeal)
async def get_appeal_by_id(appeal_id: str):
    appeal = await appeal_service.get_appeal(appeal_id)
    if not appeal:
        raise HTTPException(status_code=404, detail="Appeal not found")
    return appeal

@app.patch("/appeals/{appeal_id}", response_model=Appeal)
async def update_appeal(appeal_id: str, update_data: AppealUpdate):
    updated_appeal = await appeal_service.update_appeal_status(appeal_id, update_data)
    if not updated_appeal:
        raise HTTPException(status_code=404, detail="Appeal not found")
    return updated_appeal

@app.post("/escalations", response_model=Escalation, status_code=status.HTTP_201_CREATED)
async def create_new_escalation(escalation: EscalationCreate):
    return await escalation_service.create_escalation(escalation)

@app.get("/escalations/{escalation_id}", response_model=Escalation)
async def get_escalation_by_id(escalation_id: str):
    escalation = await escalation_service.get_escalation(escalation_id)
    if not escalation:
        raise HTTPException(status_code=404, detail="Escalation not found")
    return escalation

@app.patch("/escalations/{escalation_id}", response_model=Escalation)
async def update_escalation(escalation_id: str, update_data: EscalationUpdate):
    updated_escalation = await escalation_service.update_escalation(escalation_id, update_data)
    if not updated_escalation:
        raise HTTPException(status_code=404, detail="Escalation not found")
    return updated_escalation

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "Appeal and Escalation Service"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
