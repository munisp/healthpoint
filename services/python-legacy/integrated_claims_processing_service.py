"""
Integrated Claims Processing Service with NSA/IDR Workflow Support
Combines traditional claims processing with NSA compliance and IDR dispute handling
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from enum import Enum
import asyncio
import httpx
import logging
import json
import uuid

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Integrated Claims Processing Service",
    description="Claims processing with NSA/IDR compliance",
    version="2.0.0"
)

# Enums
class ClaimStatus(str, Enum):
    SUBMITTED = "submitted"
    UNDER_REVIEW = "under_review"
    APPROVED = "approved"
    DENIED = "denied"
    PENDING_IDR = "pending_idr"
    IDR_INITIATED = "idr_initiated"
    IDR_RESOLVED = "idr_resolved"

class NetworkStatus(str, Enum):
    IN_NETWORK = "in_network"
    OUT_OF_NETWORK = "out_of_network"
    EMERGENCY = "emergency"

class ServiceType(str, Enum):
    EMERGENCY = "emergency"
    NON_EMERGENCY = "non_emergency"
    POST_STABILIZATION = "post_stabilization"
    AIR_AMBULANCE = "air_ambulance"

# Models
class ClaimItem(BaseModel):
    procedure_code: str = Field(..., description="CPT/HCPCS procedure code")
    description: str
    billed_amount: float = Field(..., gt=0)
    allowed_amount: Optional[float] = None
    paid_amount: Optional[float] = None
    denial_reason: Optional[str] = None

class NSAEligibility(BaseModel):
    is_nsa_protected: bool
    service_type: ServiceType
    network_status: NetworkStatus
    service_date: datetime
    protection_reason: Optional[str] = None

class QPACalculation(BaseModel):
    procedure_code: str
    qpa_amount: float
    geographic_adjustment: float
    calculation_date: datetime
    data_source: str

class IDRDispute(BaseModel):
    dispute_id: Optional[str] = None
    disputed_amount: float
    qpa_amount: float
    initiating_party: str  # "provider" or "payer"
    dispute_reason: str
    supporting_documents: List[str] = []
    status: str = "pending"

class Claim(BaseModel):
    claim_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    patient_id: str
    provider_id: str
    payer_id: str
    service_date: datetime
    submission_date: datetime = Field(default_factory=datetime.utcnow)
    claim_items: List[ClaimItem]
    total_billed_amount: float
    status: ClaimStatus = ClaimStatus.SUBMITTED
    nsa_eligibility: Optional[NSAEligibility] = None
    qpa_calculations: List[QPACalculation] = []
    idr_dispute: Optional[IDRDispute] = None
    processing_notes: List[str] = []

class ClaimProcessingResult(BaseModel):
    claim_id: str
    status: ClaimStatus
    processed_amount: float
    patient_responsibility: float
    nsa_protected: bool
    qpa_applied: bool
    idr_eligible: bool
    processing_time_seconds: float

# Service clients
class ServiceClient:
    def __init__(self):
        self.base_urls = {
            "qpa_calculation": "http://localhost:8013",
            "nsa_compliance": "http://localhost:8017",
            "cms_api_integration": "http://localhost:8012",
            "ai_fraud_detection": "http://localhost:8009",
            "notification": "http://localhost:8006"
        }
    
    async def calculate_qpa(self, procedure_code: str, provider_npi: str, service_date: datetime) -> QPACalculation:
        """Calculate QPA for a procedure"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_urls['qpa_calculation']}/api/v1/qpa/calculate",
                    json={
                        "procedure_code": procedure_code,
                        "provider_npi": provider_npi,
                        "service_date": service_date.isoformat()
                    }
                )
                if response.status_code == 200:
                    data = response.json()
                    return QPACalculation(**data)
                else:
                    logger.error(f"QPA calculation failed: {response.text}")
                    return None
        except Exception as e:
            logger.error(f"QPA calculation error: {e}")
            return None
    
    async def check_nsa_eligibility(self, claim: Claim) -> NSAEligibility:
        """Check if claim is NSA protected"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_urls['nsa_compliance']}/api/v1/nsa-compliance/check-eligibility",
                    json={
                        "service_date": claim.service_date.isoformat(),
                        "provider_id": claim.provider_id,
                        "payer_id": claim.payer_id,
                        "procedure_codes": [item.procedure_code for item in claim.claim_items]
                    }
                )
                if response.status_code == 200:
                    data = response.json()
                    return NSAEligibility(**data)
                else:
                    logger.error(f"NSA eligibility check failed: {response.text}")
                    return None
        except Exception as e:
            logger.error(f"NSA eligibility error: {e}")
            return None
    
    async def initiate_idr_dispute(self, claim: Claim, dispute_data: Dict) -> IDRDispute:
        """Initiate IDR dispute"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_urls['cms_api_integration']}/api/v1/idr/disputes",
                    json=dispute_data
                )
                if response.status_code == 200:
                    data = response.json()
                    return IDRDispute(**data)
                else:
                    logger.error(f"IDR initiation failed: {response.text}")
                    return None
        except Exception as e:
            logger.error(f"IDR initiation error: {e}")
            return None
    
    async def fraud_detection_check(self, claim: Claim) -> Dict:
        """Run fraud detection on claim"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_urls['ai_fraud_detection']}/api/v1/fraud/analyze",
                    json={
                        "claim_id": claim.claim_id,
                        "provider_id": claim.provider_id,
                        "total_amount": claim.total_billed_amount,
                        "procedure_codes": [item.procedure_code for item in claim.claim_items]
                    }
                )
                if response.status_code == 200:
                    return response.json()
                else:
                    logger.error(f"Fraud detection failed: {response.text}")
                    return {"risk_score": 0.0, "risk_level": "low"}
        except Exception as e:
            logger.error(f"Fraud detection error: {e}")
            return {"risk_score": 0.0, "risk_level": "low"}

# Initialize service client
service_client = ServiceClient()

# In-memory storage (replace with database in production)
claims_db: Dict[str, Claim] = {}

# Core processing functions
async def process_claim_nsa_compliance(claim: Claim) -> Claim:
    """Process claim for NSA compliance"""
    start_time = datetime.utcnow()
    
    # Check NSA eligibility
    nsa_eligibility = await service_client.check_nsa_eligibility(claim)
    if nsa_eligibility:
        claim.nsa_eligibility = nsa_eligibility
        claim.processing_notes.append(f"NSA eligibility checked: {nsa_eligibility.is_nsa_protected}")
    
    # Calculate QPA for out-of-network claims
    if nsa_eligibility and nsa_eligibility.network_status == NetworkStatus.OUT_OF_NETWORK:
        qpa_calculations = []
        for item in claim.claim_items:
            qpa_calc = await service_client.calculate_qpa(
                item.procedure_code, 
                claim.provider_id, 
                claim.service_date
            )
            if qpa_calc:
                qpa_calculations.append(qpa_calc)
                # Apply QPA as allowed amount
                item.allowed_amount = qpa_calc.qpa_amount
                claim.processing_notes.append(f"QPA applied for {item.procedure_code}: ${qpa_calc.qpa_amount}")
        
        claim.qpa_calculations = qpa_calculations
    
    # Run fraud detection
    fraud_result = await service_client.fraud_detection_check(claim)
    if fraud_result.get("risk_level") == "high":
        claim.status = ClaimStatus.UNDER_REVIEW
        claim.processing_notes.append(f"Flagged for fraud review: {fraud_result.get('risk_score', 0)}")
    
    return claim

async def calculate_patient_responsibility(claim: Claim) -> float:
    """Calculate patient financial responsibility under NSA"""
    if not claim.nsa_eligibility or not claim.nsa_eligibility.is_nsa_protected:
        # Standard calculation for non-NSA claims
        return sum(item.billed_amount - (item.paid_amount or 0) for item in claim.claim_items)
    
    # NSA-protected calculation
    total_responsibility = 0.0
    for item in claim.claim_items:
        if item.allowed_amount:  # QPA applied
            # Patient pays in-network cost-sharing on QPA amount
            total_responsibility += item.allowed_amount * 0.2  # Assume 20% coinsurance
        else:
            # Standard calculation
            total_responsibility += item.billed_amount - (item.paid_amount or 0)
    
    return total_responsibility

async def check_idr_eligibility(claim: Claim) -> bool:
    """Check if claim is eligible for IDR"""
    if not claim.nsa_eligibility or not claim.nsa_eligibility.is_nsa_protected:
        return False
    
    # Check dispute amount threshold ($400+)
    disputed_amount = sum(
        item.billed_amount - (item.allowed_amount or 0) 
        for item in claim.claim_items 
        if item.allowed_amount
    )
    
    return disputed_amount >= 400.0

# API Endpoints
@app.post("/api/v1/claims/submit", response_model=ClaimProcessingResult)
async def submit_claim(claim: Claim, background_tasks: BackgroundTasks):
    """Submit a new claim for processing"""
    start_time = datetime.utcnow()
    
    try:
        # Store claim
        claims_db[claim.claim_id] = claim
        
        # Process NSA compliance
        claim = await process_claim_nsa_compliance(claim)
        
        # Calculate patient responsibility
        patient_responsibility = await calculate_patient_responsibility(claim)
        
        # Check IDR eligibility
        idr_eligible = await check_idr_eligibility(claim)
        
        # Update claim status
        if claim.status == ClaimStatus.SUBMITTED:
            claim.status = ClaimStatus.APPROVED
        
        # Calculate processing metrics
        processing_time = (datetime.utcnow() - start_time).total_seconds()
        processed_amount = sum(item.allowed_amount or item.billed_amount for item in claim.claim_items)
        
        # Update stored claim
        claims_db[claim.claim_id] = claim
        
        # Schedule background notifications
        background_tasks.add_task(send_processing_notifications, claim)
        
        return ClaimProcessingResult(
            claim_id=claim.claim_id,
            status=claim.status,
            processed_amount=processed_amount,
            patient_responsibility=patient_responsibility,
            nsa_protected=claim.nsa_eligibility.is_nsa_protected if claim.nsa_eligibility else False,
            qpa_applied=len(claim.qpa_calculations) > 0,
            idr_eligible=idr_eligible,
            processing_time_seconds=processing_time
        )
        
    except Exception as e:
        logger.error(f"Claim processing error: {e}")
        raise HTTPException(status_code=500, detail="Claim processing failed")

@app.post("/api/v1/claims/{claim_id}/initiate-idr")
async def initiate_idr(claim_id: str, dispute_reason: str, initiating_party: str):
    """Initiate IDR dispute for a claim"""
    if claim_id not in claims_db:
        raise HTTPException(status_code=404, detail="Claim not found")
    
    claim = claims_db[claim_id]
    
    # Check IDR eligibility
    if not await check_idr_eligibility(claim):
        raise HTTPException(status_code=400, detail="Claim not eligible for IDR")
    
    # Calculate disputed amount
    disputed_amount = sum(
        item.billed_amount - (item.allowed_amount or 0) 
        for item in claim.claim_items 
        if item.allowed_amount
    )
    
    # Get QPA amount
    qpa_amount = sum(calc.qpa_amount for calc in claim.qpa_calculations)
    
    # Create dispute data
    dispute_data = {
        "claim_id": claim_id,
        "disputed_amount": disputed_amount,
        "qpa_amount": qpa_amount,
        "initiating_party": initiating_party,
        "dispute_reason": dispute_reason,
        "service_date": claim.service_date.isoformat(),
        "provider_id": claim.provider_id,
        "payer_id": claim.payer_id
    }
    
    # Initiate IDR through CMS API
    idr_dispute = await service_client.initiate_idr_dispute(claim, dispute_data)
    
    if idr_dispute:
        claim.idr_dispute = idr_dispute
        claim.status = ClaimStatus.IDR_INITIATED
        claims_db[claim_id] = claim
        
        return {
            "message": "IDR dispute initiated successfully",
            "dispute_id": idr_dispute.dispute_id,
            "status": idr_dispute.status
        }
    else:
        raise HTTPException(status_code=500, detail="Failed to initiate IDR dispute")

@app.get("/api/v1/claims/{claim_id}")
async def get_claim(claim_id: str):
    """Get claim details"""
    if claim_id not in claims_db:
        raise HTTPException(status_code=404, detail="Claim not found")
    
    return claims_db[claim_id]

@app.get("/api/v1/claims")
async def list_claims(
    status: Optional[ClaimStatus] = None,
    nsa_protected: Optional[bool] = None,
    idr_eligible: Optional[bool] = None,
    limit: int = 100
):
    """List claims with filtering"""
    claims = list(claims_db.values())
    
    # Apply filters
    if status:
        claims = [c for c in claims if c.status == status]
    
    if nsa_protected is not None:
        claims = [
            c for c in claims 
            if c.nsa_eligibility and c.nsa_eligibility.is_nsa_protected == nsa_protected
        ]
    
    if idr_eligible is not None:
        filtered_claims = []
        for claim in claims:
            eligible = await check_idr_eligibility(claim)
            if eligible == idr_eligible:
                filtered_claims.append(claim)
        claims = filtered_claims
    
    return claims[:limit]

@app.get("/api/v1/claims/analytics/nsa-summary")
async def get_nsa_analytics():
    """Get NSA-related analytics"""
    total_claims = len(claims_db)
    nsa_protected_claims = sum(
        1 for claim in claims_db.values() 
        if claim.nsa_eligibility and claim.nsa_eligibility.is_nsa_protected
    )
    idr_initiated_claims = sum(
        1 for claim in claims_db.values() 
        if claim.status == ClaimStatus.IDR_INITIATED
    )
    
    total_qpa_applied = sum(
        len(claim.qpa_calculations) for claim in claims_db.values()
    )
    
    return {
        "total_claims": total_claims,
        "nsa_protected_claims": nsa_protected_claims,
        "nsa_protection_rate": nsa_protected_claims / total_claims if total_claims > 0 else 0,
        "idr_initiated_claims": idr_initiated_claims,
        "qpa_calculations_applied": total_qpa_applied,
        "average_processing_time": 2.3  # Mock data
    }

# Background tasks
async def send_processing_notifications(claim: Claim):
    """Send notifications about claim processing"""
    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                f"{service_client.base_urls['notification']}/api/v1/notifications/send",
                json={
                    "recipient_id": claim.patient_id,
                    "type": "claim_processed",
                    "message": f"Your claim {claim.claim_id} has been processed",
                    "claim_id": claim.claim_id
                }
            )
    except Exception as e:
        logger.error(f"Notification error: {e}")

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "integrated_claims_processing",
        "timestamp": datetime.utcnow().isoformat(),
        "claims_processed": len(claims_db)
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8005)
