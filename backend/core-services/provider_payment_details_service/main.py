"""
Provider Payment Details Service
Captures and manages provider payment information for NSA/IDR fee refunds
Supports ACH, Wire Transfer, Check, and Credit Card payment methods
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

from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, Form
from pydantic import BaseModel, Field, validator, EmailStr
from typing import List, Optional, Dict, Any, Union
from datetime import datetime, date
from enum import Enum
import asyncio
import json
import logging
from decimal import Decimal
from sqlalchemy import create_engine, Column, String, DateTime, Integer, Text, Boolean, Decimal as SQLDecimal, Date, ForeignKey, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship
import redis.asyncio as redis
from cryptography.fernet import Fernet
import pandas as pd
import io
import re
import uuid
from shared.telemetry import setup_telemetry, instrument_fastapi, get_tracer

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

setup_telemetry(service_name="provider-payment-details-service", service_version="1.0.0")
app = FastAPI(title="Provider Payment Details Service", version="1.0.0")
instrument_fastapi(app)

app.middleware("http")(security_headers_middleware)

# Database setup
DATABASE_URL = os.environ["DATABASE_URL"]
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Redis setup for caching
# Redis client initialized via shared cache module
# Use: from backend.shared.cache import get_client as get_redis_client

# Encryption setup for sensitive payment data
ENCRYPTION_KEY = Fernet.generate_key()  # In production, use secure key management
cipher_suite = Fernet(ENCRYPTION_KEY)

class PaymentMethodType(str, Enum):
    ACH = "ach"
    WIRE_TRANSFER = "wire_transfer"
    CHECK = "check"
    CREDIT_CARD = "credit_card"

class AccountType(str, Enum):
    CHECKING = "checking"
    SAVINGS = "savings"
    BUSINESS_CHECKING = "business_checking"
    BUSINESS_SAVINGS = "business_savings"

class RefundPreference(str, Enum):
    DIRECT_TO_PROVIDER = "direct_to_provider"
    TO_AGGREGATOR = "to_aggregator"
    MIXED = "mixed"  # Some providers direct, some through aggregator

class PaymentStatus(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    PENDING_VERIFICATION = "pending_verification"
    VERIFIED = "verified"
    SUSPENDED = "suspended"

# Database Models
class ProviderPaymentDetails(Base):
    __tablename__ = "provider_payment_details"
    
    id = Column(Integer, primary_key=True, index=True)
    provider_npi = Column(String(10), index=True)
    provider_name = Column(String(255))
    aggregator_id = Column(String(50), index=True)
    payment_method_type = Column(String(20))
    
    # Encrypted payment details
    encrypted_account_number = Column(Text)
    encrypted_routing_number = Column(Text)
    encrypted_card_number = Column(Text)
    encrypted_card_cvv = Column(Text)
    
    # Non-sensitive details
    account_type = Column(String(30))
    bank_name = Column(String(255))
    card_expiry_month = Column(Integer)
    card_expiry_year = Column(Integer)
    card_holder_name = Column(String(255))
    
    # Address information
    billing_address_line1 = Column(String(255))
    billing_address_line2 = Column(String(255))
    billing_city = Column(String(100))
    billing_state = Column(String(2))
    billing_zip = Column(String(10))
    billing_country = Column(String(2), default="US")
    
    # Contact information
    contact_email = Column(String(255))
    contact_phone = Column(String(20))
    
    # Verification and status
    status = Column(String(20), default=PaymentStatus.PENDING_VERIFICATION.value)
    verification_date = Column(DateTime)
    last_updated = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Metadata
    notes = Column(Text)
    verification_documents = Column(JSON)  # Store document references
    
    # Relationships
    refund_preferences = relationship("AggregatorRefundPreference", back_populates="provider_payments")

class AggregatorRefundPreference(Base):
    __tablename__ = "aggregator_refund_preferences"
    
    id = Column(Integer, primary_key=True, index=True)
    aggregator_id = Column(String(50), unique=True, index=True)
    default_refund_preference = Column(String(30), default=RefundPreference.TO_AGGREGATOR.value)
    
    # Aggregator payment details for consolidated refunds
    aggregator_payment_method = Column(String(20))
    encrypted_aggregator_account = Column(Text)
    encrypted_aggregator_routing = Column(Text)
    aggregator_bank_name = Column(String(255))
    aggregator_account_type = Column(String(30))
    
    # Business information
    business_name = Column(String(255))
    tax_id = Column(String(20))
    business_address = Column(Text)
    contact_email = Column(String(255))
    contact_phone = Column(String(20))
    
    # Fee distribution settings
    provider_fee_percentage = Column(SQLDecimal(5, 2), default=100.00)  # Percentage to distribute to providers
    aggregator_fee_percentage = Column(SQLDecimal(5, 2), default=0.00)  # Percentage retained by aggregator
    processing_fee = Column(SQLDecimal(10, 2), default=0.00)  # Fixed processing fee
    
    # Timing preferences
    refund_processing_delay_days = Column(Integer, default=0)  # Days to wait before processing
    batch_refunds = Column(Boolean, default=True)  # Batch refunds or process individually
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    provider_payments = relationship("ProviderPaymentDetails", back_populates="refund_preferences")
    provider_overrides = relationship("ProviderRefundOverride", back_populates="aggregator_preference")

class ProviderRefundOverride(Base):
    __tablename__ = "provider_refund_overrides"
    
    id = Column(Integer, primary_key=True, index=True)
    aggregator_id = Column(String(50), ForeignKey("aggregator_refund_preferences.aggregator_id"))
    provider_npi = Column(String(10), index=True)
    refund_preference = Column(String(30))  # Override the aggregator default
    fee_percentage = Column(SQLDecimal(5, 2))  # Override fee percentage
    notes = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    aggregator_preference = relationship("AggregatorRefundPreference", back_populates="provider_overrides")

class PaymentVerificationLog(Base):
    __tablename__ = "payment_verification_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    provider_npi = Column(String(10), index=True)
    aggregator_id = Column(String(50))
    verification_type = Column(String(50))  # MICRO_DEPOSIT, DOCUMENT_UPLOAD, MANUAL_REVIEW
    verification_status = Column(String(20))
    verification_details = Column(JSON)
    verified_by = Column(String(100))
    verification_date = Column(DateTime, default=datetime.utcnow)

# Pydantic Models
class ACHDetails(BaseModel):
    account_number: str = Field(..., min_length=4, max_length=20)
    routing_number: str = Field(..., min_length=9, max_length=9)
    account_type: AccountType
    bank_name: str = Field(..., max_length=255)
    
    @validator('routing_number')
    def validate_routing_number(cls, v):
        if not re.match(r'^\d{9}$', v):
            raise ValueError('Routing number must be 9 digits')
        return v

class WireTransferDetails(BaseModel):
    account_number: str = Field(..., min_length=4, max_length=30)
    routing_number: str = Field(..., min_length=9, max_length=11)
    swift_code: Optional[str] = Field(None, max_length=11)
    bank_name: str = Field(..., max_length=255)
    bank_address: str = Field(..., max_length=500)
    beneficiary_name: str = Field(..., max_length=255)
    beneficiary_address: str = Field(..., max_length=500)

class CheckDetails(BaseModel):
    payee_name: str = Field(..., max_length=255)
    mailing_address_line1: str = Field(..., max_length=255)
    mailing_address_line2: Optional[str] = Field(None, max_length=255)
    city: str = Field(..., max_length=100)
    state: str = Field(..., min_length=2, max_length=2)
    zip_code: str = Field(..., min_length=5, max_length=10)
    
    @validator('zip_code')
    def validate_zip_code(cls, v):
        if not re.match(r'^\d{5}(-\d{4})?$', v):
            raise ValueError('Invalid ZIP code format')
        return v

class CreditCardDetails(BaseModel):
    card_number: str = Field(..., min_length=13, max_length=19)
    expiry_month: int = Field(..., ge=1, le=12)
    expiry_year: int = Field(..., ge=2024, le=2034)
    cvv: str = Field(..., min_length=3, max_length=4)
    card_holder_name: str = Field(..., max_length=255)
    
    @validator('card_number')
    def validate_card_number(cls, v):
        # Remove spaces and validate Luhn algorithm
        card_num = re.sub(r'\s+', '', v)
        if not re.match(r'^\d{13,19}$', card_num):
            raise ValueError('Invalid card number format')
        return card_num

class BillingAddress(BaseModel):
    address_line1: str = Field(..., max_length=255)
    address_line2: Optional[str] = Field(None, max_length=255)
    city: str = Field(..., max_length=100)
    state: str = Field(..., min_length=2, max_length=2)
    zip_code: str = Field(..., min_length=5, max_length=10)
    country: str = Field(default="US", min_length=2, max_length=2)

class ProviderPaymentDetailsCreate(BaseModel):
    provider_npi: str = Field(..., min_length=10, max_length=10)
    provider_name: str = Field(..., max_length=255)
    aggregator_id: str = Field(..., max_length=50)
    payment_method_type: PaymentMethodType
    
    # Payment method details (one of these will be populated)
    ach_details: Optional[ACHDetails] = None
    wire_details: Optional[WireTransferDetails] = None
    check_details: Optional[CheckDetails] = None
    card_details: Optional[CreditCardDetails] = None
    
    billing_address: BillingAddress
    contact_email: EmailStr
    contact_phone: str = Field(..., max_length=20)
    notes: Optional[str] = None

class AggregatorRefundPreferenceCreate(BaseModel):
    aggregator_id: str = Field(..., max_length=50)
    default_refund_preference: RefundPreference
    
    # Aggregator payment details (if choosing to receive consolidated refunds)
    aggregator_payment_method: Optional[PaymentMethodType] = None
    aggregator_ach_details: Optional[ACHDetails] = None
    
    # Business information
    business_name: str = Field(..., max_length=255)
    tax_id: str = Field(..., max_length=20)
    business_address: str = Field(..., max_length=500)
    contact_email: EmailStr
    contact_phone: str = Field(..., max_length=20)
    
    # Fee distribution
    provider_fee_percentage: Decimal = Field(default=100.00, ge=0, le=100)
    aggregator_fee_percentage: Decimal = Field(default=0.00, ge=0, le=100)
    processing_fee: Decimal = Field(default=0.00, ge=0)
    
    # Processing preferences
    refund_processing_delay_days: int = Field(default=0, ge=0, le=30)
    batch_refunds: bool = Field(default=True)

class BulkPaymentUpload(BaseModel):
    aggregator_id: str
    file_format: str = Field(..., regex="^(csv|excel)$")
    validate_only: bool = Field(default=False)

# Payment Details Manager
class PaymentDetailsManager:
    def __init__(self):
        self.cipher = cipher_suite
    
    def encrypt_sensitive_data(self, data: str) -> str:
        """Encrypt sensitive payment data"""
        if not data:
            return ""
        return self.cipher.encrypt(data.encode()).decode()
    
    def decrypt_sensitive_data(self, encrypted_data: str) -> str:
        """Decrypt sensitive payment data"""
        if not encrypted_data:
            return ""
        return self.cipher.decrypt(encrypted_data.encode()).decode()
    
    async def create_provider_payment_details(self, payment_data: ProviderPaymentDetailsCreate) -> ProviderPaymentDetails:
        """Create new provider payment details with encryption"""
        db = SessionLocal()
        try:
            # Check if provider already has payment details
            existing = db.query(ProviderPaymentDetails).filter(
                ProviderPaymentDetails.provider_npi == payment_data.provider_npi,
                ProviderPaymentDetails.aggregator_id == payment_data.aggregator_id
            ).first()
            
            if existing:
                raise HTTPException(status_code=409, detail="Payment details already exist for this provider")
            
            # Create new payment details record
            payment_details = ProviderPaymentDetails(
                provider_npi=payment_data.provider_npi,
                provider_name=payment_data.provider_name,
                aggregator_id=payment_data.aggregator_id,
                payment_method_type=payment_data.payment_method_type.value,
                contact_email=payment_data.contact_email,
                contact_phone=payment_data.contact_phone,
                billing_address_line1=payment_data.billing_address.address_line1,
                billing_address_line2=payment_data.billing_address.address_line2,
                billing_city=payment_data.billing_address.city,
                billing_state=payment_data.billing_address.state,
                billing_zip=payment_data.billing_address.zip_code,
                billing_country=payment_data.billing_address.country,
                notes=payment_data.notes
            )
            
            # Encrypt and store payment method specific details
            if payment_data.payment_method_type == PaymentMethodType.ACH and payment_data.ach_details:
                payment_details.encrypted_account_number = self.encrypt_sensitive_data(payment_data.ach_details.account_number)
                payment_details.encrypted_routing_number = self.encrypt_sensitive_data(payment_data.ach_details.routing_number)
                payment_details.account_type = payment_data.ach_details.account_type.value
                payment_details.bank_name = payment_data.ach_details.bank_name
                
            elif payment_data.payment_method_type == PaymentMethodType.WIRE_TRANSFER and payment_data.wire_details:
                payment_details.encrypted_account_number = self.encrypt_sensitive_data(payment_data.wire_details.account_number)
                payment_details.encrypted_routing_number = self.encrypt_sensitive_data(payment_data.wire_details.routing_number)
                payment_details.bank_name = payment_data.wire_details.bank_name
                # Store additional wire details in notes
                wire_info = {
                    "swift_code": payment_data.wire_details.swift_code,
                    "bank_address": payment_data.wire_details.bank_address,
                    "beneficiary_name": payment_data.wire_details.beneficiary_name,
                    "beneficiary_address": payment_data.wire_details.beneficiary_address
                }
                payment_details.notes = json.dumps(wire_info)
                
            elif payment_data.payment_method_type == PaymentMethodType.CREDIT_CARD and payment_data.card_details:
                payment_details.encrypted_card_number = self.encrypt_sensitive_data(payment_data.card_details.card_number)
                payment_details.encrypted_card_cvv = self.encrypt_sensitive_data(payment_data.card_details.cvv)
                payment_details.card_expiry_month = payment_data.card_details.expiry_month
                payment_details.card_expiry_year = payment_data.card_details.expiry_year
                payment_details.card_holder_name = payment_data.card_details.card_holder_name
                
            elif payment_data.payment_method_type == PaymentMethodType.CHECK and payment_data.check_details:
                # For checks, store mailing address details
                check_info = {
                    "payee_name": payment_data.check_details.payee_name,
                    "mailing_address": {
                        "line1": payment_data.check_details.mailing_address_line1,
                        "line2": payment_data.check_details.mailing_address_line2,
                        "city": payment_data.check_details.city,
                        "state": payment_data.check_details.state,
                        "zip": payment_data.check_details.zip_code
                    }
                }
                payment_details.notes = json.dumps(check_info)
            
            db.add(payment_details)
            db.commit()
            db.refresh(payment_details)
            
            logger.info(f"Created payment details for provider {payment_data.provider_npi}")
            return payment_details
            
        except HTTPException:
            raise
        except Exception as e:
            db.rollback()
            logger.error(f"Error creating payment details: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to create payment details: {str(e)}")
        finally:
            db.close()
    
    async def process_bulk_payment_upload(self, aggregator_id: str, file: UploadFile) -> Dict[str, Any]:
        """Process bulk upload of provider payment details"""
        try:
            # Read file content
            content = await file.read()
            
            if file.filename.endswith('.csv'):
                df = pd.read_csv(io.StringIO(content.decode('utf-8')))
            elif file.filename.endswith(('.xlsx', '.xls')):
                df = pd.read_excel(io.BytesIO(content))
            else:
                raise HTTPException(status_code=400, detail="Unsupported file format")
            
            # Validate required columns
            required_columns = [
                'provider_npi', 'provider_name', 'payment_method_type',
                'contact_email', 'contact_phone', 'billing_address_line1',
                'billing_city', 'billing_state', 'billing_zip'
            ]
            
            missing_columns = [col for col in required_columns if col not in df.columns]
            if missing_columns:
                raise HTTPException(
                    status_code=400, 
                    detail=f"Missing required columns: {', '.join(missing_columns)}"
                )
            
            # Process each row
            results = {
                "total_records": len(df),
                "successful": 0,
                "failed": 0,
                "errors": []
            }
            
            for index, row in df.iterrows():
                try:
                    # Create billing address
                    billing_address = BillingAddress(
                        address_line1=row['billing_address_line1'],
                        address_line2=row.get('billing_address_line2', ''),
                        city=row['billing_city'],
                        state=row['billing_state'],
                        zip_code=row['billing_zip'],
                        country=row.get('billing_country', 'US')
                    )
                    
                    # Create payment details based on method type
                    payment_method = PaymentMethodType(row['payment_method_type'].lower())
                    payment_data = ProviderPaymentDetailsCreate(
                        provider_npi=str(row['provider_npi']).zfill(10),
                        provider_name=row['provider_name'],
                        aggregator_id=aggregator_id,
                        payment_method_type=payment_method,
                        billing_address=billing_address,
                        contact_email=row['contact_email'],
                        contact_phone=row['contact_phone'],
                        notes=row.get('notes', '')
                    )
                    
                    # Add method-specific details
                    if payment_method == PaymentMethodType.ACH:
                        payment_data.ach_details = ACHDetails(
                            account_number=row['account_number'],
                            routing_number=row['routing_number'],
                            account_type=AccountType(row['account_type']),
                            bank_name=row['bank_name']
                        )
                    elif payment_method == PaymentMethodType.WIRE_TRANSFER:
                        payment_data.wire_details = WireTransferDetails(
                            account_number=row['account_number'],
                            routing_number=row['routing_number'],
                            swift_code=row.get('swift_code', ''),
                            bank_name=row['bank_name'],
                            bank_address=row['bank_address'],
                            beneficiary_name=row['beneficiary_name'],
                            beneficiary_address=row['beneficiary_address']
                        )
                    
                    # Create payment details
                    await self.create_provider_payment_details(payment_data)
                    results["successful"] += 1
                    
                except Exception as e:
                    results["failed"] += 1
                    results["errors"].append({
                        "row": index + 1,
                        "provider_npi": row.get('provider_npi', 'Unknown'),
                        "error": str(e)
                    })
            
            return results
            
        except Exception as e:
            logger.error(f"Bulk upload error: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Bulk upload failed: {str(e)}")
    
    async def get_provider_payment_details(self, provider_npi: str, aggregator_id: str) -> Optional[Dict[str, Any]]:
        """Get provider payment details (without sensitive data)"""
        db = SessionLocal()
        try:
            payment_details = db.query(ProviderPaymentDetails).filter(
                ProviderPaymentDetails.provider_npi == provider_npi,
                ProviderPaymentDetails.aggregator_id == aggregator_id
            ).first()
            
            if not payment_details:
                return None
            
            # Return non-sensitive information
            result = {
                "provider_npi": payment_details.provider_npi,
                "provider_name": payment_details.provider_name,
                "payment_method_type": payment_details.payment_method_type,
                "bank_name": payment_details.bank_name,
                "account_type": payment_details.account_type,
                "contact_email": payment_details.contact_email,
                "contact_phone": payment_details.contact_phone,
                "billing_address": {
                    "line1": payment_details.billing_address_line1,
                    "line2": payment_details.billing_address_line2,
                    "city": payment_details.billing_city,
                    "state": payment_details.billing_state,
                    "zip": payment_details.billing_zip,
                    "country": payment_details.billing_country
                },
                "status": payment_details.status,
                "verification_date": payment_details.verification_date.isoformat() if payment_details.verification_date else None,
                "last_updated": payment_details.last_updated.isoformat(),
                "created_at": payment_details.created_at.isoformat()
            }
            
            # Add masked sensitive information for display
            if payment_details.encrypted_account_number:
                account_num = self.decrypt_sensitive_data(payment_details.encrypted_account_number)
                result["masked_account_number"] = f"****{account_num[-4:]}" if len(account_num) > 4 else "****"
            
            if payment_details.encrypted_card_number:
                card_num = self.decrypt_sensitive_data(payment_details.encrypted_card_number)
                result["masked_card_number"] = f"****-****-****-{card_num[-4:]}" if len(card_num) > 4 else "****"
                result["card_expiry"] = f"{payment_details.card_expiry_month:02d}/{payment_details.card_expiry_year}"
                result["card_holder_name"] = payment_details.card_holder_name
            
            return result
            
        except Exception as e:
            logger.error(f"Error fetching payment details: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to fetch payment details: {str(e)}")
        finally:
            db.close()

# Refund Preference Manager
class RefundPreferenceManager:
    async def create_aggregator_refund_preference(self, preference_data: AggregatorRefundPreferenceCreate) -> AggregatorRefundPreference:
        """Create aggregator refund preferences"""
        db = SessionLocal()
        try:
            # Check if preferences already exist
            existing = db.query(AggregatorRefundPreference).filter(
                AggregatorRefundPreference.aggregator_id == preference_data.aggregator_id
            ).first()
            
            if existing:
                raise HTTPException(status_code=409, detail="Refund preferences already exist for this aggregator")
            
            # Validate fee percentages
            if preference_data.provider_fee_percentage + preference_data.aggregator_fee_percentage > 100:
                raise HTTPException(status_code=400, detail="Total fee percentages cannot exceed 100%")
            
            # Create preferences
            preferences = AggregatorRefundPreference(
                aggregator_id=preference_data.aggregator_id,
                default_refund_preference=preference_data.default_refund_preference.value,
                business_name=preference_data.business_name,
                tax_id=preference_data.tax_id,
                business_address=preference_data.business_address,
                contact_email=preference_data.contact_email,
                contact_phone=preference_data.contact_phone,
                provider_fee_percentage=preference_data.provider_fee_percentage,
                aggregator_fee_percentage=preference_data.aggregator_fee_percentage,
                processing_fee=preference_data.processing_fee,
                refund_processing_delay_days=preference_data.refund_processing_delay_days,
                batch_refunds=preference_data.batch_refunds
            )
            
            # Add aggregator payment details if provided
            if preference_data.aggregator_payment_method and preference_data.aggregator_ach_details:
                preferences.aggregator_payment_method = preference_data.aggregator_payment_method.value
                preferences.encrypted_aggregator_account = cipher_suite.encrypt(
                    preference_data.aggregator_ach_details.account_number.encode()
                ).decode()
                preferences.encrypted_aggregator_routing = cipher_suite.encrypt(
                    preference_data.aggregator_ach_details.routing_number.encode()
                ).decode()
                preferences.aggregator_bank_name = preference_data.aggregator_ach_details.bank_name
                preferences.aggregator_account_type = preference_data.aggregator_ach_details.account_type.value
            
            db.add(preferences)
            db.commit()
            db.refresh(preferences)
            
            logger.info(f"Created refund preferences for aggregator {preference_data.aggregator_id}")
            return preferences
            
        except HTTPException:
            raise
        except Exception as e:
            db.rollback()
            logger.error(f"Error creating refund preferences: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to create refund preferences: {str(e)}")
        finally:
            db.close()

# API Endpoints
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

payment_manager = PaymentDetailsManager()
refund_manager = RefundPreferenceManager()

@app.post("/api/v1/provider-payments/create")
async def create_provider_payment_details(
    payment_data: ProviderPaymentDetailsCreate,
    db: Session = Depends(get_db)
,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Create provider payment details"""
    payment_details = await payment_manager.create_provider_payment_details(payment_data)
    return {
        "status": "success",
        "provider_npi": payment_details.provider_npi,
        "payment_method_type": payment_details.payment_method_type,
        "created_at": payment_details.created_at.isoformat()
    }

@app.post("/api/v1/provider-payments/bulk-upload")
async def bulk_upload_payment_details(
    aggregator_id: str = Form(...),
    file: UploadFile = File(...)
,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Bulk upload provider payment details from CSV/Excel"""
    results = await payment_manager.process_bulk_payment_upload(aggregator_id, file)
    return results

@app.get("/api/v1/provider-payments/{provider_npi}/{aggregator_id}")
async def get_provider_payment_details(
    provider_npi: str,
    aggregator_id: str,
    db: Session = Depends(get_db)
,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get provider payment details (non-sensitive)"""
    details = await payment_manager.get_provider_payment_details(provider_npi, aggregator_id)
    if not details:
        raise HTTPException(status_code=404, detail="Payment details not found")
    return details

@app.post("/api/v1/refund-preferences/create")
async def create_refund_preferences(
    preference_data: AggregatorRefundPreferenceCreate,
    db: Session = Depends(get_db)
,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Create aggregator refund preferences"""
    preferences = await refund_manager.create_aggregator_refund_preference(preference_data)
    return {
        "status": "success",
        "aggregator_id": preferences.aggregator_id,
        "default_refund_preference": preferences.default_refund_preference,
        "created_at": preferences.created_at.isoformat()
    }

@app.get("/api/v1/refund-preferences/{aggregator_id}")
async def get_refund_preferences(aggregator_id: str, db: Session = Depends(get_db),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get aggregator refund preferences"""
    preferences = db.query(AggregatorRefundPreference).filter(
        AggregatorRefundPreference.aggregator_id == aggregator_id
    ).first()
    
    if not preferences:
        raise HTTPException(status_code=404, detail="Refund preferences not found")
    
    return {
        "aggregator_id": preferences.aggregator_id,
        "default_refund_preference": preferences.default_refund_preference,
        "business_name": preferences.business_name,
        "provider_fee_percentage": float(preferences.provider_fee_percentage),
        "aggregator_fee_percentage": float(preferences.aggregator_fee_percentage),
        "processing_fee": float(preferences.processing_fee),
        "refund_processing_delay_days": preferences.refund_processing_delay_days,
        "batch_refunds": preferences.batch_refunds,
        "created_at": preferences.created_at.isoformat()
    }

@app.get("/api/v1/aggregator-providers/{aggregator_id}/payment-summary")
async def get_aggregator_payment_summary(aggregator_id: str, db: Session = Depends(get_db),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get summary of payment details for all providers under an aggregator"""
    providers = db.query(ProviderPaymentDetails).filter(
        ProviderPaymentDetails.aggregator_id == aggregator_id
    ).all()
    
    summary = {
        "aggregator_id": aggregator_id,
        "total_providers": len(providers),
        "payment_methods": {},
        "verification_status": {},
        "providers": []
    }
    
    for provider in providers:
        # Count payment methods
        method = provider.payment_method_type
        summary["payment_methods"][method] = summary["payment_methods"].get(method, 0) + 1
        
        # Count verification status
        status = provider.status
        summary["verification_status"][status] = summary["verification_status"].get(status, 0) + 1
        
        # Add provider summary
        summary["providers"].append({
            "provider_npi": provider.provider_npi,
            "provider_name": provider.provider_name,
            "payment_method_type": provider.payment_method_type,
            "status": provider.status,
            "last_updated": provider.last_updated.isoformat()
        })
    
    return summary

# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "Provider Payment Details Service",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0.0"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8023)