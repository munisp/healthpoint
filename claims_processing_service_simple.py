#!/usr/bin/env python3
"""
Healthcare Claims Platform - Simplified Claims Processing Service
Basic claims processing service without Redis dependency for testing.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime
import uuid
import logging
import random

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Pydantic Models
class ClaimCreate(BaseModel):
    patient_id: str
    provider_id: str
    diagnosis_code: str
    procedure_code: str
    amount: float
    service_date: str

class ClaimResponse(BaseModel):
    id: str
    patient_id: str
    provider_id: str
    diagnosis_code: str
    procedure_code: str
    amount: float
    status: str
    created_at: str
    processed_at: Optional[str] = None

# In-memory storage for testing
claims_db = {
    "claim1": {
        "id": "claim1",
        "patient_id": "patient123",
        "provider_id": "prov1",
        "diagnosis_code": "Z00.00",
        "procedure_code": "99213",
        "amount": 150.00,
        "status": "approved",
        "created_at": "2024-01-15T10:00:00Z",
        "processed_at": "2024-01-15T11:30:00Z"
    },
    "claim2": {
        "id": "claim2",
        "patient_id": "patient456",
        "provider_id": "prov2",
        "diagnosis_code": "M79.3",
        "procedure_code": "99214",
        "amount": 200.00,
        "status": "pending",
        "created_at": "2024-02-20T14:30:00Z",
        "processed_at": None
    }
}

# FastAPI app
app = FastAPI(
    title="Healthcare Claims Platform - Claims Processing Service",
    description="Simplified claims processing service for testing",
    version="1.0.0"
)

# Add middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def process_claim(claim: Dict[str, Any]) -> str:
    """Simulate claim processing logic"""
    # Simple processing simulation
    if claim["amount"] > 1000:
        return "review_required"
    elif random.random() < 0.1:  # 10% chance of denial
        return "denied"
    else:
        return "approved"

@app.post("/claims", response_model=ClaimResponse)
async def create_claim(claim: ClaimCreate):
    """Create and process new claim"""
    try:
        claim_id = str(uuid.uuid4())
        
        claim_record = {
            "id": claim_id,
            "patient_id": claim.patient_id,
            "provider_id": claim.provider_id,
            "diagnosis_code": claim.diagnosis_code,
            "procedure_code": claim.procedure_code,
            "amount": claim.amount,
            "status": "pending",
            "created_at": datetime.utcnow().isoformat(),
            "processed_at": None
        }
        
        # Process the claim
        status = process_claim(claim_record)
        claim_record["status"] = status
        
        if status != "pending":
            claim_record["processed_at"] = datetime.utcnow().isoformat()
        
        claims_db[claim_id] = claim_record
        logger.info(f"Claim created and processed: {claim_id} - Status: {status}")
        
        return ClaimResponse(**claim_record)
        
    except Exception as e:
        logger.error(f"Failed to create claim: {e}")
        raise HTTPException(status_code=500, detail="Failed to create claim")

@app.get("/claims/{claim_id}", response_model=ClaimResponse)
async def get_claim(claim_id: str):
    """Get claim by ID"""
    try:
        claim = claims_db.get(claim_id)
        if not claim:
            raise HTTPException(status_code=404, detail="Claim not found")
        
        return ClaimResponse(**claim)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get claim: {e}")
        raise HTTPException(status_code=500, detail="Failed to get claim")

@app.get("/claims")
async def list_claims(limit: int = 100, offset: int = 0, status: Optional[str] = None, provider_id: Optional[str] = None):
    """List claims"""
    try:
        claims = list(claims_db.values())
        
        # Filter by status if specified
        if status:
            claims = [c for c in claims if c["status"] == status]
        
        # Filter by provider if specified
        if provider_id:
            claims = [c for c in claims if c["provider_id"] == provider_id]
        
        claims.sort(key=lambda x: x["created_at"], reverse=True)
        
        return {
            "claims": claims[offset:offset+limit],
            "total": len(claims),
            "limit": limit,
            "offset": offset
        }
        
    except Exception as e:
        logger.error(f"Failed to list claims: {e}")
        raise HTTPException(status_code=500, detail="Failed to list claims")

@app.post("/claims/{claim_id}/reprocess")
async def reprocess_claim(claim_id: str):
    """Reprocess a claim"""
    try:
        claim = claims_db.get(claim_id)
        if not claim:
            raise HTTPException(status_code=404, detail="Claim not found")
        
        # Reprocess the claim
        status = process_claim(claim)
        claim["status"] = status
        claim["processed_at"] = datetime.utcnow().isoformat()
        
        claims_db[claim_id] = claim
        logger.info(f"Claim reprocessed: {claim_id} - New status: {status}")
        
        return {"message": "Claim reprocessed successfully", "claim_id": claim_id, "status": status}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to reprocess claim: {e}")
        raise HTTPException(status_code=500, detail="Failed to reprocess claim")

@app.get("/claims/stats/summary")
async def get_claims_summary():
    """Get claims processing summary"""
    try:
        claims = list(claims_db.values())
        
        total_claims = len(claims)
        approved_claims = len([c for c in claims if c["status"] == "approved"])
        denied_claims = len([c for c in claims if c["status"] == "denied"])
        pending_claims = len([c for c in claims if c["status"] == "pending"])
        review_claims = len([c for c in claims if c["status"] == "review_required"])
        
        total_amount = sum(c["amount"] for c in claims)
        approved_amount = sum(c["amount"] for c in claims if c["status"] == "approved")
        
        return {
            "total_claims": total_claims,
            "approved_claims": approved_claims,
            "denied_claims": denied_claims,
            "pending_claims": pending_claims,
            "review_required_claims": review_claims,
            "total_amount": total_amount,
            "approved_amount": approved_amount,
            "approval_rate": round(approved_claims / total_claims * 100, 2) if total_claims > 0 else 0,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Failed to get claims summary: {e}")
        raise HTTPException(status_code=500, detail="Failed to get claims summary")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "service": "claims-processing-service",
        "version": "1.0.0",
        "claims_count": len(claims_db)
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8005)
