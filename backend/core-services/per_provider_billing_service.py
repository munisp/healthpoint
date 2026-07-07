"""
Per-Provider Billing Service
Implements billing system where aggregators pay based on number of providers submitted
Handles payment processing, invoicing, and billing reconciliation
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
from pydantic import BaseModel, Field, validator
from typing import List, Optional, Dict, Any, Set
from datetime import datetime, timedelta, date
from enum import Enum
import asyncio
import json
import logging
from decimal import Decimal, ROUND_HALF_UP
from sqlalchemy import create_engine, Column, String, DateTime, Integer, Text, Boolean, Decimal as SQLDecimal, Date, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship
import redis.asyncio as redis.asyncio as redis
from collections import defaultdict
import stripe
import uuid
from dataclasses import dataclass

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Per-Provider Billing Service", version="1.0.0")

app.middleware("http")(security_headers_middleware)

# Database setup
DATABASE_URL = os.environ["DATABASE_URL"]
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Redis setup for caching
# Redis client initialized via shared cache module
# Use: from backend.shared.cache import get_client as get_redis_client

# Stripe setup (for payment processing)
stripe.api_key = "sk_test_stripe_api_key_placeholder"  # In production, use secure key management

class BillingPeriod(str, Enum):
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    ANNUAL = "annual"

class PaymentStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    PAID = "paid"
    FAILED = "failed"
    REFUNDED = "refunded"
    DISPUTED = "disputed"

class PaymentMethod(str, Enum):
    CREDIT_CARD = "credit_card"
    ACH = "ach"
    WIRE_TRANSFER = "wire_transfer"
    CHECK = "check"

class InvoiceStatus(str, Enum):
    DRAFT = "draft"
    SENT = "sent"
    PAID = "paid"
    OVERDUE = "overdue"
    CANCELLED = "cancelled"

# Database Models
class BillingPlan(Base):
    __tablename__ = "billing_plans"
    
    id = Column(Integer, primary_key=True, index=True)
    plan_id = Column(String(50), unique=True, index=True)
    name = Column(String(255))
    description = Column(Text)
    base_rate = Column(SQLDecimal(10, 2))  # Base monthly rate
    per_provider_rate = Column(SQLDecimal(10, 2))  # Rate per provider submitted
    per_claim_rate = Column(SQLDecimal(10, 2))  # Rate per claim submitted
    billing_period = Column(String(20), default=BillingPeriod.MONTHLY.value)
    max_providers = Column(Integer)  # Maximum providers allowed
    features = Column(Text)  # JSON string of features
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class AggregatorBilling(Base):
    __tablename__ = "aggregator_billing"
    
    id = Column(Integer, primary_key=True, index=True)
    aggregator_id = Column(String(50), unique=True, index=True)
    billing_plan_id = Column(String(50), ForeignKey("billing_plans.plan_id"))
    billing_period = Column(String(20), default=BillingPeriod.MONTHLY.value)
    current_period_start = Column(Date)
    current_period_end = Column(Date)
    next_billing_date = Column(Date)
    payment_method = Column(String(20))
    stripe_customer_id = Column(String(100))
    auto_pay_enabled = Column(Boolean, default=False)
    billing_email = Column(String(255))
    billing_address = Column(Text)
    tax_rate = Column(SQLDecimal(5, 4), default=0.0)  # Tax rate as decimal (e.g., 0.0875 for 8.75%)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    billing_plan = relationship("BillingPlan")
    invoices = relationship("Invoice", back_populates="aggregator_billing")
    usage_records = relationship("UsageRecord", back_populates="aggregator_billing")

class UsageRecord(Base):
    __tablename__ = "usage_records"
    
    id = Column(Integer, primary_key=True, index=True)
    aggregator_id = Column(String(50), ForeignKey("aggregator_billing.aggregator_id"))
    billing_period_start = Column(Date)
    billing_period_end = Column(Date)
    providers_submitted = Column(Integer, default=0)
    claims_submitted = Column(Integer, default=0)
    unique_providers = Column(Integer, default=0)  # Count of unique providers
    total_dispute_amount = Column(SQLDecimal(15, 2), default=0)
    submission_count = Column(Integer, default=0)  # Number of bulk submissions
    calculated_amount = Column(SQLDecimal(10, 2))
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    aggregator_billing = relationship("AggregatorBilling", back_populates="usage_records")

class Invoice(Base):
    __tablename__ = "invoices"
    
    id = Column(Integer, primary_key=True, index=True)
    invoice_number = Column(String(50), unique=True, index=True)
    aggregator_id = Column(String(50), ForeignKey("aggregator_billing.aggregator_id"))
    billing_period_start = Column(Date)
    billing_period_end = Column(Date)
    issue_date = Column(Date, default=date.today)
    due_date = Column(Date)
    subtotal = Column(SQLDecimal(10, 2))
    tax_amount = Column(SQLDecimal(10, 2), default=0)
    total_amount = Column(SQLDecimal(10, 2))
    status = Column(String(20), default=InvoiceStatus.DRAFT.value)
    payment_terms = Column(String(50), default="Net 30")
    line_items = Column(Text)  # JSON string of line items
    notes = Column(Text)
    sent_date = Column(DateTime)
    paid_date = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    aggregator_billing = relationship("AggregatorBilling", back_populates="invoices")
    payments = relationship("Payment", back_populates="invoice")

class Payment(Base):
    __tablename__ = "payments"
    
    id = Column(Integer, primary_key=True, index=True)
    payment_id = Column(String(100), unique=True, index=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"))
    aggregator_id = Column(String(50))
    amount = Column(SQLDecimal(10, 2))
    payment_method = Column(String(20))
    payment_date = Column(DateTime)
    status = Column(String(20), default=PaymentStatus.PENDING.value)
    transaction_id = Column(String(100))  # External payment processor transaction ID
    stripe_payment_intent_id = Column(String(100))
    failure_reason = Column(Text)
    metadata = Column(Text)  # JSON string for additional payment data
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    invoice = relationship("Invoice", back_populates="payments")

# Pydantic Models
class BillingPlanCreate(BaseModel):
    name: str
    description: str
    base_rate: Decimal
    per_provider_rate: Decimal
    per_claim_rate: Decimal
    billing_period: BillingPeriod = BillingPeriod.MONTHLY
    max_providers: Optional[int] = None
    features: List[str] = []

class UsageData(BaseModel):
    aggregator_id: str
    providers_submitted: int
    claims_submitted: int
    unique_providers: int
    total_dispute_amount: Decimal
    submission_count: int

class InvoiceLineItem(BaseModel):
    description: str
    quantity: int
    unit_price: Decimal
    total_price: Decimal

class PaymentRequest(BaseModel):
    invoice_id: int
    payment_method: PaymentMethod
    amount: Decimal
    payment_method_details: Optional[Dict[str, Any]] = None

class BillingCalculationResult(BaseModel):
    aggregator_id: str
    billing_period_start: date
    billing_period_end: date
    base_rate: Decimal
    per_provider_charges: Decimal
    per_claim_charges: Decimal
    subtotal: Decimal
    tax_amount: Decimal
    total_amount: Decimal
    line_items: List[InvoiceLineItem]

# Per-Provider Billing Engine
class PerProviderBillingEngine:
    def __init__(self):
        self.tax_rates = {
            "default": Decimal("0.0875"),  # 8.75% default tax rate
            "CA": Decimal("0.1025"),       # California
            "NY": Decimal("0.08"),         # New York
            "TX": Decimal("0.0625"),       # Texas
            "FL": Decimal("0.06")          # Florida
        }
    
    async def calculate_billing_amount(self, aggregator_id: str, usage_data: UsageData, 
                                     billing_plan: BillingPlan, tax_rate: Decimal = None) -> BillingCalculationResult:
        """Calculate billing amount based on per-provider usage"""
        
        # Get billing period dates
        today = date.today()
        if billing_plan.billing_period == BillingPeriod.MONTHLY.value:
            period_start = today.replace(day=1)
            if today.month == 12:
                period_end = date(today.year + 1, 1, 1) - timedelta(days=1)
            else:
                period_end = date(today.year, today.month + 1, 1) - timedelta(days=1)
        elif billing_plan.billing_period == BillingPeriod.QUARTERLY.value:
            quarter = (today.month - 1) // 3 + 1
            period_start = date(today.year, (quarter - 1) * 3 + 1, 1)
            period_end = date(today.year, quarter * 3 + 1, 1) - timedelta(days=1)
        else:  # Annual
            period_start = date(today.year, 1, 1)
            period_end = date(today.year, 12, 31)
        
        # Calculate charges
        base_rate = billing_plan.base_rate or Decimal("0")
        per_provider_rate = billing_plan.per_provider_rate or Decimal("0")
        per_claim_rate = billing_plan.per_claim_rate or Decimal("0")
        
        # Per-provider charges (based on unique providers)
        per_provider_charges = per_provider_rate * usage_data.unique_providers
        
        # Per-claim charges
        per_claim_charges = per_claim_rate * usage_data.claims_submitted
        
        # Calculate subtotal
        subtotal = base_rate + per_provider_charges + per_claim_charges
        
        # Apply tax
        if tax_rate is None:
            tax_rate = self.tax_rates.get("default", Decimal("0"))
        
        tax_amount = (subtotal * tax_rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        total_amount = subtotal + tax_amount
        
        # Create line items
        line_items = []
        
        if base_rate > 0:
            line_items.append(InvoiceLineItem(
                description=f"{billing_plan.name} - Base Rate",
                quantity=1,
                unit_price=base_rate,
                total_price=base_rate
            ))
        
        if per_provider_charges > 0:
            line_items.append(InvoiceLineItem(
                description=f"Per-Provider Charges ({usage_data.unique_providers} providers)",
                quantity=usage_data.unique_providers,
                unit_price=per_provider_rate,
                total_price=per_provider_charges
            ))
        
        if per_claim_charges > 0:
            line_items.append(InvoiceLineItem(
                description=f"Per-Claim Charges ({usage_data.claims_submitted} claims)",
                quantity=usage_data.claims_submitted,
                unit_price=per_claim_rate,
                total_price=per_claim_charges
            ))
        
        return BillingCalculationResult(
            aggregator_id=aggregator_id,
            billing_period_start=period_start,
            billing_period_end=period_end,
            base_rate=base_rate,
            per_provider_charges=per_provider_charges,
            per_claim_charges=per_claim_charges,
            subtotal=subtotal,
            tax_amount=tax_amount,
            total_amount=total_amount,
            line_items=line_items
        )
    
    async def record_usage(self, usage_data: UsageData) -> UsageRecord:
        """Record usage data for billing calculation"""
        db = SessionLocal()
        try:
            # Get aggregator billing info
            aggregator_billing = db.query(AggregatorBilling).filter(
                AggregatorBilling.aggregator_id == usage_data.aggregator_id
            ).first()
            
            if not aggregator_billing:
                raise HTTPException(status_code=404, detail="Aggregator billing not found")
            
            # Calculate billing amount
            billing_plan = aggregator_billing.billing_plan
            calculation = await self.calculate_billing_amount(
                usage_data.aggregator_id,
                usage_data,
                billing_plan,
                aggregator_billing.tax_rate
            )
            
            # Create usage record
            usage_record = UsageRecord(
                aggregator_id=usage_data.aggregator_id,
                billing_period_start=calculation.billing_period_start,
                billing_period_end=calculation.billing_period_end,
                providers_submitted=usage_data.providers_submitted,
                claims_submitted=usage_data.claims_submitted,
                unique_providers=usage_data.unique_providers,
                total_dispute_amount=usage_data.total_dispute_amount,
                submission_count=usage_data.submission_count,
                calculated_amount=calculation.total_amount
            )
            
            db.add(usage_record)
            db.commit()
            db.refresh(usage_record)
            
            return usage_record
            
        except Exception as e:
            db.rollback()
            logger.error(f"Usage recording error: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to record usage: {str(e)}")
        finally:
            db.close()
    
    async def generate_invoice(self, aggregator_id: str, usage_record: UsageRecord) -> Invoice:
        """Generate invoice based on usage record"""
        db = SessionLocal()
        try:
            # Get aggregator billing info
            aggregator_billing = db.query(AggregatorBilling).filter(
                AggregatorBilling.aggregator_id == aggregator_id
            ).first()
            
            if not aggregator_billing:
                raise HTTPException(status_code=404, detail="Aggregator billing not found")
            
            # Generate invoice number
            invoice_number = f"INV-{aggregator_id}-{datetime.utcnow().strftime('%Y%m%d')}-{uuid.uuid4().hex[:8].upper()}"
            
            # Calculate due date (30 days from issue date)
            due_date = date.today() + timedelta(days=30)
            
            # Recalculate billing (in case rates have changed)
            usage_data = UsageData(
                aggregator_id=aggregator_id,
                providers_submitted=usage_record.providers_submitted,
                claims_submitted=usage_record.claims_submitted,
                unique_providers=usage_record.unique_providers,
                total_dispute_amount=usage_record.total_dispute_amount,
                submission_count=usage_record.submission_count
            )
            
            calculation = await self.calculate_billing_amount(
                aggregator_id,
                usage_data,
                aggregator_billing.billing_plan,
                aggregator_billing.tax_rate
            )
            
            # Create invoice
            invoice = Invoice(
                invoice_number=invoice_number,
                aggregator_id=aggregator_id,
                billing_period_start=usage_record.billing_period_start,
                billing_period_end=usage_record.billing_period_end,
                due_date=due_date,
                subtotal=calculation.subtotal,
                tax_amount=calculation.tax_amount,
                total_amount=calculation.total_amount,
                line_items=json.dumps([item.dict() for item in calculation.line_items]),
                status=InvoiceStatus.DRAFT.value
            )
            
            db.add(invoice)
            db.commit()
            db.refresh(invoice)
            
            return invoice
            
        except Exception as e:
            db.rollback()
            logger.error(f"Invoice generation error: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to generate invoice: {str(e)}")
        finally:
            db.close()

# Payment Processing Engine
class PaymentProcessingEngine:
    def __init__(self):
        self.stripe_client = stripe
    
    async def process_payment(self, payment_request: PaymentRequest) -> Payment:
        """Process payment for an invoice"""
        db = SessionLocal()
        try:
            # Get invoice
            invoice = db.query(Invoice).filter(Invoice.id == payment_request.invoice_id).first()
            if not invoice:
                raise HTTPException(status_code=404, detail="Invoice not found")
            
            # Create payment record
            payment_id = f"PAY-{uuid.uuid4().hex[:12].upper()}"
            payment = Payment(
                payment_id=payment_id,
                invoice_id=invoice.id,
                aggregator_id=invoice.aggregator_id,
                amount=payment_request.amount,
                payment_method=payment_request.payment_method.value,
                payment_date=datetime.utcnow(),
                status=PaymentStatus.PROCESSING.value
            )
            
            db.add(payment)
            db.commit()
            db.refresh(payment)
            
            # Process payment based on method
            if payment_request.payment_method == PaymentMethod.CREDIT_CARD:
                success = await self._process_stripe_payment(payment, payment_request.payment_method_details)
            elif payment_request.payment_method == PaymentMethod.ACH:
                success = await self._process_ach_payment(payment, payment_request.payment_method_details)
            else:
                # For wire transfer and check, mark as pending manual verification
                payment.status = PaymentStatus.PENDING.value
                success = True
            
            if success:
                if payment.status == PaymentStatus.PAID.value:
                    # Update invoice status
                    invoice.status = InvoiceStatus.PAID.value
                    invoice.paid_date = datetime.utcnow()
                
                db.commit()
                return payment
            else:
                payment.status = PaymentStatus.FAILED.value
                db.commit()
                raise HTTPException(status_code=400, detail="Payment processing failed")
                
        except Exception as e:
            db.rollback()
            logger.error(f"Payment processing error: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Payment failed: {str(e)}")
        finally:
            db.close()
    
    async def _process_stripe_payment(self, payment: Payment, payment_details: Dict[str, Any]) -> bool:
        """Process credit card payment via Stripe"""
        try:
            # Create payment intent
            intent = self.stripe_client.PaymentIntent.create(
                amount=int(payment.amount * 100),  # Stripe uses cents
                currency='usd',
                payment_method=payment_details.get('payment_method_id'),
                confirmation_method='manual',
                confirm=True,
                metadata={
                    'payment_id': payment.payment_id,
                    'invoice_id': str(payment.invoice_id),
                    'aggregator_id': payment.aggregator_id
                }
            )
            
            payment.stripe_payment_intent_id = intent.id
            payment.transaction_id = intent.id
            
            if intent.status == 'succeeded':
                payment.status = PaymentStatus.PAID.value
                return True
            elif intent.status == 'requires_action':
                payment.status = PaymentStatus.PROCESSING.value
                payment.metadata = json.dumps({'requires_action': True, 'client_secret': intent.client_secret})
                return True
            else:
                payment.status = PaymentStatus.FAILED.value
                payment.failure_reason = f"Stripe payment failed: {intent.status}"
                return False
                
        except stripe.error.StripeError as e:
            logger.error(f"Stripe payment error: {str(e)}")
            payment.status = PaymentStatus.FAILED.value
            payment.failure_reason = str(e)
            return False
    
    async def _process_ach_payment(self, payment: Payment, payment_details: Dict[str, Any]) -> bool:
        """Process ACH payment (simulated)"""
        try:
            # In a real implementation, this would integrate with an ACH processor
            # For now, we'll simulate the process
            
            # Validate ACH details
            required_fields = ['routing_number', 'account_number', 'account_type']
            for field in required_fields:
                if field not in payment_details:
                    payment.failure_reason = f"Missing required field: {field}"
                    return False
            
            # Simulate ACH processing delay
            payment.status = PaymentStatus.PROCESSING.value
            payment.transaction_id = f"ACH-{uuid.uuid4().hex[:12].upper()}"
            payment.metadata = json.dumps({
                'ach_processing': True,
                'expected_completion': (datetime.utcnow() + timedelta(days=3)).isoformat()
            })
            
            # In real implementation, this would be updated via webhook when ACH completes
            return True
            
        except Exception as e:
            logger.error(f"ACH payment error: {str(e)}")
            payment.failure_reason = str(e)
            return False

# API Endpoints
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

billing_engine = PerProviderBillingEngine()
payment_engine = PaymentProcessingEngine()

@app.post("/api/v1/billing/record-usage")
async def record_usage(usage_data: UsageData, db: Session = Depends(get_db),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Record usage data for billing calculation"""
    usage_record = await billing_engine.record_usage(usage_data)
    return {
        "status": "success",
        "usage_record_id": usage_record.id,
        "calculated_amount": float(usage_record.calculated_amount),
        "billing_period": f"{usage_record.billing_period_start} to {usage_record.billing_period_end}"
    }

@app.post("/api/v1/billing/generate-invoice/{aggregator_id}")
async def generate_invoice(aggregator_id: str, usage_record_id: int, db: Session = Depends(get_db),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Generate invoice for an aggregator based on usage"""
    usage_record = db.query(UsageRecord).filter(UsageRecord.id == usage_record_id).first()
    if not usage_record:
        raise HTTPException(status_code=404, detail="Usage record not found")
    
    invoice = await billing_engine.generate_invoice(aggregator_id, usage_record)
    return {
        "status": "success",
        "invoice_id": invoice.id,
        "invoice_number": invoice.invoice_number,
        "total_amount": float(invoice.total_amount),
        "due_date": invoice.due_date.isoformat()
    }

@app.get("/api/v1/billing/calculate/{aggregator_id}")
async def calculate_billing(aggregator_id: str, usage_data: UsageData, db: Session = Depends(get_db),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Calculate billing amount without recording usage"""
    aggregator_billing = db.query(AggregatorBilling).filter(
        AggregatorBilling.aggregator_id == aggregator_id
    ).first()
    
    if not aggregator_billing:
        raise HTTPException(status_code=404, detail="Aggregator billing not found")
    
    calculation = await billing_engine.calculate_billing_amount(
        aggregator_id,
        usage_data,
        aggregator_billing.billing_plan,
        aggregator_billing.tax_rate
    )
    
    return calculation

@app.post("/api/v1/billing/process-payment")
async def process_payment(payment_request: PaymentRequest, db: Session = Depends(get_db),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Process payment for an invoice"""
    payment = await payment_engine.process_payment(payment_request)
    return {
        "status": "success",
        "payment_id": payment.payment_id,
        "amount": float(payment.amount),
        "status": payment.status,
        "transaction_id": payment.transaction_id
    }

@app.get("/api/v1/billing/invoices/{aggregator_id}")
async def get_aggregator_invoices(aggregator_id: str, db: Session = Depends(get_db),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get all invoices for an aggregator"""
    invoices = db.query(Invoice).filter(
        Invoice.aggregator_id == aggregator_id
    ).order_by(Invoice.created_at.desc()).all()
    
    return [
        {
            "invoice_id": invoice.id,
            "invoice_number": invoice.invoice_number,
            "billing_period": f"{invoice.billing_period_start} to {invoice.billing_period_end}",
            "total_amount": float(invoice.total_amount),
            "status": invoice.status,
            "due_date": invoice.due_date.isoformat(),
            "created_at": invoice.created_at.isoformat()
        }
        for invoice in invoices
    ]

@app.get("/api/v1/billing/usage/{aggregator_id}")
async def get_aggregator_usage(aggregator_id: str, db: Session = Depends(get_db),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get usage records for an aggregator"""
    usage_records = db.query(UsageRecord).filter(
        UsageRecord.aggregator_id == aggregator_id
    ).order_by(UsageRecord.created_at.desc()).all()
    
    return [
        {
            "usage_record_id": record.id,
            "billing_period": f"{record.billing_period_start} to {record.billing_period_end}",
            "providers_submitted": record.providers_submitted,
            "claims_submitted": record.claims_submitted,
            "unique_providers": record.unique_providers,
            "calculated_amount": float(record.calculated_amount),
            "created_at": record.created_at.isoformat()
        }
        for record in usage_records
    ]

@app.post("/api/v1/billing/plans")
async def create_billing_plan(plan_data: BillingPlanCreate, db: Session = Depends(get_db),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Create a new billing plan"""
    plan_id = f"PLAN-{uuid.uuid4().hex[:8].upper()}"
    
    billing_plan = BillingPlan(
        plan_id=plan_id,
        name=plan_data.name,
        description=plan_data.description,
        base_rate=plan_data.base_rate,
        per_provider_rate=plan_data.per_provider_rate,
        per_claim_rate=plan_data.per_claim_rate,
        billing_period=plan_data.billing_period.value,
        max_providers=plan_data.max_providers,
        features=json.dumps(plan_data.features)
    )
    
    db.add(billing_plan)
    db.commit()
    db.refresh(billing_plan)
    
    return {
        "status": "success",
        "plan_id": billing_plan.plan_id,
        "name": billing_plan.name
    }

@app.get("/api/v1/billing/summary/{aggregator_id}")
async def get_billing_summary(aggregator_id: str, db: Session = Depends(get_db),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get billing summary for an aggregator"""
    # Get current billing info
    aggregator_billing = db.query(AggregatorBilling).filter(
        AggregatorBilling.aggregator_id == aggregator_id
    ).first()
    
    if not aggregator_billing:
        raise HTTPException(status_code=404, detail="Aggregator billing not found")
    
    # Get recent invoices
    recent_invoices = db.query(Invoice).filter(
        Invoice.aggregator_id == aggregator_id
    ).order_by(Invoice.created_at.desc()).limit(5).all()
    
    # Get usage summary
    usage_records = db.query(UsageRecord).filter(
        UsageRecord.aggregator_id == aggregator_id
    ).all()
    
    total_providers = sum(record.unique_providers for record in usage_records)
    total_claims = sum(record.claims_submitted for record in usage_records)
    total_billed = sum(float(invoice.total_amount) for invoice in recent_invoices)
    
    return {
        "aggregator_id": aggregator_id,
        "billing_plan": aggregator_billing.billing_plan.name,
        "billing_period": aggregator_billing.billing_period,
        "next_billing_date": aggregator_billing.next_billing_date.isoformat() if aggregator_billing.next_billing_date else None,
        "auto_pay_enabled": aggregator_billing.auto_pay_enabled,
        "summary": {
            "total_providers_submitted": total_providers,
            "total_claims_submitted": total_claims,
            "total_amount_billed": total_billed,
            "recent_invoices_count": len(recent_invoices)
        },
        "recent_invoices": [
            {
                "invoice_number": invoice.invoice_number,
                "amount": float(invoice.total_amount),
                "status": invoice.status,
                "due_date": invoice.due_date.isoformat()
            }
            for invoice in recent_invoices
        ]
    }

# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "Per-Provider Billing Service",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0.0"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8022)