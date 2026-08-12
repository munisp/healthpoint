#!/usr/bin/env python3
"""
Admin Fee Management Service
Provides dynamic configuration and management of all fees, billing plans, and platform settings.
Port: 8025
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
from datetime import datetime, timedelta
import redis.asyncio as redis
import logging
from decimal import Decimal
import uuid
from shared.telemetry import setup_telemetry, instrument_fastapi, get_tracer

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

setup_telemetry(service_name="admin-fee-management-service", service_version="1.0.0")
app = FastAPI(title="Admin Fee Management Service", version="1.0.0")
instrument_fastapi(app)

app.middleware("http")(security_headers_middleware)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Redis connection for real-time configuration updates
# Redis client initialized via shared cache module
# Use: from backend.shared.cache import get_client as get_redis_client

# Data Models
class TransactionFee(BaseModel):
    method: str
    fee_type: str  # 'flat', 'percentage', 'percentage_plus_flat'
    flat_fee: Optional[float] = 0.0
    percentage: Optional[float] = 0.0
    description: str
    active: bool = True
    effective_date: datetime = datetime.now()

class BillingPlan(BaseModel):
    plan_id: str
    name: str
    monthly_cost: float
    max_providers: Optional[int] = None  # None for unlimited
    per_dispute_fee: float
    included_transactions: int
    features: List[str]
    active: bool = True
    created_date: datetime = datetime.now()
    
    @validator('max_providers')
    def validate_max_providers(cls, v):
        if v is not None and v < 0:
            raise ValueError('max_providers must be positive or None for unlimited')
        return v

class VolumeDiscount(BaseModel):
    tier_name: str
    min_transactions: int
    max_transactions: Optional[int] = None  # None for unlimited
    discount_percentage: float
    applies_to: List[str]  # payment methods this discount applies to
    active: bool = True

class PlatformSettings(BaseModel):
    setting_key: str
    setting_value: Any
    setting_type: str  # 'string', 'number', 'boolean', 'json'
    description: str
    category: str
    last_updated: datetime = datetime.now()
    updated_by: str

class ConfigurationUpdate(BaseModel):
    update_type: str  # 'fee', 'plan', 'discount', 'setting'
    update_data: Dict[str, Any]
    reason: str
    updated_by: str

# In-memory storage (in production, use proper database)
transaction_fees = {
    "ach_transfer": TransactionFee(
        method="ach_transfer",
        fee_type="flat",
        flat_fee=0.50,
        description="Standard ACH bank transfer"
    ),
    "same_day_ach": TransactionFee(
        method="same_day_ach",
        fee_type="flat",
        flat_fee=1.25,
        description="Expedited same-day ACH transfer"
    ),
    "wire_transfer": TransactionFee(
        method="wire_transfer",
        fee_type="flat",
        flat_fee=20.00,
        description="Secure wire transfer"
    ),
    "credit_card": TransactionFee(
        method="credit_card",
        fee_type="percentage_plus_flat",
        percentage=3.2,
        flat_fee=0.50,
        description="Credit card processing"
    ),
    "check": TransactionFee(
        method="check",
        fee_type="flat",
        flat_fee=2.75,
        description="Physical check printing and mailing"
    )
}

billing_plans = {
    "standard": BillingPlan(
        plan_id="standard",
        name="Standard Plan",
        monthly_cost=299.00,
        max_providers=25,
        per_dispute_fee=15.00,
        included_transactions=50,
        features=["Basic Reporting", "Email Support", "Standard Processing"]
    ),
    "premium": BillingPlan(
        plan_id="premium",
        name="Premium Plan",
        monthly_cost=599.00,
        max_providers=50,
        per_dispute_fee=12.00,
        included_transactions=100,
        features=["Advanced Analytics", "Priority Support", "Fast Processing", "Custom Reports"]
    ),
    "enterprise": BillingPlan(
        plan_id="enterprise",
        name="Enterprise Plan",
        monthly_cost=1299.00,
        max_providers=None,  # Unlimited
        per_dispute_fee=8.00,
        included_transactions=500,
        features=["Full Analytics Suite", "24/7 Support", "Instant Processing", "White-label Options", "API Access"]
    ),
    "nsa_idr_pro": BillingPlan(
        plan_id="nsa_idr_pro",
        name="NSA/IDR Pro Plan",
        monthly_cost=899.00,
        max_providers=75,
        per_dispute_fee=10.00,
        included_transactions=200,
        features=["NSA/IDR Specialized Processing", "Compliance Reporting", "Priority Support", "Advanced Analytics"]
    )
}

volume_discounts = {
    "tier_1": VolumeDiscount(
        tier_name="Low Volume",
        min_transactions=101,
        max_transactions=500,
        discount_percentage=10.0,
        applies_to=["ach_transfer", "same_day_ach", "check"]
    ),
    "tier_2": VolumeDiscount(
        tier_name="Medium Volume",
        min_transactions=501,
        max_transactions=1000,
        discount_percentage=20.0,
        applies_to=["ach_transfer", "same_day_ach", "wire_transfer", "check"]
    ),
    "tier_3": VolumeDiscount(
        tier_name="High Volume",
        min_transactions=1001,
        max_transactions=None,
        discount_percentage=30.0,
        applies_to=["ach_transfer", "same_day_ach", "wire_transfer", "credit_card", "check"]
    )
}

platform_settings = {
    "tax_rate": PlatformSettings(
        setting_key="tax_rate",
        setting_value=8.0,
        setting_type="number",
        description="Platform tax rate percentage",
        category="billing",
        updated_by="system"
    ),
    "max_file_size": PlatformSettings(
        setting_key="max_file_size",
        setting_value=50,
        setting_type="number",
        description="Maximum file upload size in MB",
        category="system",
        updated_by="system"
    ),
    "notification_email": PlatformSettings(
        setting_key="notification_email",
        setting_value="admin@nsaidr-platform.com",
        setting_type="string",
        description="Admin notification email address",
        category="notifications",
        updated_by="system"
    )
}

# Admin Authentication (simplified for demo)

# Transaction Fee Management Endpoints
@app.get("/admin/fees")
async def get_transaction_fees(admin_token: str = Depends(require_admin)):
    """Get all transaction fees"""
    return {
        "fees": transaction_fees,
        "total_methods": len(transaction_fees),
        "active_methods": len([f for f in transaction_fees.values() if f.active])
    }

@app.put("/admin/fees/{method}")
async def update_transaction_fee(
    method: str, 
    fee_data: TransactionFee,
    background_tasks: BackgroundTasks,
    admin_token: str = Depends(require_admin)
):
    """Update transaction fee for specific payment method"""
    if method not in transaction_fees:
        raise HTTPException(status_code=404, detail="Payment method not found")
    
    # Update fee
    transaction_fees[method] = fee_data
    
    # Publish update to Redis for real-time notifications
    background_tasks.add_task(
        publish_configuration_update,
        "fee_updated",
        {"method": method, "fee_data": fee_data.dict()}
    )
    
    logger.info(f"Transaction fee updated for {method}: {fee_data.dict()}")
    
    return {
        "message": f"Transaction fee for {method} updated successfully",
        "updated_fee": fee_data
    }

@app.post("/admin/fees")
async def create_transaction_fee(
    fee_data: TransactionFee,
    background_tasks: BackgroundTasks,
    admin_token: str = Depends(require_admin)
):
    """Create new transaction fee method"""
    if fee_data.method in transaction_fees:
        raise HTTPException(status_code=400, detail="Payment method already exists")
    
    transaction_fees[fee_data.method] = fee_data
    
    # Publish update to Redis
    background_tasks.add_task(
        publish_configuration_update,
        "fee_created",
        {"method": fee_data.method, "fee_data": fee_data.dict()}
    )
    
    logger.info(f"New transaction fee created: {fee_data.method}")
    
    return {
        "message": f"Transaction fee for {fee_data.method} created successfully",
        "created_fee": fee_data
    }

# Billing Plan Management Endpoints
@app.get("/admin/plans")
async def get_billing_plans(admin_token: str = Depends(require_admin)):
    """Get all billing plans"""
    return {
        "plans": billing_plans,
        "total_plans": len(billing_plans),
        "active_plans": len([p for p in billing_plans.values() if p.active])
    }

@app.put("/admin/plans/{plan_id}")
async def update_billing_plan(
    plan_id: str,
    plan_data: BillingPlan,
    background_tasks: BackgroundTasks,
    admin_token: str = Depends(require_admin)
):
    """Update billing plan"""
    if plan_id not in billing_plans:
        raise HTTPException(status_code=404, detail="Billing plan not found")
    
    # Ensure plan_id matches
    plan_data.plan_id = plan_id
    billing_plans[plan_id] = plan_data
    
    # Publish update to Redis
    background_tasks.add_task(
        publish_configuration_update,
        "plan_updated",
        {"plan_id": plan_id, "plan_data": plan_data.dict()}
    )
    
    logger.info(f"Billing plan updated: {plan_id}")
    
    return {
        "message": f"Billing plan {plan_id} updated successfully",
        "updated_plan": plan_data
    }

@app.post("/admin/plans")
async def create_billing_plan(
    plan_data: BillingPlan,
    background_tasks: BackgroundTasks,
    admin_token: str = Depends(require_admin)
):
    """Create new billing plan"""
    if plan_data.plan_id in billing_plans:
        raise HTTPException(status_code=400, detail="Billing plan already exists")
    
    billing_plans[plan_data.plan_id] = plan_data
    
    # Publish update to Redis
    background_tasks.add_task(
        publish_configuration_update,
        "plan_created",
        {"plan_id": plan_data.plan_id, "plan_data": plan_data.dict()}
    )
    
    logger.info(f"New billing plan created: {plan_data.plan_id}")
    
    return {
        "message": f"Billing plan {plan_data.plan_id} created successfully",
        "created_plan": plan_data
    }

# Volume Discount Management Endpoints
@app.get("/admin/discounts")
async def get_volume_discounts(admin_token: str = Depends(require_admin)):
    """Get all volume discounts"""
    return {
        "discounts": volume_discounts,
        "total_tiers": len(volume_discounts),
        "active_tiers": len([d for d in volume_discounts.values() if d.active])
    }

@app.put("/admin/discounts/{tier_id}")
async def update_volume_discount(
    tier_id: str,
    discount_data: VolumeDiscount,
    background_tasks: BackgroundTasks,
    admin_token: str = Depends(require_admin)
):
    """Update volume discount tier"""
    if tier_id not in volume_discounts:
        raise HTTPException(status_code=404, detail="Volume discount tier not found")
    
    volume_discounts[tier_id] = discount_data
    
    # Publish update to Redis
    background_tasks.add_task(
        publish_configuration_update,
        "discount_updated",
        {"tier_id": tier_id, "discount_data": discount_data.dict()}
    )
    
    logger.info(f"Volume discount updated: {tier_id}")
    
    return {
        "message": f"Volume discount {tier_id} updated successfully",
        "updated_discount": discount_data
    }

# Platform Settings Management Endpoints
@app.get("/admin/settings")
async def get_platform_settings(admin_token: str = Depends(require_admin)):
    """Get all platform settings"""
    return {
        "settings": platform_settings,
        "total_settings": len(platform_settings),
        "categories": list(set([s.category for s in platform_settings.values()]))
    }

@app.put("/admin/settings/{setting_key}")
async def update_platform_setting(
    setting_key: str,
    setting_data: PlatformSettings,
    background_tasks: BackgroundTasks,
    admin_token: str = Depends(require_admin)
):
    """Update platform setting"""
    if setting_key not in platform_settings:
        raise HTTPException(status_code=404, detail="Platform setting not found")
    
    # Ensure setting_key matches
    setting_data.setting_key = setting_key
    setting_data.last_updated = datetime.now()
    platform_settings[setting_key] = setting_data
    
    # Publish update to Redis
    background_tasks.add_task(
        publish_configuration_update,
        "setting_updated",
        {"setting_key": setting_key, "setting_data": setting_data.dict()}
    )
    
    logger.info(f"Platform setting updated: {setting_key}")
    
    return {
        "message": f"Platform setting {setting_key} updated successfully",
        "updated_setting": setting_data
    }

# Bulk Configuration Management
@app.post("/admin/bulk-update")
async def bulk_configuration_update(
    updates: List[ConfigurationUpdate],
    background_tasks: BackgroundTasks,
    admin_token: str = Depends(require_admin)
):
    """Perform bulk configuration updates"""
    results = []
    
    for update in updates:
        try:
            if update.update_type == "fee":
                method = update.update_data.get("method")
                if method and method in transaction_fees:
                    fee_data = TransactionFee(**update.update_data)
                    transaction_fees[method] = fee_data
                    results.append({"type": "fee", "method": method, "status": "updated"})
            
            elif update.update_type == "plan":
                plan_id = update.update_data.get("plan_id")
                if plan_id and plan_id in billing_plans:
                    plan_data = BillingPlan(**update.update_data)
                    billing_plans[plan_id] = plan_data
                    results.append({"type": "plan", "plan_id": plan_id, "status": "updated"})
            
            elif update.update_type == "setting":
                setting_key = update.update_data.get("setting_key")
                if setting_key and setting_key in platform_settings:
                    setting_data = PlatformSettings(**update.update_data)
                    platform_settings[setting_key] = setting_data
                    results.append({"type": "setting", "setting_key": setting_key, "status": "updated"})
                    
        except Exception as e:
            results.append({"type": update.update_type, "status": "error", "error": str(e)})
    
    # Publish bulk update notification
    background_tasks.add_task(
        publish_configuration_update,
        "bulk_update_completed",
        {"updates_count": len(updates), "results": results}
    )
    
    return {
        "message": f"Bulk update completed: {len(results)} items processed",
        "results": results
    }

# Configuration Export/Import
@app.get("/admin/export")
async def export_configuration(admin_token: str = Depends(require_admin)):
    """Export all configuration data"""
    export_data = {
        "transaction_fees": {k: v.dict() for k, v in transaction_fees.items()},
        "billing_plans": {k: v.dict() for k, v in billing_plans.items()},
        "volume_discounts": {k: v.dict() for k, v in volume_discounts.items()},
        "platform_settings": {k: v.dict() for k, v in platform_settings.items()},
        "export_timestamp": datetime.now().isoformat(),
        "export_id": str(uuid.uuid4())
    }
    
    return export_data

@app.post("/admin/import")
async def import_configuration(
    config_data: Dict[str, Any],
    background_tasks: BackgroundTasks,
    admin_token: str = Depends(require_admin)
):
    """Import configuration data"""
    try:
        # Import transaction fees
        if "transaction_fees" in config_data:
            for method, fee_data in config_data["transaction_fees"].items():
                transaction_fees[method] = TransactionFee(**fee_data)
        
        # Import billing plans
        if "billing_plans" in config_data:
            for plan_id, plan_data in config_data["billing_plans"].items():
                billing_plans[plan_id] = BillingPlan(**plan_data)
        
        # Import volume discounts
        if "volume_discounts" in config_data:
            for tier_id, discount_data in config_data["volume_discounts"].items():
                volume_discounts[tier_id] = VolumeDiscount(**discount_data)
        
        # Import platform settings
        if "platform_settings" in config_data:
            for setting_key, setting_data in config_data["platform_settings"].items():
                platform_settings[setting_key] = PlatformSettings(**setting_data)
        
        # Publish import notification
        background_tasks.add_task(
            publish_configuration_update,
            "configuration_imported",
            {"import_timestamp": datetime.now().isoformat()}
        )
        
        return {
            "message": "Configuration imported successfully",
            "imported_items": {
                "transaction_fees": len(config_data.get("transaction_fees", {})),
                "billing_plans": len(config_data.get("billing_plans", {})),
                "volume_discounts": len(config_data.get("volume_discounts", {})),
                "platform_settings": len(config_data.get("platform_settings", {}))
            }
        }
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Import failed: {str(e)}")

# Real-time Configuration Updates
async def publish_configuration_update(event_type: str, data: Dict[str, Any]):
    """Publish configuration updates to Redis for real-time notifications"""
    try:
        update_message = {
            "event_type": event_type,
            "data": data,
            "timestamp": datetime.now().isoformat(),
            "source": "admin_fee_management_service"
        }
        
        # Publish to Redis channel
        redis_client.publish("config_updates", json.dumps(update_message))
        
        # Store in Redis with expiration (24 hours)
        redis_client.setex(
            f"config_update:{datetime.now().timestamp()}",
            86400,  # 24 hours
            json.dumps(update_message)
        )
        
    except Exception as e:
        logger.error(f"Failed to publish configuration update: {str(e)}")

# Health Check
@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "Admin Fee Management Service",
        "timestamp": datetime.now().isoformat(),
        "version": "1.0.0"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8025)
