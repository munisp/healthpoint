"""
Flexible Refund Processing Service
Handles NSA/IDR fee refunds with options for direct provider payments or aggregator redistribution
Supports multiple payment methods and batch processing
"""


# ── Shared HealthPoint infrastructure ─────────────────────────────────────────
import os
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
from typing import List, Optional, Dict, Any, Union
from datetime import datetime, date, timedelta
from enum import Enum
import asyncio
import json
import logging
from decimal import Decimal, ROUND_HALF_UP
from sqlalchemy import create_engine, Column, String, DateTime, Integer, Text, Boolean, Decimal as SQLDecimal, Date, ForeignKey, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship
import redis.asyncio as redis
from cryptography.fernet import Fernet
import stripe
import uuid
from collections import defaultdict
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from shared.telemetry import setup_telemetry, instrument_fastapi, get_tracer

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

setup_telemetry(service_name="flexible-refund-processing-service", service_version="1.0.0")
app = FastAPI(title="Flexible Refund Processing Service", version="1.0.0")
instrument_fastapi(app)

app.middleware("http")(security_headers_middleware)

# Database setup
DATABASE_URL = os.environ["DATABASE_URL"]
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Redis setup for caching and job queues
# Redis client initialized via shared cache module
# Use: from backend.shared.cache import get_client as get_redis_client

# Encryption setup
ENCRYPTION_KEY = Fernet.generate_key()  # In production, use secure key management
cipher_suite = Fernet(ENCRYPTION_KEY)

# Stripe setup
stripe.api_key = os.getenv("STRIPE_API_KEY", "")

class RefundStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    PARTIAL = "partial"

class RefundMethod(str, Enum):
    DIRECT_TO_PROVIDER = "direct_to_provider"
    TO_AGGREGATOR = "to_aggregator"
    MIXED = "mixed"

class PaymentMethodType(str, Enum):
    ACH = "ach"
    WIRE_TRANSFER = "wire_transfer"
    CHECK = "check"
    CREDIT_CARD = "credit_card"

class RefundType(str, Enum):
    NSA_IDR_FEE = "nsa_idr_fee"
    OVERPAYMENT = "overpayment"
    DISPUTE_RESOLUTION = "dispute_resolution"
    ADMINISTRATIVE_FEE = "administrative_fee"

# Database Models
class RefundBatch(Base):
    __tablename__ = "refund_batches"
    
    id = Column(Integer, primary_key=True, index=True)
    batch_id = Column(String(100), unique=True, index=True)
    aggregator_id = Column(String(50), index=True)
    refund_type = Column(String(30))
    refund_method = Column(String(30))
    total_amount = Column(SQLDecimal(15, 2))
    total_refunds = Column(Integer)
    successful_refunds = Column(Integer, default=0)
    failed_refunds = Column(Integer, default=0)
    status = Column(String(20), default=RefundStatus.PENDING.value)
    processing_date = Column(DateTime)
    completion_date = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    individual_refunds = relationship("IndividualRefund", back_populates="batch")
    processing_logs = relationship("RefundProcessingLog", back_populates="batch")

class IndividualRefund(Base):
    __tablename__ = "individual_refunds"
    
    id = Column(Integer, primary_key=True, index=True)
    refund_id = Column(String(100), unique=True, index=True)
    batch_id = Column(String(100), ForeignKey("refund_batches.batch_id"))
    provider_npi = Column(String(10), index=True)
    provider_name = Column(String(255))
    aggregator_id = Column(String(50))
    
    # Refund details
    original_amount = Column(SQLDecimal(15, 2))  # Original fee amount
    refund_amount = Column(SQLDecimal(15, 2))    # Amount to be refunded
    aggregator_fee = Column(SQLDecimal(15, 2), default=0)  # Fee retained by aggregator
    processing_fee = Column(SQLDecimal(15, 2), default=0)  # Processing fee
    
    # Payment details
    payment_method = Column(String(20))
    payment_details = Column(JSON)  # Encrypted payment information
    
    # Status and tracking
    status = Column(String(20), default=RefundStatus.PENDING.value)
    transaction_id = Column(String(100))
    external_reference = Column(String(100))  # Bank/processor reference
    processing_date = Column(DateTime)
    completion_date = Column(DateTime)
    failure_reason = Column(Text)
    
    # Metadata
    dispute_claim_id = Column(String(50))
    cms_confirmation_number = Column(String(100))
    idr_decision_date = Column(Date)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    batch = relationship("RefundBatch", back_populates="individual_refunds")

class AggregatorRefund(Base):
    __tablename__ = "aggregator_refunds"
    
    id = Column(Integer, primary_key=True, index=True)
    refund_id = Column(String(100), unique=True, index=True)
    batch_id = Column(String(100), ForeignKey("refund_batches.batch_id"))
    aggregator_id = Column(String(50))
    
    # Consolidated refund details
    total_provider_refunds = Column(SQLDecimal(15, 2))
    aggregator_fee_retained = Column(SQLDecimal(15, 2))
    processing_fees = Column(SQLDecimal(15, 2))
    net_refund_amount = Column(SQLDecimal(15, 2))
    
    # Provider breakdown
    provider_count = Column(Integer)
    provider_breakdown = Column(JSON)  # List of providers and their refund amounts
    
    # Payment details
    payment_method = Column(String(20))
    payment_details = Column(JSON)
    
    # Status and tracking
    status = Column(String(20), default=RefundStatus.PENDING.value)
    transaction_id = Column(String(100))
    external_reference = Column(String(100))
    processing_date = Column(DateTime)
    completion_date = Column(DateTime)
    failure_reason = Column(Text)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class RefundProcessingLog(Base):
    __tablename__ = "refund_processing_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    batch_id = Column(String(100), ForeignKey("refund_batches.batch_id"))
    refund_id = Column(String(100))
    action = Column(String(100))
    status = Column(String(20))
    details = Column(JSON)
    error_message = Column(Text)
    timestamp = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    batch = relationship("RefundBatch", back_populates="processing_logs")

# Pydantic Models
class RefundRequest(BaseModel):
    aggregator_id: str
    refund_type: RefundType
    refund_method: RefundMethod
    provider_refunds: List[Dict[str, Any]]  # List of provider refund details
    processing_delay_days: int = Field(default=0, ge=0, le=30)
    batch_processing: bool = Field(default=True)

class ProviderRefundDetail(BaseModel):
    provider_npi: str = Field(..., min_length=10, max_length=10)
    provider_name: str
    original_amount: Decimal = Field(..., gt=0)
    refund_amount: Decimal = Field(..., gt=0)
    dispute_claim_id: Optional[str] = None
    cms_confirmation_number: Optional[str] = None
    idr_decision_date: Optional[date] = None

class RefundProcessingResult(BaseModel):
    batch_id: str
    total_refunds: int
    successful_refunds: int
    failed_refunds: int
    total_amount: Decimal
    status: RefundStatus
    processing_details: Dict[str, Any]

# Flexible Refund Processing Engine
class FlexibleRefundProcessor:
    def __init__(self):
        self.cipher = cipher_suite
        self.stripe_client = stripe
    
    async def process_refund_batch(self, refund_request: RefundRequest) -> RefundProcessingResult:
        """Process a batch of refunds based on aggregator preferences"""
        db = SessionLocal()
        try:
            # Generate batch ID
            batch_id = f"REFUND-{refund_request.aggregator_id}-{datetime.utcnow().strftime('%Y%m%d')}-{uuid.uuid4().hex[:8].upper()}"
            
            # Get aggregator refund preferences
            from provider_payment_details_service import AggregatorRefundPreference
            aggregator_prefs = db.query(AggregatorRefundPreference).filter(
                AggregatorRefundPreference.aggregator_id == refund_request.aggregator_id
            ).first()
            
            if not aggregator_prefs:
                raise HTTPException(status_code=404, detail="Aggregator refund preferences not found")
            
            # Create refund batch
            total_amount = sum(Decimal(str(refund['refund_amount'])) for refund in refund_request.provider_refunds)
            
            refund_batch = RefundBatch(
                batch_id=batch_id,
                aggregator_id=refund_request.aggregator_id,
                refund_type=refund_request.refund_type.value,
                refund_method=refund_request.refund_method.value,
                total_amount=total_amount,
                total_refunds=len(refund_request.provider_refunds),
                status=RefundStatus.PENDING.value
            )
            
            db.add(refund_batch)
            db.commit()
            db.refresh(refund_batch)
            
            # Log batch creation
            await self._log_processing_action(
                batch_id, None, "BATCH_CREATED", RefundStatus.PENDING.value,
                {"total_refunds": len(refund_request.provider_refunds), "total_amount": float(total_amount)}
            )
            
            # Process based on refund method
            if refund_request.refund_method == RefundMethod.DIRECT_TO_PROVIDER:
                result = await self._process_direct_provider_refunds(
                    batch_id, refund_request.aggregator_id, refund_request.provider_refunds, aggregator_prefs
                )
            elif refund_request.refund_method == RefundMethod.TO_AGGREGATOR:
                result = await self._process_aggregator_consolidated_refund(
                    batch_id, refund_request.aggregator_id, refund_request.provider_refunds, aggregator_prefs
                )
            else:  # MIXED
                result = await self._process_mixed_refunds(
                    batch_id, refund_request.aggregator_id, refund_request.provider_refunds, aggregator_prefs
                )
            
            # Update batch status
            refund_batch.successful_refunds = result["successful_refunds"]
            refund_batch.failed_refunds = result["failed_refunds"]
            refund_batch.processing_date = datetime.utcnow()
            
            if result["failed_refunds"] == 0:
                refund_batch.status = RefundStatus.COMPLETED.value
                refund_batch.completion_date = datetime.utcnow()
            elif result["successful_refunds"] > 0:
                refund_batch.status = RefundStatus.PARTIAL.value
            else:
                refund_batch.status = RefundStatus.FAILED.value
            
            db.commit()
            
            return RefundProcessingResult(
                batch_id=batch_id,
                total_refunds=len(refund_request.provider_refunds),
                successful_refunds=result["successful_refunds"],
                failed_refunds=result["failed_refunds"],
                total_amount=total_amount,
                status=RefundStatus(refund_batch.status),
                processing_details=result["details"]
            )
            
        except Exception as e:
            db.rollback()
            logger.error(f"Refund processing error: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Refund processing failed: {str(e)}")
        finally:
            db.close()
    
    async def _process_direct_provider_refunds(self, batch_id: str, aggregator_id: str, 
                                             provider_refunds: List[Dict[str, Any]], 
                                             aggregator_prefs) -> Dict[str, Any]:
        """Process refunds directly to individual providers"""
        db = SessionLocal()
        successful = 0
        failed = 0
        details = {"direct_refunds": [], "failed_refunds": []}
        
        try:
            for refund_data in provider_refunds:
                try:
                    # Get provider payment details
                    from provider_payment_details_service import ProviderPaymentDetails
                    provider_payment = db.query(ProviderPaymentDetails).filter(
                        ProviderPaymentDetails.provider_npi == refund_data['provider_npi'],
                        ProviderPaymentDetails.aggregator_id == aggregator_id,
                        ProviderPaymentDetails.status == "verified"
                    ).first()
                    
                    if not provider_payment:
                        failed += 1
                        details["failed_refunds"].append({
                            "provider_npi": refund_data['provider_npi'],
                            "reason": "No verified payment details found"
                        })
                        continue
                    
                    # Calculate refund amount after fees
                    original_amount = Decimal(str(refund_data['refund_amount']))
                    aggregator_fee_rate = aggregator_prefs.aggregator_fee_percentage / 100
                    processing_fee = aggregator_prefs.processing_fee
                    
                    aggregator_fee = (original_amount * aggregator_fee_rate).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
                    net_refund_amount = original_amount - aggregator_fee - processing_fee
                    
                    if net_refund_amount <= 0:
                        failed += 1
                        details["failed_refunds"].append({
                            "provider_npi": refund_data['provider_npi'],
                            "reason": "Refund amount after fees is zero or negative"
                        })
                        continue
                    
                    # Create individual refund record
                    refund_id = f"REF-{batch_id}-{refund_data['provider_npi']}"
                    individual_refund = IndividualRefund(
                        refund_id=refund_id,
                        batch_id=batch_id,
                        provider_npi=refund_data['provider_npi'],
                        provider_name=refund_data.get('provider_name', ''),
                        aggregator_id=aggregator_id,
                        original_amount=original_amount,
                        refund_amount=net_refund_amount,
                        aggregator_fee=aggregator_fee,
                        processing_fee=processing_fee,
                        payment_method=provider_payment.payment_method_type,
                        dispute_claim_id=refund_data.get('dispute_claim_id'),
                        cms_confirmation_number=refund_data.get('cms_confirmation_number'),
                        status=RefundStatus.PROCESSING.value
                    )
                    
                    db.add(individual_refund)
                    db.commit()
                    db.refresh(individual_refund)
                    
                    # Process payment based on method
                    payment_success = await self._execute_provider_payment(
                        individual_refund, provider_payment
                    )
                    
                    if payment_success:
                        individual_refund.status = RefundStatus.COMPLETED.value
                        individual_refund.completion_date = datetime.utcnow()
                        successful += 1
                        details["direct_refunds"].append({
                            "provider_npi": refund_data['provider_npi'],
                            "refund_amount": float(net_refund_amount),
                            "payment_method": provider_payment.payment_method_type,
                            "transaction_id": individual_refund.transaction_id
                        })
                    else:
                        individual_refund.status = RefundStatus.FAILED.value
                        failed += 1
                        details["failed_refunds"].append({
                            "provider_npi": refund_data['provider_npi'],
                            "reason": individual_refund.failure_reason or "Payment processing failed"
                        })
                    
                    db.commit()
                    
                except Exception as e:
                    logger.error(f"Error processing refund for provider {refund_data['provider_npi']}: {str(e)}")
                    failed += 1
                    details["failed_refunds"].append({
                        "provider_npi": refund_data['provider_npi'],
                        "reason": str(e)
                    })
            
            return {
                "successful_refunds": successful,
                "failed_refunds": failed,
                "details": details
            }
            
        finally:
            db.close()
    
    async def _process_aggregator_consolidated_refund(self, batch_id: str, aggregator_id: str,
                                                    provider_refunds: List[Dict[str, Any]],
                                                    aggregator_prefs) -> Dict[str, Any]:
        """Process consolidated refund to aggregator for redistribution"""
        db = SessionLocal()
        
        try:
            # Calculate total amounts
            total_provider_refunds = sum(Decimal(str(refund['refund_amount'])) for refund in provider_refunds)
            aggregator_fee_rate = aggregator_prefs.aggregator_fee_percentage / 100
            processing_fee_total = aggregator_prefs.processing_fee * len(provider_refunds)
            
            aggregator_fee_retained = (total_provider_refunds * aggregator_fee_rate).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            net_refund_amount = total_provider_refunds - processing_fee_total  # Aggregator gets full amount minus processing fees
            
            # Create provider breakdown
            provider_breakdown = []
            for refund_data in provider_refunds:
                provider_breakdown.append({
                    "provider_npi": refund_data['provider_npi'],
                    "provider_name": refund_data.get('provider_name', ''),
                    "original_amount": float(Decimal(str(refund_data['refund_amount']))),
                    "dispute_claim_id": refund_data.get('dispute_claim_id'),
                    "cms_confirmation_number": refund_data.get('cms_confirmation_number')
                })
            
            # Create aggregator refund record
            refund_id = f"AGG-REF-{batch_id}"
            aggregator_refund = AggregatorRefund(
                refund_id=refund_id,
                batch_id=batch_id,
                aggregator_id=aggregator_id,
                total_provider_refunds=total_provider_refunds,
                aggregator_fee_retained=aggregator_fee_retained,
                processing_fees=processing_fee_total,
                net_refund_amount=net_refund_amount,
                provider_count=len(provider_refunds),
                provider_breakdown=provider_breakdown,
                payment_method=aggregator_prefs.aggregator_payment_method,
                status=RefundStatus.PROCESSING.value
            )
            
            db.add(aggregator_refund)
            db.commit()
            db.refresh(aggregator_refund)
            
            # Process payment to aggregator
            payment_success = await self._execute_aggregator_payment(aggregator_refund, aggregator_prefs)
            
            if payment_success:
                aggregator_refund.status = RefundStatus.COMPLETED.value
                aggregator_refund.completion_date = datetime.utcnow()
                db.commit()
                
                return {
                    "successful_refunds": len(provider_refunds),
                    "failed_refunds": 0,
                    "details": {
                        "aggregator_refund": {
                            "refund_id": refund_id,
                            "net_amount": float(net_refund_amount),
                            "provider_count": len(provider_refunds),
                            "transaction_id": aggregator_refund.transaction_id
                        }
                    }
                }
            else:
                aggregator_refund.status = RefundStatus.FAILED.value
                db.commit()
                
                return {
                    "successful_refunds": 0,
                    "failed_refunds": len(provider_refunds),
                    "details": {
                        "error": aggregator_refund.failure_reason or "Aggregator payment failed"
                    }
                }
                
        except Exception as e:
            logger.error(f"Error processing aggregator consolidated refund: {str(e)}")
            return {
                "successful_refunds": 0,
                "failed_refunds": len(provider_refunds),
                "details": {"error": str(e)}
            }
        finally:
            db.close()
    
    async def _process_mixed_refunds(self, batch_id: str, aggregator_id: str,
                                   provider_refunds: List[Dict[str, Any]],
                                   aggregator_prefs) -> Dict[str, Any]:
        """Process mixed refunds based on provider-specific preferences"""
        # For mixed processing, we need to check provider-specific overrides
        # This is a simplified implementation - in practice, you'd check provider preferences
        
        # Split providers based on some criteria (e.g., provider preferences, amount thresholds)
        direct_refunds = []
        aggregator_refunds = []
        
        for refund_data in provider_refunds:
            # Example logic: Large amounts go direct, smaller amounts through aggregator
            amount = Decimal(str(refund_data['refund_amount']))
            if amount > 1000:  # Threshold for direct payment
                direct_refunds.append(refund_data)
            else:
                aggregator_refunds.append(refund_data)
        
        # Process direct refunds
        direct_result = {"successful_refunds": 0, "failed_refunds": 0, "details": {}}
        if direct_refunds:
            direct_result = await self._process_direct_provider_refunds(
                batch_id, aggregator_id, direct_refunds, aggregator_prefs
            )
        
        # Process aggregator refunds
        aggregator_result = {"successful_refunds": 0, "failed_refunds": 0, "details": {}}
        if aggregator_refunds:
            aggregator_result = await self._process_aggregator_consolidated_refund(
                batch_id, aggregator_id, aggregator_refunds, aggregator_prefs
            )
        
        return {
            "successful_refunds": direct_result["successful_refunds"] + aggregator_result["successful_refunds"],
            "failed_refunds": direct_result["failed_refunds"] + aggregator_result["failed_refunds"],
            "details": {
                "direct_refunds": direct_result["details"],
                "aggregator_refunds": aggregator_result["details"]
            }
        }
    
    async def _execute_provider_payment(self, individual_refund: IndividualRefund, 
                                      provider_payment) -> bool:
        """Execute payment to individual provider"""
        try:
            if provider_payment.payment_method_type == "ach":
                # Process ACH payment
                transaction_id = await self._process_ach_payment(
                    individual_refund.refund_amount,
                    provider_payment,
                    f"NSA/IDR Refund - {individual_refund.dispute_claim_id}"
                )
                individual_refund.transaction_id = transaction_id
                return True
                
            elif provider_payment.payment_method_type == "credit_card":
                # Process credit card refund
                transaction_id = await self._process_card_refund(
                    individual_refund.refund_amount,
                    provider_payment
                )
                individual_refund.transaction_id = transaction_id
                return True
                
            elif provider_payment.payment_method_type == "wire_transfer":
                # Process wire transfer
                transaction_id = await self._process_wire_transfer(
                    individual_refund.refund_amount,
                    provider_payment,
                    f"NSA/IDR Refund - {individual_refund.dispute_claim_id}"
                )
                individual_refund.transaction_id = transaction_id
                return True
                
            elif provider_payment.payment_method_type == "check":
                # Generate check request
                transaction_id = await self._generate_check_request(
                    individual_refund.refund_amount,
                    provider_payment,
                    f"NSA/IDR Refund - {individual_refund.dispute_claim_id}"
                )
                individual_refund.transaction_id = transaction_id
                return True
                
            else:
                individual_refund.failure_reason = f"Unsupported payment method: {provider_payment.payment_method_type}"
                return False
                
        except Exception as e:
            logger.error(f"Payment execution error: {str(e)}")
            individual_refund.failure_reason = str(e)
            return False
    
    async def _execute_aggregator_payment(self, aggregator_refund: AggregatorRefund, 
                                        aggregator_prefs) -> bool:
        """Execute consolidated payment to aggregator"""
        try:
            if aggregator_prefs.aggregator_payment_method == "ach":
                # Decrypt aggregator payment details
                account_number = self.cipher.decrypt(aggregator_prefs.encrypted_aggregator_account.encode()).decode()
                routing_number = self.cipher.decrypt(aggregator_prefs.encrypted_aggregator_routing.encode()).decode()
                
                # Process ACH payment
                transaction_id = f"ACH-AGG-{uuid.uuid4().hex[:12].upper()}"
                
                # In real implementation, integrate with ACH processor
                logger.info(f"Processing ACH payment to aggregator: ${aggregator_refund.net_refund_amount}")
                
                aggregator_refund.transaction_id = transaction_id
                return True
                
            else:
                aggregator_refund.failure_reason = f"Unsupported aggregator payment method: {aggregator_prefs.aggregator_payment_method}"
                return False
                
        except Exception as e:
            logger.error(f"Aggregator payment execution error: {str(e)}")
            aggregator_refund.failure_reason = str(e)
            return False
    
    async def _process_ach_payment(self, amount: Decimal, provider_payment, description: str) -> str:
        """Process ACH payment (simulated)"""
        # In real implementation, integrate with ACH processor like Dwolla, Plaid, or bank API
        transaction_id = f"ACH-{uuid.uuid4().hex[:12].upper()}"
        logger.info(f"Processing ACH payment: ${amount} to {provider_payment.provider_name}")
        return transaction_id
    
    async def _process_card_refund(self, amount: Decimal, provider_payment) -> str:
        """Process credit card refund via Stripe"""
        try:
            # In real implementation, you'd have the original charge ID to refund
            # For now, we'll simulate a refund
            refund = self.stripe_client.Refund.create(
                amount=int(amount * 100),  # Stripe uses cents
                reason='requested_by_customer',
                metadata={
                    'provider_npi': provider_payment.provider_npi,
                    'refund_type': 'nsa_idr_fee'
                }
            )
            return refund.id
        except Exception as e:
            logger.error(f"Stripe refund error: {str(e)}")
            raise e
    
    async def _process_wire_transfer(self, amount: Decimal, provider_payment, description: str) -> str:
        """Process wire transfer (simulated)"""
        transaction_id = f"WIRE-{uuid.uuid4().hex[:12].upper()}"
        logger.info(f"Processing wire transfer: ${amount} to {provider_payment.provider_name}")
        return transaction_id
    
    async def _generate_check_request(self, amount: Decimal, provider_payment, description: str) -> str:
        """Generate check request (simulated)"""
        check_id = f"CHECK-{uuid.uuid4().hex[:12].upper()}"
        logger.info(f"Generating check: ${amount} to {provider_payment.provider_name}")
        return check_id
    
    async def _log_processing_action(self, batch_id: str, refund_id: Optional[str], 
                                   action: str, status: str, details: Dict[str, Any]):
        """Log refund processing action"""
        db = SessionLocal()
        try:
            log_entry = RefundProcessingLog(
                batch_id=batch_id,
                refund_id=refund_id,
                action=action,
                status=status,
                details=details
            )
            db.add(log_entry)
            db.commit()
        except Exception as e:
            logger.error(f"Logging error: {str(e)}")
        finally:
            db.close()

# API Endpoints
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

refund_processor = FlexibleRefundProcessor()

@app.post("/api/v1/refunds/process-batch", response_model=RefundProcessingResult)
async def process_refund_batch(
    refund_request: RefundRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Process a batch of refunds"""
    result = await refund_processor.process_refund_batch(refund_request)
    return result

@app.get("/api/v1/refunds/batch-status/{batch_id}")
async def get_batch_status(batch_id: str, db: Session = Depends(get_db),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get refund batch status"""
    batch = db.query(RefundBatch).filter(RefundBatch.batch_id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    # Get individual refunds
    individual_refunds = db.query(IndividualRefund).filter(
        IndividualRefund.batch_id == batch_id
    ).all()
    
    # Get aggregator refunds
    aggregator_refunds = db.query(AggregatorRefund).filter(
        AggregatorRefund.batch_id == batch_id
    ).all()
    
    return {
        "batch_id": batch.batch_id,
        "aggregator_id": batch.aggregator_id,
        "refund_type": batch.refund_type,
        "refund_method": batch.refund_method,
        "total_amount": float(batch.total_amount),
        "total_refunds": batch.total_refunds,
        "successful_refunds": batch.successful_refunds,
        "failed_refunds": batch.failed_refunds,
        "status": batch.status,
        "created_at": batch.created_at.isoformat(),
        "processing_date": batch.processing_date.isoformat() if batch.processing_date else None,
        "completion_date": batch.completion_date.isoformat() if batch.completion_date else None,
        "individual_refunds": [
            {
                "refund_id": refund.refund_id,
                "provider_npi": refund.provider_npi,
                "provider_name": refund.provider_name,
                "refund_amount": float(refund.refund_amount),
                "status": refund.status,
                "transaction_id": refund.transaction_id
            }
            for refund in individual_refunds
        ],
        "aggregator_refunds": [
            {
                "refund_id": refund.refund_id,
                "net_refund_amount": float(refund.net_refund_amount),
                "provider_count": refund.provider_count,
                "status": refund.status,
                "transaction_id": refund.transaction_id
            }
            for refund in aggregator_refunds
        ]
    }

@app.get("/api/v1/refunds/aggregator-summary/{aggregator_id}")
async def get_aggregator_refund_summary(aggregator_id: str, db: Session = Depends(get_db),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get refund summary for an aggregator"""
    batches = db.query(RefundBatch).filter(
        RefundBatch.aggregator_id == aggregator_id
    ).all()
    
    total_batches = len(batches)
    total_amount = sum(float(batch.total_amount) for batch in batches)
    total_refunds = sum(batch.total_refunds for batch in batches)
    successful_refunds = sum(batch.successful_refunds for batch in batches)
    
    return {
        "aggregator_id": aggregator_id,
        "total_batches": total_batches,
        "total_amount_refunded": total_amount,
        "total_refunds_processed": total_refunds,
        "successful_refunds": successful_refunds,
        "success_rate": (successful_refunds / total_refunds * 100) if total_refunds > 0 else 0,
        "recent_batches": [
            {
                "batch_id": batch.batch_id,
                "refund_type": batch.refund_type,
                "refund_method": batch.refund_method,
                "total_amount": float(batch.total_amount),
                "status": batch.status,
                "created_at": batch.created_at.isoformat()
            }
            for batch in sorted(batches, key=lambda x: x.created_at, reverse=True)[:10]
        ]
    }

@app.post("/api/v1/refunds/simulate-idr-decision")
async def simulate_idr_decision(
    aggregator_id: str,
    dispute_claims: List[Dict[str, Any]],
    decision_outcome: str = "provider_wins",  # provider_wins, payer_wins, split_decision
    db: Session = Depends(get_db)
,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Simulate IDR decision and trigger refund processing"""
    
    # Create refund requests based on IDR decision
    provider_refunds = []
    
    for claim in dispute_claims:
        if decision_outcome == "provider_wins":
            # Provider wins - full refund of IDR fee
            refund_amount = Decimal("350.00")  # Standard IDR fee
        elif decision_outcome == "payer_wins":
            # Payer wins - no refund
            continue
        else:  # split_decision
            # Split decision - partial refund
            refund_amount = Decimal("175.00")  # Half IDR fee
        
        provider_refunds.append({
            "provider_npi": claim["provider_npi"],
            "provider_name": claim.get("provider_name", ""),
            "refund_amount": float(refund_amount),
            "dispute_claim_id": claim["claim_id"],
            "cms_confirmation_number": claim.get("cms_confirmation_number"),
            "idr_decision_date": date.today().isoformat()
        })
    
    if not provider_refunds:
        return {"message": "No refunds to process based on IDR decision"}
    
    # Create refund request
    refund_request = RefundRequest(
        aggregator_id=aggregator_id,
        refund_type=RefundType.NSA_IDR_FEE,
        refund_method=RefundMethod.DIRECT_TO_PROVIDER,  # Default to direct
        provider_refunds=provider_refunds
    )
    
    # Process refunds
    result = await refund_processor.process_refund_batch(refund_request)
    
    return {
        "idr_decision": decision_outcome,
        "refund_processing_result": result.dict()
    }

# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "Flexible Refund Processing Service",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0.0"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8024)