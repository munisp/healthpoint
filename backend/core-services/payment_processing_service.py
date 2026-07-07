#!/usr/bin/env python3
"""
Payment Processing Service
Multi-method payment processing with reconciliation for healthcare claims
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
from dataclasses import dataclass, asdict
import hashlib
import hmac
import base64

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
import asyncpg
import aioredis
import httpx
from cryptography.fernet import Fernet
import stripe
import boto3
from botocore.exceptions import ClientError

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# FastAPI app
app = FastAPI(
    title="Payment Processing Service",
    description="Multi-method payment processing with reconciliation for healthcare claims",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security
security = HTTPBearer()

# Enums
class PaymentMethod(str, Enum):
    ACH = "ach"
    WIRE = "wire"
    CHECK = "check"
    CARD = "card"
    EFT = "eft"
    VIRTUAL_CARD = "virtual_card"

class PaymentStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    REFUNDED = "refunded"
    DISPUTED = "disputed"

class ReconciliationStatus(str, Enum):
    MATCHED = "matched"
    UNMATCHED = "unmatched"
    DISCREPANCY = "discrepancy"
    PENDING = "pending"

# Pydantic Models
class PaymentRequest(BaseModel):
    claim_id: str
    payee_id: str
    amount: Decimal = Field(..., gt=0)
    payment_method: PaymentMethod
    description: Optional[str] = None
    reference_number: Optional[str] = None
    scheduled_date: Optional[datetime] = None
    metadata: Optional[Dict[str, Any]] = {}

class PaymentResponse(BaseModel):
    payment_id: str
    status: PaymentStatus
    transaction_id: Optional[str] = None
    confirmation_number: Optional[str] = None
    estimated_completion: Optional[datetime] = None

class ReconciliationRequest(BaseModel):
    payment_id: str
    bank_reference: str
    actual_amount: Decimal
    settlement_date: datetime
    bank_fees: Optional[Decimal] = Decimal('0.00')

class BulkPaymentRequest(BaseModel):
    payments: List[PaymentRequest]
    batch_description: Optional[str] = None

# Data Classes
@dataclass
class Payment:
    payment_id: str
    claim_id: str
    payee_id: str
    amount: Decimal
    payment_method: PaymentMethod
    status: PaymentStatus
    created_at: datetime
    updated_at: datetime
    scheduled_date: Optional[datetime] = None
    completed_date: Optional[datetime] = None
    transaction_id: Optional[str] = None
    confirmation_number: Optional[str] = None
    description: Optional[str] = None
    reference_number: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    fees: Optional[Decimal] = Decimal('0.00')
    exchange_rate: Optional[Decimal] = None

@dataclass
class Payee:
    payee_id: str
    name: str
    type: str  # provider, member, vendor
    payment_preferences: Dict[str, Any]
    bank_details: Optional[Dict[str, Any]] = None
    address: Optional[Dict[str, str]] = None
    tax_id: Optional[str] = None
    is_active: bool = True

# Payment Processing Service
class PaymentProcessingService:
    def __init__(self):
        self.db_pool = None
        self.redis = None
        self.encryption_key = Fernet.generate_key()
        self.cipher_suite = Fernet(self.encryption_key)
        
        # Payment processors
        self.stripe_client = None
        self.ach_processor = None
        self.wire_processor = None
        
        # AWS SES for notifications
        self.ses_client = boto3.client('ses', region_name='us-east-1')
        
    async def initialize(self):
        """Initialize database connections and external services"""
        try:
            # Database connection
            self.db_pool = await asyncpg.create_pool(
                "postgresql://user:password@localhost:5432/healthcare_db",
                min_size=5,
                max_size=20
            )
            
            # Redis connection
            self.redis = await aioredis.from_url("redis://localhost:6379")
            
            # Initialize payment processors
            await self.initialize_payment_processors()
            
            logger.info("Payment Processing Service initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize Payment Processing Service: {e}")
            raise

    async def initialize_payment_processors(self):
        """Initialize external payment processors"""
        try:
            # Stripe for card payments
            stripe.api_key = "sk_test_..."  # Use environment variable
            self.stripe_client = stripe
            
            # Mock ACH processor
            self.ach_processor = ACHProcessor()
            
            # Mock Wire processor
            self.wire_processor = WireProcessor()
            
        except Exception as e:
            logger.error(f"Failed to initialize payment processors: {e}")

    async def process_payment(self, payment_request: PaymentRequest) -> PaymentResponse:
        """Process a single payment"""
        try:
            # Generate payment ID
            payment_id = str(uuid.uuid4())
            
            # Validate payee
            payee = await self.get_payee(payment_request.payee_id)
            if not payee or not payee.is_active:
                raise HTTPException(status_code=400, detail="Invalid or inactive payee")
            
            # Create payment record
            payment = Payment(
                payment_id=payment_id,
                claim_id=payment_request.claim_id,
                payee_id=payment_request.payee_id,
                amount=payment_request.amount,
                payment_method=payment_request.payment_method,
                status=PaymentStatus.PENDING,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
                scheduled_date=payment_request.scheduled_date,
                description=payment_request.description,
                reference_number=payment_request.reference_number,
                metadata=payment_request.metadata
            )
            
            # Save to database
            await self.save_payment(payment)
            
            # Process based on payment method
            if payment_request.payment_method == PaymentMethod.ACH:
                result = await self.process_ach_payment(payment, payee)
            elif payment_request.payment_method == PaymentMethod.WIRE:
                result = await self.process_wire_payment(payment, payee)
            elif payment_request.payment_method == PaymentMethod.CARD:
                result = await self.process_card_payment(payment, payee)
            elif payment_request.payment_method == PaymentMethod.CHECK:
                result = await self.process_check_payment(payment, payee)
            elif payment_request.payment_method == PaymentMethod.EFT:
                result = await self.process_eft_payment(payment, payee)
            elif payment_request.payment_method == PaymentMethod.VIRTUAL_CARD:
                result = await self.process_virtual_card_payment(payment, payee)
            else:
                raise HTTPException(status_code=400, detail="Unsupported payment method")
            
            # Update payment status
            payment.status = PaymentStatus.PROCESSING
            payment.transaction_id = result.get('transaction_id')
            payment.confirmation_number = result.get('confirmation_number')
            payment.updated_at = datetime.utcnow()
            
            await self.update_payment(payment)
            
            # Send notification
            await self.send_payment_notification(payment, payee)
            
            # Cache payment for quick access
            await self.cache_payment(payment)
            
            return PaymentResponse(
                payment_id=payment_id,
                status=payment.status,
                transaction_id=payment.transaction_id,
                confirmation_number=payment.confirmation_number,
                estimated_completion=self.calculate_estimated_completion(payment.payment_method)
            )
            
        except Exception as e:
            logger.error(f"Payment processing failed: {e}")
            if 'payment' in locals():
                payment.status = PaymentStatus.FAILED
                await self.update_payment(payment)
            raise HTTPException(status_code=500, detail=f"Payment processing failed: {str(e)}")

    async def process_ach_payment(self, payment: Payment, payee: Payee) -> Dict[str, Any]:
        """Process ACH payment"""
        try:
            # Validate bank details
            bank_details = payee.bank_details
            if not bank_details or not all(k in bank_details for k in ['routing_number', 'account_number']):
                raise ValueError("Missing required bank details for ACH payment")
            
            # Create ACH transaction
            ach_request = {
                'amount': float(payment.amount),
                'routing_number': bank_details['routing_number'],
                'account_number': self.encrypt_sensitive_data(bank_details['account_number']),
                'account_type': bank_details.get('account_type', 'checking'),
                'description': payment.description or f"Healthcare claim payment {payment.claim_id}",
                'reference': payment.reference_number or payment.payment_id
            }
            
            # Process with ACH processor
            result = await self.ach_processor.process_payment(ach_request)
            
            return {
                'transaction_id': result['transaction_id'],
                'confirmation_number': result['confirmation_number'],
                'estimated_completion': result['estimated_completion']
            }
            
        except Exception as e:
            logger.error(f"ACH payment processing failed: {e}")
            raise

    async def process_wire_payment(self, payment: Payment, payee: Payee) -> Dict[str, Any]:
        """Process wire transfer payment"""
        try:
            # Validate wire details
            bank_details = payee.bank_details
            if not bank_details or not all(k in bank_details for k in ['swift_code', 'account_number']):
                raise ValueError("Missing required bank details for wire payment")
            
            # Create wire transfer
            wire_request = {
                'amount': float(payment.amount),
                'swift_code': bank_details['swift_code'],
                'account_number': self.encrypt_sensitive_data(bank_details['account_number']),
                'beneficiary_name': payee.name,
                'beneficiary_address': payee.address,
                'purpose': payment.description or f"Healthcare claim payment {payment.claim_id}",
                'reference': payment.reference_number or payment.payment_id
            }
            
            # Process with wire processor
            result = await self.wire_processor.process_payment(wire_request)
            
            return {
                'transaction_id': result['transaction_id'],
                'confirmation_number': result['confirmation_number'],
                'estimated_completion': result['estimated_completion']
            }
            
        except Exception as e:
            logger.error(f"Wire payment processing failed: {e}")
            raise

    async def process_card_payment(self, payment: Payment, payee: Payee) -> Dict[str, Any]:
        """Process card payment using Stripe"""
        try:
            # Create Stripe payment intent
            intent = self.stripe_client.PaymentIntent.create(
                amount=int(payment.amount * 100),  # Convert to cents
                currency='usd',
                description=payment.description or f"Healthcare claim payment {payment.claim_id}",
                metadata={
                    'payment_id': payment.payment_id,
                    'claim_id': payment.claim_id,
                    'payee_id': payment.payee_id
                }
            )
            
            return {
                'transaction_id': intent.id,
                'confirmation_number': intent.client_secret,
                'estimated_completion': datetime.utcnow() + timedelta(minutes=5)
            }
            
        except Exception as e:
            logger.error(f"Card payment processing failed: {e}")
            raise

    async def process_check_payment(self, payment: Payment, payee: Payee) -> Dict[str, Any]:
        """Process check payment"""
        try:
            # Generate check number
            check_number = f"CHK{datetime.utcnow().strftime('%Y%m%d')}{payment.payment_id[:8]}"
            
            # Create check record
            check_data = {
                'check_number': check_number,
                'amount': float(payment.amount),
                'payee_name': payee.name,
                'payee_address': payee.address,
                'memo': payment.description or f"Claim payment {payment.claim_id}",
                'issue_date': datetime.utcnow().isoformat()
            }
            
            # Queue for printing
            await self.queue_check_for_printing(check_data)
            
            return {
                'transaction_id': check_number,
                'confirmation_number': check_number,
                'estimated_completion': datetime.utcnow() + timedelta(days=5)
            }
            
        except Exception as e:
            logger.error(f"Check payment processing failed: {e}")
            raise

    async def process_eft_payment(self, payment: Payment, payee: Payee) -> Dict[str, Any]:
        """Process EFT payment"""
        # Similar to ACH but with different processing rules
        return await self.process_ach_payment(payment, payee)

    async def process_virtual_card_payment(self, payment: Payment, payee: Payee) -> Dict[str, Any]:
        """Process virtual card payment"""
        try:
            # Generate virtual card
            virtual_card = await self.generate_virtual_card(payment.amount, payee)
            
            return {
                'transaction_id': virtual_card['card_id'],
                'confirmation_number': virtual_card['confirmation_code'],
                'estimated_completion': datetime.utcnow() + timedelta(hours=1)
            }
            
        except Exception as e:
            logger.error(f"Virtual card payment processing failed: {e}")
            raise

    async def process_bulk_payments(self, bulk_request: BulkPaymentRequest) -> Dict[str, Any]:
        """Process multiple payments in bulk"""
        try:
            batch_id = str(uuid.uuid4())
            results = []
            
            # Process payments concurrently
            tasks = []
            for payment_request in bulk_request.payments:
                task = asyncio.create_task(self.process_payment(payment_request))
                tasks.append(task)
            
            # Wait for all payments to complete
            payment_results = await asyncio.gather(*tasks, return_exceptions=True)
            
            # Collect results
            successful = 0
            failed = 0
            
            for i, result in enumerate(payment_results):
                if isinstance(result, Exception):
                    results.append({
                        'index': i,
                        'status': 'failed',
                        'error': str(result)
                    })
                    failed += 1
                else:
                    results.append({
                        'index': i,
                        'status': 'success',
                        'payment_id': result.payment_id,
                        'transaction_id': result.transaction_id
                    })
                    successful += 1
            
            # Save batch record
            batch_record = {
                'batch_id': batch_id,
                'total_payments': len(bulk_request.payments),
                'successful': successful,
                'failed': failed,
                'description': bulk_request.batch_description,
                'created_at': datetime.utcnow().isoformat(),
                'results': results
            }
            
            await self.save_batch_record(batch_record)
            
            return {
                'batch_id': batch_id,
                'total_payments': len(bulk_request.payments),
                'successful': successful,
                'failed': failed,
                'results': results
            }
            
        except Exception as e:
            logger.error(f"Bulk payment processing failed: {e}")
            raise HTTPException(status_code=500, detail=f"Bulk payment processing failed: {str(e)}")

    async def reconcile_payment(self, reconciliation_request: ReconciliationRequest) -> Dict[str, Any]:
        """Reconcile payment with bank records"""
        try:
            # Get payment record
            payment = await self.get_payment(reconciliation_request.payment_id)
            if not payment:
                raise HTTPException(status_code=404, detail="Payment not found")
            
            # Compare amounts
            amount_match = abs(payment.amount - reconciliation_request.actual_amount) < Decimal('0.01')
            
            # Determine reconciliation status
            if amount_match:
                reconciliation_status = ReconciliationStatus.MATCHED
            else:
                reconciliation_status = ReconciliationStatus.DISCREPANCY
            
            # Create reconciliation record
            reconciliation = {
                'reconciliation_id': str(uuid.uuid4()),
                'payment_id': reconciliation_request.payment_id,
                'bank_reference': reconciliation_request.bank_reference,
                'expected_amount': float(payment.amount),
                'actual_amount': float(reconciliation_request.actual_amount),
                'settlement_date': reconciliation_request.settlement_date.isoformat(),
                'bank_fees': float(reconciliation_request.bank_fees),
                'status': reconciliation_status.value,
                'reconciled_at': datetime.utcnow().isoformat()
            }
            
            # Save reconciliation
            await self.save_reconciliation(reconciliation)
            
            # Update payment status if reconciled
            if reconciliation_status == ReconciliationStatus.MATCHED:
                payment.status = PaymentStatus.COMPLETED
                payment.completed_date = reconciliation_request.settlement_date
                payment.fees = reconciliation_request.bank_fees
                await self.update_payment(payment)
            
            return reconciliation
            
        except Exception as e:
            logger.error(f"Payment reconciliation failed: {e}")
            raise HTTPException(status_code=500, detail=f"Reconciliation failed: {str(e)}")

    async def get_payment_status(self, payment_id: str) -> Dict[str, Any]:
        """Get payment status and details"""
        try:
            # Try cache first
            cached_payment = await self.redis.get(f"payment:{payment_id}")
            if cached_payment:
                return json.loads(cached_payment)
            
            # Get from database
            payment = await self.get_payment(payment_id)
            if not payment:
                raise HTTPException(status_code=404, detail="Payment not found")
            
            # Get reconciliation info if available
            reconciliation = await self.get_reconciliation_by_payment_id(payment_id)
            
            result = {
                'payment_id': payment.payment_id,
                'claim_id': payment.claim_id,
                'amount': float(payment.amount),
                'status': payment.status.value,
                'payment_method': payment.payment_method.value,
                'created_at': payment.created_at.isoformat(),
                'updated_at': payment.updated_at.isoformat(),
                'transaction_id': payment.transaction_id,
                'confirmation_number': payment.confirmation_number,
                'reconciliation': reconciliation
            }
            
            # Cache result
            await self.redis.setex(f"payment:{payment_id}", 300, json.dumps(result, default=str))
            
            return result
            
        except Exception as e:
            logger.error(f"Failed to get payment status: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to get payment status: {str(e)}")

    # Database operations
    async def save_payment(self, payment: Payment):
        """Save payment to database"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO payments (
                    payment_id, claim_id, payee_id, amount, payment_method, status,
                    created_at, updated_at, scheduled_date, description, reference_number, metadata
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            """, payment.payment_id, payment.claim_id, payment.payee_id, payment.amount,
                payment.payment_method.value, payment.status.value, payment.created_at,
                payment.updated_at, payment.scheduled_date, payment.description,
                payment.reference_number, json.dumps(payment.metadata))

    async def update_payment(self, payment: Payment):
        """Update payment in database"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                UPDATE payments SET
                    status = $2, updated_at = $3, completed_date = $4,
                    transaction_id = $5, confirmation_number = $6, fees = $7
                WHERE payment_id = $1
            """, payment.payment_id, payment.status.value, payment.updated_at,
                payment.completed_date, payment.transaction_id, payment.confirmation_number, payment.fees)

    async def get_payment(self, payment_id: str) -> Optional[Payment]:
        """Get payment from database"""
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM payments WHERE payment_id = $1", payment_id)
            if row:
                return Payment(**dict(row))
            return None

    async def get_payee(self, payee_id: str) -> Optional[Payee]:
        """Get payee information"""
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM payees WHERE payee_id = $1", payee_id)
            if row:
                return Payee(**dict(row))
            return None

    # Utility methods
    def encrypt_sensitive_data(self, data: str) -> str:
        """Encrypt sensitive data"""
        return self.cipher_suite.encrypt(data.encode()).decode()

    def decrypt_sensitive_data(self, encrypted_data: str) -> str:
        """Decrypt sensitive data"""
        return self.cipher_suite.decrypt(encrypted_data.encode()).decode()

    def calculate_estimated_completion(self, payment_method: PaymentMethod) -> datetime:
        """Calculate estimated completion time based on payment method"""
        now = datetime.utcnow()
        if payment_method == PaymentMethod.CARD:
            return now + timedelta(minutes=5)
        elif payment_method == PaymentMethod.ACH:
            return now + timedelta(days=1)
        elif payment_method == PaymentMethod.WIRE:
            return now + timedelta(hours=4)
        elif payment_method == PaymentMethod.CHECK:
            return now + timedelta(days=5)
        elif payment_method == PaymentMethod.EFT:
            return now + timedelta(hours=2)
        elif payment_method == PaymentMethod.VIRTUAL_CARD:
            return now + timedelta(hours=1)
        else:
            return now + timedelta(days=1)

    async def cache_payment(self, payment: Payment):
        """Cache payment for quick access"""
        payment_data = asdict(payment)
        await self.redis.setex(
            f"payment:{payment.payment_id}", 
            300, 
            json.dumps(payment_data, default=str)
        )

    async def send_payment_notification(self, payment: Payment, payee: Payee):
        """Send payment notification"""
        try:
            # Email notification
            subject = f"Payment Processed - {payment.payment_id}"
            body = f"""
            Payment Details:
            - Payment ID: {payment.payment_id}
            - Amount: ${payment.amount}
            - Method: {payment.payment_method.value}
            - Status: {payment.status.value}
            - Payee: {payee.name}
            """
            
            # Send email (mock implementation)
            logger.info(f"Sending payment notification for {payment.payment_id}")
            
        except Exception as e:
            logger.error(f"Failed to send payment notification: {e}")

# Mock processors
class ACHProcessor:
    async def process_payment(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """Mock ACH processor"""
        await asyncio.sleep(0.1)  # Simulate processing time
        return {
            'transaction_id': f"ACH{uuid.uuid4().hex[:8]}",
            'confirmation_number': f"CONF{uuid.uuid4().hex[:6]}",
            'estimated_completion': datetime.utcnow() + timedelta(days=1)
        }

class WireProcessor:
    async def process_payment(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """Mock Wire processor"""
        await asyncio.sleep(0.2)  # Simulate processing time
        return {
            'transaction_id': f"WIRE{uuid.uuid4().hex[:8]}",
            'confirmation_number': f"CONF{uuid.uuid4().hex[:6]}",
            'estimated_completion': datetime.utcnow() + timedelta(hours=4)
        }

# Global service instance
payment_service = PaymentProcessingService()

# API Routes
@app.on_event("startup")
async def startup_event():
    await payment_service.initialize()

@app.post("/payments", response_model=PaymentResponse)
async def create_payment(
    payment_request: PaymentRequest,
    background_tasks: BackgroundTasks,
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    """Process a single payment"""
    return await payment_service.process_payment(payment_request)

@app.post("/payments/bulk")
async def create_bulk_payments(
    bulk_request: BulkPaymentRequest,
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    """Process multiple payments in bulk"""
    return await payment_service.process_bulk_payments(bulk_request)

@app.get("/payments/{payment_id}")
async def get_payment_status(
    payment_id: str,
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    """Get payment status and details"""
    return await payment_service.get_payment_status(payment_id)

@app.post("/payments/{payment_id}/reconcile")
async def reconcile_payment(
    payment_id: str,
    reconciliation_request: ReconciliationRequest,
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    """Reconcile payment with bank records"""
    reconciliation_request.payment_id = payment_id
    return await payment_service.reconcile_payment(reconciliation_request)

@app.get("/payments/{payment_id}/cancel")
async def cancel_payment(
    payment_id: str,
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    """Cancel a pending payment."""
    try:
        pool = await get_db()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT id, status, amount, provider FROM payments WHERE id=$1", payment_id
            )
            if not row:
                raise HTTPException(status_code=404, detail=f"Payment {payment_id} not found")
            if row["status"] not in ("pending", "initiated"):
                raise HTTPException(
                    status_code=400,
                    detail=f"Cannot cancel payment in status '{row['status']}'"
                )
            await conn.execute(
                "UPDATE payments SET status='cancelled', cancelled_at=$1, updated_at=$1 WHERE id=$2",
                datetime.utcnow(), payment_id
            )
        return {
            "payment_id": payment_id,
            "status": "cancelled",
            "amount": float(row["amount"]),
            "message": "Payment successfully cancelled",
            "cancelled_at": datetime.utcnow().isoformat()
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to cancel payment {payment_id}: {e}")
        raise HTTPException(status_code=500, detail="Payment cancellation failed")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "Payment Processing Service",
        "timestamp": datetime.utcnow().isoformat()
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8016)
