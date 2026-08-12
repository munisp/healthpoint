#!/usr/bin/env python3
"""
Enhanced Admin Fee Management Service
Provides dynamic configuration and management of all fees, billing plans, and platform settings with database persistence and audit logging.
Port: 8026
"""



from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, validator
from typing import Dict, List, Optional, Any
import json
import asyncio
from datetime import datetime
import logging
from decimal import Decimal
import uuid
import psycopg2
from psycopg2.extras import RealDictCursor

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Enhanced Admin Fee Management Service", version="2.0.0")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Database connection
DATABASE_URL = "postgresql://user:password@localhost/nsa_idr_db"

def get_db_connection():
    conn = psycopg2.connect(DATABASE_URL)
    return conn

# Data Models (similar to the previous version, but without default values)
class TransactionFee(BaseModel):
    method: str
    fee_type: str
    flat_fee: Optional[float] = None
    percentage: Optional[float] = None
    description: str
    active: bool

class BillingPlan(BaseModel):
    plan_id: str
    name: str
    monthly_cost: float
    max_providers: Optional[int] = None
    per_dispute_fee: float
    included_transactions: int
    features: List[str]
    active: bool

class VolumeDiscount(BaseModel):
    tier_name: str
    min_transactions: int
    max_transactions: Optional[int] = None
    discount_percentage: float
    applies_to: List[str]
    active: bool

class PlatformSettings(BaseModel):
    setting_key: str
    setting_value: Any
    setting_type: str
    description: str
    category: str

class AuditLog(BaseModel):
    action: str
    entity_type: str
    entity_id: str
    changes: Dict[str, Any]
    updated_by: str

# Audit Logging
def create_audit_log(conn, log: AuditLog):
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO audit_logs (action, entity_type, entity_id, changes, updated_by) VALUES (%s, %s, %s, %s, %s)",
            (log.action, log.entity_type, log.entity_id, json.dumps(log.changes), log.updated_by)
        )
    conn.commit()

# Admin Authentication (simplified)
def verify_admin_token(token: str = None):
    if not token or token != "admin-token-123":
        raise HTTPException(status_code=401, detail="Invalid admin token")
    return True

# Transaction Fee Management Endpoints
@app.get("/admin/fees")
async def get_transaction_fees(db: psycopg2.extensions.connection = Depends(get_db_connection)):
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM transaction_fees")
        fees = cur.fetchall()
    return {"fees": fees}

@app.put("/admin/fees/{method}")
async def update_transaction_fee(method: str, fee_data: TransactionFee, background_tasks: BackgroundTasks, db: psycopg2.extensions.connection = Depends(get_db_connection), admin_token: str = Depends(verify_admin_token)):
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM transaction_fees WHERE method = %s", (method,))
        existing_fee = cur.fetchone()
        if not existing_fee:
            raise HTTPException(status_code=404, detail="Payment method not found")

        update_query = "UPDATE transaction_fees SET fee_type=%s, flat_fee=%s, percentage=%s, description=%s, active=%s WHERE method=%s"
        cur.execute(update_query, (fee_data.fee_type, fee_data.flat_fee, fee_data.percentage, fee_data.description, fee_data.active, method))
        db.commit()

        log = AuditLog(action="update", entity_type="transaction_fee", entity_id=method, changes=fee_data.dict(), updated_by="admin")
        create_audit_log(db, log)

    return {"message": f"Transaction fee for {method} updated successfully"}

# ... (Implement other endpoints for Billing Plans, Volume Discounts, and Platform Settings in a similar fashion) ...


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8026)



# Billing Plan Management Endpoints
@app.get("/admin/plans")
async def get_billing_plans(db: psycopg2.extensions.connection = Depends(get_db_connection)):
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM billing_plans")
        plans = cur.fetchall()
    return {"plans": plans}

@app.put("/admin/plans/{plan_id}")
async def update_billing_plan(plan_id: str, plan_data: BillingPlan, background_tasks: BackgroundTasks, db: psycopg2.extensions.connection = Depends(get_db_connection), admin_token: str = Depends(verify_admin_token)):
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM billing_plans WHERE plan_id = %s", (plan_id,))
        existing_plan = cur.fetchone()
        if not existing_plan:
            raise HTTPException(status_code=404, detail="Billing plan not found")

        update_query = "UPDATE billing_plans SET name=%s, monthly_cost=%s, max_providers=%s, per_dispute_fee=%s, included_transactions=%s, features=%s, active=%s WHERE plan_id=%s"
        cur.execute(update_query, (plan_data.name, plan_data.monthly_cost, plan_data.max_providers, plan_data.per_dispute_fee, plan_data.included_transactions, plan_data.features, plan_data.active, plan_id))
        db.commit()

        log = AuditLog(action="update", entity_type="billing_plan", entity_id=plan_id, changes=plan_data.dict(), updated_by="admin")
        create_audit_log(db, log)

    return {"message": f"Billing plan {plan_id} updated successfully"}

# Volume Discount Management Endpoints
@app.get("/admin/discounts")
async def get_volume_discounts(db: psycopg2.extensions.connection = Depends(get_db_connection)):
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM volume_discounts")
        discounts = cur.fetchall()
    return {"discounts": discounts}

@app.put("/admin/discounts/{tier_name}")
async def update_volume_discount(tier_name: str, discount_data: VolumeDiscount, background_tasks: BackgroundTasks, db: psycopg2.extensions.connection = Depends(get_db_connection), admin_token: str = Depends(verify_admin_token)):
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM volume_discounts WHERE tier_name = %s", (tier_name,))
        existing_discount = cur.fetchone()
        if not existing_discount:
            raise HTTPException(status_code=404, detail="Volume discount tier not found")

        update_query = "UPDATE volume_discounts SET min_transactions=%s, max_transactions=%s, discount_percentage=%s, applies_to=%s, active=%s WHERE tier_name=%s"
        cur.execute(update_query, (discount_data.min_transactions, discount_data.max_transactions, discount_data.discount_percentage, discount_data.applies_to, discount_data.active, tier_name))
        db.commit()

        log = AuditLog(action="update", entity_type="volume_discount", entity_id=tier_name, changes=discount_data.dict(), updated_by="admin")
        create_audit_log(db, log)

    return {"message": f"Volume discount {tier_name} updated successfully"}

# Platform Settings Management Endpoints
@app.get("/admin/settings")
async def get_platform_settings(db: psycopg2.extensions.connection = Depends(get_db_connection)):
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM platform_settings")
        settings = cur.fetchall()
    return {"settings": settings}

@app.put("/admin/settings/{setting_key}")
async def update_platform_setting(setting_key: str, setting_data: PlatformSettings, background_tasks: BackgroundTasks, db: psycopg2.extensions.connection = Depends(get_db_connection), admin_token: str = Depends(verify_admin_token)):
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM platform_settings WHERE setting_key = %s", (setting_key,))
        existing_setting = cur.fetchone()
        if not existing_setting:
            raise HTTPException(status_code=404, detail="Platform setting not found")

        update_query = "UPDATE platform_settings SET setting_value=%s, setting_type=%s, description=%s, category=%s WHERE setting_key=%s"
        cur.execute(update_query, (setting_data.setting_value, setting_data.setting_type, setting_data.description, setting_data.category, setting_key))
        db.commit()

        log = AuditLog(action="update", entity_type="platform_setting", entity_id=setting_key, changes=setting_data.dict(), updated_by="admin")
        create_audit_log(db, log)

    return {"message": f"Platform setting {setting_key} updated successfully"}




from fastapi import WebSocket, WebSocketDisconnect

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def send_personal_message(self, message: str, websocket: WebSocket):
        await websocket.send_text(message)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            await connection.send_text(message)

manager = ConnectionManager()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            await manager.broadcast(f"Client said: {data}")
    except WebSocketDisconnect:
        manager.disconnect(websocket)


async def broadcast_update(update: dict):
    await manager.broadcast(json.dumps(update))


@app.put("/admin/fees/{method}")
async def update_transaction_fee(method: str, fee_data: TransactionFee, background_tasks: BackgroundTasks, db: psycopg2.extensions.connection = Depends(get_db_connection), admin_token: str = Depends(verify_admin_token)):
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM transaction_fees WHERE method = %s", (method,))
        existing_fee = cur.fetchone()
        if not existing_fee:
            raise HTTPException(status_code=404, detail="Payment method not found")

        update_query = "UPDATE transaction_fees SET fee_type=%s, flat_fee=%s, percentage=%s, description=%s, active=%s, updated_at=NOW() WHERE method=%s"
        cur.execute(update_query, (fee_data.fee_type, fee_data.flat_fee, fee_data.percentage, fee_data.description, fee_data.active, method))
        db.commit()

        log = AuditLog(action="update", entity_type="transaction_fee", entity_id=method, changes=fee_data.dict(), updated_by="admin")
        create_audit_log(db, log)
        background_tasks.add_task(broadcast_update, {**log.dict(), "entity_id": method})

    return {"message": f"Transaction fee for {method} updated successfully"}

