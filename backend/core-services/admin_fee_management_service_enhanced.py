#!/usr/bin/env python3
"""
Enhanced Admin Fee Management Service
Provides dynamic configuration and management of all fees, billing plans, and platform settings with database persistence and audit logging.
Port: 8026
"""




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

app.middleware("http")(security_headers_middleware)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Database connection
DATABASE_URL = os.environ["DATABASE_URL"]

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


# ── Billing Plan Endpoints ────────────────────────────────────────────────────

@app.get("/api/v1/billing/plans")
def list_billing_plans(db: Session = Depends(get_db)):
    """List all billing plans."""
    plans = db.query(BillingPlan).filter(BillingPlan.is_active == True).all()
    return {"billing_plans": [p.__dict__ for p in plans]}


@app.post("/api/v1/billing/plans")
def create_billing_plan(plan_data: dict, db: Session = Depends(get_db)):
    """Create a new billing plan."""
    plan = BillingPlan(**plan_data)
    db.add(plan)
    db.commit()
    db.refresh(plan)
    log = AuditLog(action="create", entity_type="billing_plan", entity_id=str(plan.id),
                   changes=plan_data, updated_by="admin")
    create_audit_log(db, log)
    return {"message": "Billing plan created", "plan_id": plan.id}


@app.put("/api/v1/billing/plans/{plan_id}")
def update_billing_plan(plan_id: str, plan_data: dict, db: Session = Depends(get_db)):
    """Update an existing billing plan."""
    plan = db.query(BillingPlan).filter(BillingPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail=f"Billing plan {plan_id} not found")
    for key, value in plan_data.items():
        setattr(plan, key, value)
    db.commit()
    log = AuditLog(action="update", entity_type="billing_plan", entity_id=plan_id,
                   changes=plan_data, updated_by="admin")
    create_audit_log(db, log)
    return {"message": f"Billing plan {plan_id} updated"}


# ── Volume Discount Endpoints ─────────────────────────────────────────────────

@app.get("/api/v1/billing/volume-discounts")
def list_volume_discounts(db: Session = Depends(get_db)):
    """List all volume discount tiers."""
    discounts = db.query(VolumeDiscount).all()
    return {"volume_discounts": [d.__dict__ for d in discounts]}


@app.post("/api/v1/billing/volume-discounts")
def create_volume_discount(discount_data: dict, db: Session = Depends(get_db)):
    """Create a new volume discount tier."""
    discount = VolumeDiscount(**discount_data)
    db.add(discount)
    db.commit()
    db.refresh(discount)
    log = AuditLog(action="create", entity_type="volume_discount", entity_id=str(discount.id),
                   changes=discount_data, updated_by="admin")
    create_audit_log(db, log)
    return {"message": "Volume discount created", "discount_id": discount.id}


@app.put("/api/v1/billing/volume-discounts/{discount_id}")
def update_volume_discount(discount_id: str, discount_data: dict, db: Session = Depends(get_db)):
    """Update a volume discount tier."""
    discount = db.query(VolumeDiscount).filter(VolumeDiscount.id == discount_id).first()
    if not discount:
        raise HTTPException(status_code=404, detail=f"Volume discount {discount_id} not found")
    for key, value in discount_data.items():
        setattr(discount, key, value)
    db.commit()
    log = AuditLog(action="update", entity_type="volume_discount", entity_id=discount_id,
                   changes=discount_data, updated_by="admin")
    create_audit_log(db, log)
    return {"message": f"Volume discount {discount_id} updated"}


# ── Platform Settings Endpoints ───────────────────────────────────────────────

@app.get("/api/v1/platform/settings")
def get_platform_settings(db: Session = Depends(get_db)):
    """Get all platform configuration settings."""
    settings = db.query(PlatformSettings).all()
    return {"settings": {s.key: s.value for s in settings}}


@app.put("/api/v1/platform/settings/{key}")
def update_platform_setting(key: str, value: str, db: Session = Depends(get_db)):
    """Update a platform configuration setting."""
    setting = db.query(PlatformSettings).filter(PlatformSettings.key == key).first()
    if setting:
        old_value = setting.value
        setting.value = value
        setting.updated_at = datetime.utcnow()
    else:
        setting = PlatformSettings(key=key, value=value)
        db.add(setting)
        old_value = None
    db.commit()
    log = AuditLog(action="update", entity_type="platform_setting", entity_id=key,
                   changes={"key": key, "old_value": old_value, "new_value": value},
                   updated_by="admin")
    create_audit_log(db, log)
    return {"message": f"Platform setting '{key}' updated to '{value}'"}



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

