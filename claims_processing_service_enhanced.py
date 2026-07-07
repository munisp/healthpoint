"""
Enhanced Claims Processing Service with NSA/IDR Support
Extends existing claims processing with No Surprises Act capabilities
Port: 8002
"""

import json
import logging
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from enum import Enum
from typing import Dict, List, Optional, Any

import asyncpg
import httpx
from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import structlog

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = structlog.get_logger()

app = FastAPI(
    title="Enhanced Claims Processing Service with NSA Support",
    description="Claims processing with No Surprises Act dispute detection",
    version="2.0.0"
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
NSA_IDR_SERVICE_URL = "http://localhost:8016"

# Enums
class ClaimStatus(str, Enum):
    SUBMITTED = "submitted"
    PROCESSING = "processing"
    APPROVED = "approved"
    DENIED = "denied"
    PENDING_REVIEW = "pending_review"
    NSA_DISPUTE_ELIGIBLE = "nsa_dispute_eligible"
    NSA_NEGOTIATION = "nsa_negotiation"

class NetworkStatus(str, Enum):
    IN_NETWORK = "in_network"
    OUT_OF_NETWORK = "out_of_network"
    EMERGENCY = "emergency"

class ServiceCategory(str, Enum):
    EMERGENCY_SERVICES = "emergency_services"
    POST_STABILIZATION = "post_stabilization"
    NON_EMERGENCY = "non_emergency"
    AIR_AMBULANCE = "air_ambulance"

# Pydantic Models
class ClaimItem(BaseModel):
    service_date: datetime
    service_code: str
    service_description: str
    billed_amount: Decimal
    allowed_amount: Optional[Decimal] = None
    paid_amount: Optional[Decimal] = None
    denial_reason: Optional[str] = None

class NSAEligibilityCheck(BaseModel):
    is_eligible: bool
    service_category: Optional[ServiceCategory] = None
    reason: str
    effective_date: datetime

class EnhancedClaim(BaseModel):
    claim_id: str
    patient_id: str
    provider_id: str
    facility_id: Optional[str] = None
    payer_id: str
    claim_items: List[ClaimItem]
    network_status: NetworkStatus
    service_category: ServiceCategory
    total_billed: Decimal
    total_allowed: Optional[Decimal] = None
    total_paid: Optional[Decimal] = None
    status: ClaimStatus
    nsa_eligibility: Optional[NSAEligibilityCheck] = None
    created_at: datetime
    updated_at: datetime

# Database connection
async def get_db():
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        yield conn
    finally:
        await conn.close()

# Enhanced Claims Processing Service
class EnhancedClaimsService:
    def __init__(self):
        self.nsa_client = httpx.AsyncClient(base_url=NSA_IDR_SERVICE_URL)

    async def process_claim(
        self, 
        claim: EnhancedClaim,
        db: asyncpg.Connection
    ) -> EnhancedClaim:
        """Process claim with NSA eligibility checking"""
        
        # Check NSA eligibility
        nsa_eligibility = await self._check_nsa_eligibility(claim)
        claim.nsa_eligibility = nsa_eligibility
        
        # Process claim normally
        processed_claim = await self._process_standard_claim(claim, db)
        
        # Check for potential NSA disputes
        if await self._should_trigger_nsa_process(processed_claim):
            processed_claim.status = ClaimStatus.NSA_DISPUTE_ELIGIBLE
            await self._initiate_nsa_negotiation_period(processed_claim, db)
        
        # Save to database
        await self._save_claim(processed_claim, db)
        
        logger.info("Claim processed", 
                   claim_id=claim.claim_id,
                   status=processed_claim.status,
                   nsa_eligible=nsa_eligibility.is_eligible)
        
        return processed_claim

    async def _check_nsa_eligibility(self, claim: EnhancedClaim) -> NSAEligibilityCheck:
        """Check if claim is eligible for NSA protections"""
        
        # NSA effective date
        nsa_effective_date = datetime(2022, 1, 1)
        
        # Check service date
        latest_service_date = max(item.service_date for item in claim.claim_items)
        if latest_service_date < nsa_effective_date:
            return NSAEligibilityCheck(
                is_eligible=False,
                reason="Service date before NSA effective date",
                effective_date=nsa_effective_date
            )
        
        # Check network status and service category
        if claim.network_status == NetworkStatus.OUT_OF_NETWORK:
            if claim.service_category in [
                ServiceCategory.EMERGENCY_SERVICES,
                ServiceCategory.POST_STABILIZATION,
                ServiceCategory.AIR_AMBULANCE
            ]:
                return NSAEligibilityCheck(
                    is_eligible=True,
                    service_category=claim.service_category,
                    reason="Out-of-network emergency/post-stabilization services",
                    effective_date=nsa_effective_date
                )
            
            # Check for non-emergency services at in-network facilities
            if claim.facility_id and claim.service_category == ServiceCategory.NON_EMERGENCY:
                # Would need to check if facility is in-network
                return NSAEligibilityCheck(
                    is_eligible=True,
                    service_category=claim.service_category,
                    reason="Out-of-network provider at in-network facility",
                    effective_date=nsa_effective_date
                )
        
        return NSAEligibilityCheck(
            is_eligible=False,
            reason="Does not meet NSA criteria",
            effective_date=nsa_effective_date
        )

    async def _process_standard_claim(
        self, 
        claim: EnhancedClaim,
        db: asyncpg.Connection
    ) -> EnhancedClaim:
        """Standard claim processing logic"""
        
        # Calculate totals
        claim.total_billed = sum(item.billed_amount for item in claim.claim_items)
        
        # Mock processing logic - in real implementation would involve:
        # - Eligibility verification
        # - Benefits calculation
        # - Medical necessity review
        # - Fraud detection
        
        # For demonstration, approve most claims
        claim.status = ClaimStatus.APPROVED
        claim.total_allowed = claim.total_billed * Decimal("0.8")  # 80% allowed
        claim.total_paid = claim.total_allowed * Decimal("0.9")    # 90% paid
        
        # Update claim items
        for item in claim.claim_items:
            item.allowed_amount = item.billed_amount * Decimal("0.8")
            item.paid_amount = item.allowed_amount * Decimal("0.9")
        
        claim.updated_at = datetime.utcnow()
        return claim

    async def _should_trigger_nsa_process(self, claim: EnhancedClaim) -> bool:
        """Determine if claim should trigger NSA dispute process"""
        
        if not claim.nsa_eligibility or not claim.nsa_eligibility.is_eligible:
            return False
        
        # Check for payment disputes
        if claim.status == ClaimStatus.DENIED:
            return True
        
        # Check for underpayment (simplified logic)
        if claim.total_paid and claim.total_billed:
            payment_ratio = claim.total_paid / claim.total_billed
            if payment_ratio < Decimal("0.5"):  # Less than 50% paid
                return True
        
        return False

    async def _initiate_nsa_negotiation_period(
        self, 
        claim: EnhancedClaim,
        db: asyncpg.Connection
    ):
        """Initiate NSA negotiation period"""
        
        negotiation_start = datetime.utcnow()
        negotiation_end = negotiation_start + timedelta(days=30)
        
        # Create negotiation record
        await db.execute("""
            INSERT INTO nsa_negotiations (
                claim_id, negotiation_start, negotiation_end,
                status, created_at
            ) VALUES ($1, $2, $3, $4, $5)
        """, 
            claim.claim_id,
            negotiation_start,
            negotiation_end,
            "active",
            datetime.utcnow()
        )
        
        logger.info("NSA negotiation period initiated", 
                   claim_id=claim.claim_id,
                   negotiation_end=negotiation_end)

    async def _save_claim(self, claim: EnhancedClaim, db: asyncpg.Connection):
        """Save claim to database"""
        
        await db.execute("""
            INSERT INTO enhanced_claims (
                claim_id, patient_id, provider_id, facility_id, payer_id,
                network_status, service_category, total_billed, total_allowed,
                total_paid, status, nsa_eligibility, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            ON CONFLICT (claim_id) DO UPDATE SET
                status = EXCLUDED.status,
                total_allowed = EXCLUDED.total_allowed,
                total_paid = EXCLUDED.total_paid,
                nsa_eligibility = EXCLUDED.nsa_eligibility,
                updated_at = EXCLUDED.updated_at
        """,
            claim.claim_id, claim.patient_id, claim.provider_id,
            claim.facility_id, claim.payer_id, claim.network_status.value,
            claim.service_category.value, claim.total_billed,
            claim.total_allowed, claim.total_paid, claim.status.value,
            json.dumps(claim.nsa_eligibility.dict() if claim.nsa_eligibility else None),
            claim.created_at, claim.updated_at
        )

    async def create_bulk_nsa_dispute(
        self,
        claim_ids: List[str],
        db: asyncpg.Connection
    ) -> Dict[str, Any]:
        """Create bulk NSA dispute for multiple claims"""
        
        # Get NSA-eligible claims
        claims = await db.fetch("""
            SELECT * FROM enhanced_claims 
            WHERE claim_id = ANY($1) AND status = $2
        """, claim_ids, ClaimStatus.NSA_DISPUTE_ELIGIBLE.value)
        
        if not claims:
            raise HTTPException(
                status_code=404, 
                detail="No NSA-eligible claims found"
            )
        
        # Prepare bulk dispute request
        qualified_items = []
        for claim in claims:
            # Get claim items
            items = await db.fetch("""
                SELECT * FROM claim_items WHERE claim_id = $1
            """, claim['claim_id'])
            
            for item in items:
                qualified_items.append({
                    "service_date": item['service_date'].isoformat(),
                    "service_location": "Healthcare Facility",
                    "service_type": claim['service_category'],
                    "service_codes": [item['service_code']],
                    "claim_number": claim['claim_id'],
                    "billed_amount": float(item['billed_amount'])
                })
        
        # Submit to NSA/IDR service
        try:
            response = await self.nsa_client.post(
                "/disputes/bulk",
                json={
                    "qualified_items": qualified_items,
                    "negotiation_summary": f"Bulk dispute for {len(claims)} claims"
                }
            )
            response.raise_for_status()
            dispute_data = response.json()
            
            # Update claim statuses
            await db.execute("""
                UPDATE enhanced_claims 
                SET status = $1, updated_at = $2
                WHERE claim_id = ANY($3)
            """, 
                ClaimStatus.NSA_NEGOTIATION.value,
                datetime.utcnow(),
                claim_ids
            )
            
            return {
                "dispute_id": dispute_data["dispute_id"],
                "claims_count": len(claims),
                "total_amount": dispute_data["total_amount"],
                "status": "negotiation_started"
            }
            
        except httpx.HTTPError as e:
            logger.error("Failed to create NSA dispute", error=str(e))
            raise HTTPException(
                status_code=500,
                detail=f"Failed to create NSA dispute: {str(e)}"
            )

# Initialize service
claims_service = EnhancedClaimsService()

# API Endpoints
@app.post("/claims", response_model=EnhancedClaim)
async def submit_claim(
    claim: EnhancedClaim,
    db: asyncpg.Connection = Depends(get_db)
):
    """Submit and process a claim with NSA checking"""
    return await claims_service.process_claim(claim, db)

@app.get("/claims/{claim_id}")
async def get_claim(
    claim_id: str,
    db: asyncpg.Connection = Depends(get_db)
):
    """Get claim details"""
    
    claim = await db.fetchrow("""
        SELECT * FROM enhanced_claims WHERE claim_id = $1
    """, claim_id)
    
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    
    return dict(claim)

@app.get("/claims")
async def list_claims(
    status: Optional[ClaimStatus] = None,
    nsa_eligible: Optional[bool] = None,
    limit: int = 100,
    offset: int = 0,
    db: asyncpg.Connection = Depends(get_db)
):
    """List claims with filtering"""
    
    query = "SELECT * FROM enhanced_claims WHERE 1=1"
    params = []
    
    if status:
        query += f" AND status = ${len(params)+1}"
        params.append(status.value)
    
    if nsa_eligible is not None:
        if nsa_eligible:
            query += f" AND nsa_eligibility IS NOT NULL"
        else:
            query += f" AND nsa_eligibility IS NULL"
    
    query += f" ORDER BY created_at DESC LIMIT ${len(params)+1} OFFSET ${len(params)+2}"
    params.extend([limit, offset])
    
    claims = await db.fetch(query, *params)
    
    return {
        "claims": [dict(claim) for claim in claims],
        "total": len(claims)
    }

@app.post("/claims/nsa-dispute/bulk")
async def create_bulk_nsa_dispute(
    claim_ids: List[str],
    db: asyncpg.Connection = Depends(get_db)
):
    """Create bulk NSA dispute for multiple claims"""
    return await claims_service.create_bulk_nsa_dispute(claim_ids, db)

@app.get("/claims/nsa-eligible")
async def get_nsa_eligible_claims(
    db: asyncpg.Connection = Depends(get_db)
):
    """Get claims eligible for NSA dispute process"""
    
    claims = await db.fetch("""
        SELECT * FROM enhanced_claims 
        WHERE status = $1 OR status = $2
        ORDER BY created_at DESC
    """, 
        ClaimStatus.NSA_DISPUTE_ELIGIBLE.value,
        ClaimStatus.NSA_NEGOTIATION.value
    )
    
    return {
        "nsa_eligible_claims": [dict(claim) for claim in claims],
        "count": len(claims)
    }

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "Enhanced Claims Processing with NSA Support",
        "timestamp": datetime.utcnow().isoformat(),
        "nsa_support": True
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
