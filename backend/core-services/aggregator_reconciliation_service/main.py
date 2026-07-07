"""
Aggregator Reconciliation Service
Handles aggregator mapping, bulk submission reconciliation, and provider assignment validation
Ensures proper attribution of claims to correct aggregators and providers
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
from datetime import datetime, timedelta
from enum import Enum
import asyncio
import pandas as pd
import json
import logging
from sqlalchemy import create_engine, Column, String, DateTime, Integer, Text, Boolean, Decimal, JSON, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship
import redis.asyncio as redis.asyncio as redis
from collections import defaultdict
import hashlib
from shared.telemetry import setup_telemetry, instrument_fastapi, get_tracer

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

setup_telemetry(service_name="aggregator-reconciliation-service", service_version="1.0.0")
app = FastAPI(title="Aggregator Reconciliation Service", version="1.0.0")
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

class ReconciliationStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    PARTIAL = "partial"

class ValidationResult(str, Enum):
    VALID = "valid"
    INVALID = "invalid"
    WARNING = "warning"

# Database Models
class Aggregator(Base):
    __tablename__ = "aggregators"
    
    id = Column(Integer, primary_key=True, index=True)
    aggregator_id = Column(String(50), unique=True, index=True)
    name = Column(String(255))
    contact_email = Column(String(255))
    contact_phone = Column(String(50))
    address = Column(Text)
    tax_id = Column(String(20))
    billing_plan_id = Column(String(50))
    status = Column(String(20), default="active")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    providers = relationship("AggregatorProvider", back_populates="aggregator")
    submissions = relationship("BulkSubmission", back_populates="aggregator")

class AggregatorProvider(Base):
    __tablename__ = "aggregator_providers"
    
    id = Column(Integer, primary_key=True, index=True)
    aggregator_id = Column(String(50), ForeignKey("aggregators.aggregator_id"))
    provider_npi = Column(String(10), index=True)
    provider_name = Column(String(255))
    provider_tax_id = Column(String(20))
    specialty = Column(String(100))
    assignment_date = Column(DateTime, default=datetime.utcnow)
    status = Column(String(20), default="active")
    billing_rate = Column(Decimal(10, 2))  # Per-provider billing rate
    
    # Relationships
    aggregator = relationship("Aggregator", back_populates="providers")

class BulkSubmission(Base):
    __tablename__ = "bulk_submissions"
    
    id = Column(Integer, primary_key=True, index=True)
    batch_id = Column(String(100), unique=True, index=True)
    aggregator_id = Column(String(50), ForeignKey("aggregators.aggregator_id"))
    total_claims = Column(Integer)
    valid_claims = Column(Integer)
    invalid_claims = Column(Integer)
    total_amount = Column(Decimal(15, 2))
    reconciliation_status = Column(String(20), default=ReconciliationStatus.PENDING.value)
    submission_date = Column(DateTime, default=datetime.utcnow)
    reconciliation_date = Column(DateTime)
    reconciliation_details = Column(JSON)
    billing_amount = Column(Decimal(10, 2))  # Amount to charge aggregator
    
    # Relationships
    aggregator = relationship("Aggregator", back_populates="submissions")
    claim_mappings = relationship("ClaimMapping", back_populates="submission")

class ClaimMapping(Base):
    __tablename__ = "claim_mappings"
    
    id = Column(Integer, primary_key=True, index=True)
    submission_id = Column(Integer, ForeignKey("bulk_submissions.id"))
    claim_id = Column(String(50), index=True)
    provider_npi = Column(String(10))
    aggregator_id = Column(String(50))
    validation_status = Column(String(20))
    validation_errors = Column(JSON)
    dispute_amount = Column(Decimal(15, 2))
    billing_charge = Column(Decimal(10, 2))  # Individual claim billing charge
    
    # Relationships
    submission = relationship("BulkSubmission", back_populates="claim_mappings")

class ReconciliationLog(Base):
    __tablename__ = "reconciliation_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    batch_id = Column(String(100), index=True)
    aggregator_id = Column(String(50))
    action = Column(String(100))
    details = Column(JSON)
    timestamp = Column(DateTime, default=datetime.utcnow)
    user_id = Column(String(50))

# Pydantic Models
class AggregatorInfo(BaseModel):
    aggregator_id: str
    name: str
    contact_email: str
    contact_phone: Optional[str] = None
    address: Optional[str] = None
    tax_id: str
    billing_plan_id: str

class ProviderMapping(BaseModel):
    provider_npi: str
    provider_name: str
    provider_tax_id: str
    specialty: str
    billing_rate: Decimal

class ClaimValidation(BaseModel):
    claim_id: str
    provider_npi: str
    aggregator_id: str
    validation_status: ValidationResult
    errors: List[str] = []
    warnings: List[str] = []

class ReconciliationRequest(BaseModel):
    batch_id: str
    aggregator_id: str
    claims_data: List[Dict[str, Any]]
    force_reconciliation: bool = False

class ReconciliationResult(BaseModel):
    batch_id: str
    aggregator_id: str
    total_claims: int
    valid_claims: int
    invalid_claims: int
    warnings: int
    total_amount: Decimal
    billing_amount: Decimal
    reconciliation_status: ReconciliationStatus
    details: Dict[str, Any]

# Aggregator Reconciliation Engine
class AggregatorReconciliationEngine:
    def __init__(self):
        self.provider_cache = {}
        self.aggregator_cache = {}
        self.refresh_cache()
    
    def refresh_cache(self):
        """Refresh provider-aggregator mapping cache"""
        db = SessionLocal()
        try:
            # Cache aggregator information
            aggregators = db.query(Aggregator).filter(Aggregator.status == "active").all()
            self.aggregator_cache = {
                agg.aggregator_id: {
                    "name": agg.name,
                    "billing_plan_id": agg.billing_plan_id,
                    "contact_email": agg.contact_email
                }
                for agg in aggregators
            }
            
            # Cache provider-aggregator mappings
            provider_mappings = db.query(AggregatorProvider).filter(
                AggregatorProvider.status == "active"
            ).all()
            
            self.provider_cache = defaultdict(list)
            for mapping in provider_mappings:
                self.provider_cache[mapping.provider_npi].append({
                    "aggregator_id": mapping.aggregator_id,
                    "provider_name": mapping.provider_name,
                    "specialty": mapping.specialty,
                    "billing_rate": float(mapping.billing_rate) if mapping.billing_rate else 0.0
                })
            
            logger.info(f"Cache refreshed: {len(self.aggregator_cache)} aggregators, {len(self.provider_cache)} providers")
            
        except Exception as e:
            logger.error(f"Cache refresh error: {str(e)}")
        finally:
            db.close()
    
    async def validate_claim_mapping(self, claim: Dict[str, Any], expected_aggregator_id: str) -> ClaimValidation:
        """Validate that a claim is properly mapped to the correct aggregator"""
        claim_id = claim.get('claim_id', '')
        provider_npi = claim.get('provider_npi', '')
        
        errors = []
        warnings = []
        
        # Check if provider exists in our system
        if provider_npi not in self.provider_cache:
            errors.append(f"Provider NPI {provider_npi} not found in system")
            return ClaimValidation(
                claim_id=claim_id,
                provider_npi=provider_npi,
                aggregator_id=expected_aggregator_id,
                validation_status=ValidationResult.INVALID,
                errors=errors
            )
        
        # Check if provider is assigned to the expected aggregator
        provider_mappings = self.provider_cache[provider_npi]
        valid_aggregators = [mapping['aggregator_id'] for mapping in provider_mappings]
        
        if expected_aggregator_id not in valid_aggregators:
            errors.append(f"Provider {provider_npi} is not assigned to aggregator {expected_aggregator_id}")
            errors.append(f"Valid aggregators for this provider: {', '.join(valid_aggregators)}")
            return ClaimValidation(
                claim_id=claim_id,
                provider_npi=provider_npi,
                aggregator_id=expected_aggregator_id,
                validation_status=ValidationResult.INVALID,
                errors=errors
            )
        
        # Additional validations
        dispute_amount = float(claim.get('dispute_amount', 0))
        if dispute_amount <= 0:
            errors.append("Dispute amount must be greater than zero")
        
        if dispute_amount > 50000:  # High-value claim warning
            warnings.append(f"High-value dispute amount: ${dispute_amount:,.2f}")
        
        # Validate required fields
        required_fields = ['claim_id', 'provider_npi', 'service_date', 'dispute_amount', 'dispute_type']
        for field in required_fields:
            if not claim.get(field):
                errors.append(f"Missing required field: {field}")
        
        # Determine validation status
        if errors:
            status = ValidationResult.INVALID
        elif warnings:
            status = ValidationResult.WARNING
        else:
            status = ValidationResult.VALID
        
        return ClaimValidation(
            claim_id=claim_id,
            provider_npi=provider_npi,
            aggregator_id=expected_aggregator_id,
            validation_status=status,
            errors=errors,
            warnings=warnings
        )
    
    async def reconcile_bulk_submission(self, batch_id: str, aggregator_id: str, 
                                      claims_data: List[Dict[str, Any]]) -> ReconciliationResult:
        """Reconcile bulk submission and validate all claim mappings"""
        db = SessionLocal()
        try:
            # Create bulk submission record
            submission = BulkSubmission(
                batch_id=batch_id,
                aggregator_id=aggregator_id,
                total_claims=len(claims_data),
                reconciliation_status=ReconciliationStatus.IN_PROGRESS.value
            )
            db.add(submission)
            db.commit()
            db.refresh(submission)
            
            # Validate each claim
            valid_claims = 0
            invalid_claims = 0
            warnings = 0
            total_amount = Decimal('0.00')
            billing_amount = Decimal('0.00')
            
            validation_details = {
                "valid_claims": [],
                "invalid_claims": [],
                "warnings": [],
                "provider_summary": defaultdict(int),
                "dispute_type_summary": defaultdict(int)
            }
            
            for claim in claims_data:
                validation = await self.validate_claim_mapping(claim, aggregator_id)
                
                # Calculate billing charge for this claim
                claim_billing_charge = self._calculate_claim_billing_charge(
                    claim, validation.provider_npi, aggregator_id
                )
                
                # Create claim mapping record
                claim_mapping = ClaimMapping(
                    submission_id=submission.id,
                    claim_id=validation.claim_id,
                    provider_npi=validation.provider_npi,
                    aggregator_id=aggregator_id,
                    validation_status=validation.validation_status.value,
                    validation_errors=validation.errors + validation.warnings,
                    dispute_amount=Decimal(str(claim.get('dispute_amount', 0))),
                    billing_charge=claim_billing_charge
                )
                db.add(claim_mapping)
                
                # Update counters
                if validation.validation_status == ValidationResult.VALID:
                    valid_claims += 1
                    total_amount += Decimal(str(claim.get('dispute_amount', 0)))
                    billing_amount += claim_billing_charge
                    validation_details["valid_claims"].append(validation.dict())
                elif validation.validation_status == ValidationResult.WARNING:
                    valid_claims += 1
                    warnings += 1
                    total_amount += Decimal(str(claim.get('dispute_amount', 0)))
                    billing_amount += claim_billing_charge
                    validation_details["warnings"].append(validation.dict())
                else:
                    invalid_claims += 1
                    validation_details["invalid_claims"].append(validation.dict())
                
                # Update summaries
                validation_details["provider_summary"][validation.provider_npi] += 1
                validation_details["dispute_type_summary"][claim.get('dispute_type', 'unknown')] += 1
            
            # Update submission record
            submission.valid_claims = valid_claims
            submission.invalid_claims = invalid_claims
            submission.total_amount = total_amount
            submission.billing_amount = billing_amount
            submission.reconciliation_date = datetime.utcnow()
            submission.reconciliation_details = validation_details
            
            if invalid_claims == 0:
                submission.reconciliation_status = ReconciliationStatus.COMPLETED.value
            elif valid_claims > 0:
                submission.reconciliation_status = ReconciliationStatus.PARTIAL.value
            else:
                submission.reconciliation_status = ReconciliationStatus.FAILED.value
            
            db.commit()
            
            # Log reconciliation
            await self._log_reconciliation(
                batch_id, aggregator_id, "BULK_RECONCILIATION",
                {
                    "total_claims": len(claims_data),
                    "valid_claims": valid_claims,
                    "invalid_claims": invalid_claims,
                    "billing_amount": float(billing_amount)
                }
            )
            
            return ReconciliationResult(
                batch_id=batch_id,
                aggregator_id=aggregator_id,
                total_claims=len(claims_data),
                valid_claims=valid_claims,
                invalid_claims=invalid_claims,
                warnings=warnings,
                total_amount=total_amount,
                billing_amount=billing_amount,
                reconciliation_status=ReconciliationStatus(submission.reconciliation_status),
                details=validation_details
            )
            
        except Exception as e:
            logger.error(f"Reconciliation error: {str(e)}")
            if 'submission' in locals():
                submission.reconciliation_status = ReconciliationStatus.FAILED.value
                db.commit()
            raise HTTPException(status_code=500, detail=f"Reconciliation failed: {str(e)}")
        finally:
            db.close()
    
    def _calculate_claim_billing_charge(self, claim: Dict[str, Any], provider_npi: str, aggregator_id: str) -> Decimal:
        """Calculate billing charge for individual claim based on provider and aggregator rates"""
        base_rate = Decimal('15.00')  # Default per-claim rate
        
        # Get provider-specific rate if available
        if provider_npi in self.provider_cache:
            for mapping in self.provider_cache[provider_npi]:
                if mapping['aggregator_id'] == aggregator_id and mapping['billing_rate'] > 0:
                    base_rate = Decimal(str(mapping['billing_rate']))
                    break
        
        # Apply modifiers based on claim characteristics
        dispute_amount = Decimal(str(claim.get('dispute_amount', 0)))
        
        # High-value claim modifier
        if dispute_amount > 10000:
            base_rate *= Decimal('1.5')  # 50% increase for high-value claims
        elif dispute_amount > 5000:
            base_rate *= Decimal('1.25')  # 25% increase for medium-value claims
        
        # Emergency services modifier
        if claim.get('emergency_indicator'):
            base_rate *= Decimal('1.2')  # 20% increase for emergency services
        
        # Complex dispute type modifier
        complex_types = ['AIR_AMBULANCE', 'ANCILLARY_SERVICES']
        if claim.get('dispute_type') in complex_types:
            base_rate *= Decimal('1.3')  # 30% increase for complex disputes
        
        return base_rate.quantize(Decimal('0.01'))
    
    async def _log_reconciliation(self, batch_id: str, aggregator_id: str, action: str, details: Dict[str, Any]):
        """Log reconciliation activity"""
        db = SessionLocal()
        try:
            log_entry = ReconciliationLog(
                batch_id=batch_id,
                aggregator_id=aggregator_id,
                action=action,
                details=details,
                timestamp=datetime.utcnow(),
                user_id="system"
            )
            db.add(log_entry)
            db.commit()
        except Exception as e:
            logger.error(f"Logging error: {str(e)}")
        finally:
            db.close()

# Provider Assignment Manager
class ProviderAssignmentManager:
    def __init__(self):
        self.reconciliation_engine = AggregatorReconciliationEngine()
    
    async def assign_provider_to_aggregator(self, aggregator_id: str, provider_info: ProviderMapping) -> Dict[str, Any]:
        """Assign a provider to an aggregator"""
        db = SessionLocal()
        try:
            # Check if aggregator exists
            aggregator = db.query(Aggregator).filter(
                Aggregator.aggregator_id == aggregator_id,
                Aggregator.status == "active"
            ).first()
            
            if not aggregator:
                raise HTTPException(status_code=404, detail=f"Aggregator {aggregator_id} not found")
            
            # Check if provider is already assigned
            existing_assignment = db.query(AggregatorProvider).filter(
                AggregatorProvider.aggregator_id == aggregator_id,
                AggregatorProvider.provider_npi == provider_info.provider_npi,
                AggregatorProvider.status == "active"
            ).first()
            
            if existing_assignment:
                raise HTTPException(status_code=409, detail="Provider already assigned to this aggregator")
            
            # Create new assignment
            assignment = AggregatorProvider(
                aggregator_id=aggregator_id,
                provider_npi=provider_info.provider_npi,
                provider_name=provider_info.provider_name,
                provider_tax_id=provider_info.provider_tax_id,
                specialty=provider_info.specialty,
                billing_rate=provider_info.billing_rate,
                assignment_date=datetime.utcnow(),
                status="active"
            )
            
            db.add(assignment)
            db.commit()
            db.refresh(assignment)
            
            # Refresh cache
            self.reconciliation_engine.refresh_cache()
            
            return {
                "status": "success",
                "message": f"Provider {provider_info.provider_npi} assigned to aggregator {aggregator_id}",
                "assignment_id": assignment.id,
                "billing_rate": float(provider_info.billing_rate)
            }
            
        except HTTPException:
            raise
        except Exception as e:
            db.rollback()
            logger.error(f"Provider assignment error: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Assignment failed: {str(e)}")
        finally:
            db.close()
    
    async def get_aggregator_providers(self, aggregator_id: str) -> List[Dict[str, Any]]:
        """Get all providers assigned to an aggregator"""
        db = SessionLocal()
        try:
            providers = db.query(AggregatorProvider).filter(
                AggregatorProvider.aggregator_id == aggregator_id,
                AggregatorProvider.status == "active"
            ).all()
            
            return [
                {
                    "provider_npi": provider.provider_npi,
                    "provider_name": provider.provider_name,
                    "specialty": provider.specialty,
                    "billing_rate": float(provider.billing_rate) if provider.billing_rate else 0.0,
                    "assignment_date": provider.assignment_date.isoformat()
                }
                for provider in providers
            ]
            
        except Exception as e:
            logger.error(f"Error fetching providers: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to fetch providers: {str(e)}")
        finally:
            db.close()

# API Endpoints
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

reconciliation_engine = AggregatorReconciliationEngine()
provider_manager = ProviderAssignmentManager()

@app.post("/api/v1/reconciliation/bulk-submit", response_model=ReconciliationResult)
async def reconcile_bulk_submission(
    request: ReconciliationRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Reconcile bulk submission and validate claim mappings"""
    try:
        result = await reconciliation_engine.reconcile_bulk_submission(
            request.batch_id,
            request.aggregator_id,
            request.claims_data
        )
        
        # Cache result for quick access
        redis_client.setex(
            f"reconciliation:{request.batch_id}",
            3600,  # 1 hour TTL
            json.dumps(result.dict(), default=str)
        )
        
        return result
        
    except Exception as e:
        logger.error(f"Bulk reconciliation error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Reconciliation failed: {str(e)}")

@app.get("/api/v1/reconciliation/status/{batch_id}")
async def get_reconciliation_status(batch_id: str, db: Session = Depends(get_db),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get reconciliation status for a batch"""
    # Try cache first
    cached_result = redis_client.get(f"reconciliation:{batch_id}")
    if cached_result:
        return json.loads(cached_result)
    
    # Query database
    submission = db.query(BulkSubmission).filter(BulkSubmission.batch_id == batch_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    return {
        "batch_id": submission.batch_id,
        "aggregator_id": submission.aggregator_id,
        "total_claims": submission.total_claims,
        "valid_claims": submission.valid_claims,
        "invalid_claims": submission.invalid_claims,
        "reconciliation_status": submission.reconciliation_status,
        "billing_amount": float(submission.billing_amount) if submission.billing_amount else 0.0,
        "details": submission.reconciliation_details
    }

@app.post("/api/v1/aggregators/{aggregator_id}/providers")
async def assign_provider(
    aggregator_id: str,
    provider_info: ProviderMapping,
    db: Session = Depends(get_db)
,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Assign a provider to an aggregator"""
    return await provider_manager.assign_provider_to_aggregator(aggregator_id, provider_info)

@app.get("/api/v1/aggregators/{aggregator_id}/providers")
async def get_aggregator_providers(aggregator_id: str, db: Session = Depends(get_db),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get all providers assigned to an aggregator"""
    return await provider_manager.get_aggregator_providers(aggregator_id)

@app.post("/api/v1/reconciliation/validate-claim")
async def validate_single_claim(claim_data: Dict[str, Any], aggregator_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Validate a single claim mapping"""
    validation = await reconciliation_engine.validate_claim_mapping(claim_data, aggregator_id)
    return validation

@app.post("/api/v1/reconciliation/refresh-cache")
async def refresh_provider_cache(,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Refresh provider-aggregator mapping cache"""
    reconciliation_engine.refresh_cache()
    return {"status": "cache refreshed", "timestamp": datetime.utcnow().isoformat()}

@app.get("/api/v1/reconciliation/aggregator-summary/{aggregator_id}")
async def get_aggregator_summary(aggregator_id: str, db: Session = Depends(get_db),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get summary of submissions and billing for an aggregator"""
    submissions = db.query(BulkSubmission).filter(
        BulkSubmission.aggregator_id == aggregator_id
    ).all()
    
    total_submissions = len(submissions)
    total_claims = sum(s.total_claims or 0 for s in submissions)
    total_billing = sum(float(s.billing_amount or 0) for s in submissions)
    
    recent_submissions = [
        {
            "batch_id": s.batch_id,
            "submission_date": s.submission_date.isoformat(),
            "total_claims": s.total_claims,
            "valid_claims": s.valid_claims,
            "billing_amount": float(s.billing_amount or 0),
            "status": s.reconciliation_status
        }
        for s in sorted(submissions, key=lambda x: x.submission_date, reverse=True)[:10]
    ]
    
    return {
        "aggregator_id": aggregator_id,
        "total_submissions": total_submissions,
        "total_claims": total_claims,
        "total_billing": total_billing,
        "recent_submissions": recent_submissions
    }

# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "Aggregator Reconciliation Service",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0.0",
        "cache_status": {
            "aggregators": len(reconciliation_engine.aggregator_cache),
            "providers": len(reconciliation_engine.provider_cache)
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8021)