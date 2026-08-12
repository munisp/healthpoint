#!/usr/bin/env python3
"""
Healthcare Claims Platform - Simplified KYB Verification Service
Basic KYB verification service without external dependencies for testing.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from typing import List, Optional, Dict, Any
from datetime import datetime
import uuid
import logging
import random

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Pydantic Models
class BusinessInfo(BaseModel):
    business_name: str
    tax_id: str
    address: str
    city: str
    state: str
    zip_code: str
    country: str = "US"
    business_type: str
    contact_email: EmailStr
    contact_phone: str

class VerificationRequest(BaseModel):
    business_info: BusinessInfo
    verification_type: str = "full"  # basic, standard, full

class VerificationResponse(BaseModel):
    verification_id: str
    status: str
    risk_score: float
    verification_results: Dict[str, Any]

# In-memory storage for testing
verifications_db = {}

# FastAPI app
app = FastAPI(
    title="Healthcare Claims Platform - KYB Verification Service",
    description="Simplified KYB verification service for testing",
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

def simulate_verification(business_info: BusinessInfo) -> Dict[str, Any]:
    """Simulate business verification process"""
    # Simulate verification results
    results = {
        "business_registry_check": {
            "status": "verified" if random.random() > 0.1 else "pending",
            "confidence": round(random.uniform(0.8, 1.0), 2)
        },
        "tax_id_verification": {
            "status": "verified" if random.random() > 0.05 else "failed",
            "confidence": round(random.uniform(0.85, 1.0), 2)
        },
        "address_verification": {
            "status": "verified" if random.random() > 0.15 else "partial",
            "confidence": round(random.uniform(0.7, 0.95), 2)
        },
        "sanctions_screening": {
            "status": "clear" if random.random() > 0.02 else "flagged",
            "confidence": round(random.uniform(0.95, 1.0), 2)
        },
        "pep_screening": {
            "status": "clear" if random.random() > 0.01 else "flagged",
            "confidence": round(random.uniform(0.98, 1.0), 2)
        }
    }
    
    return results

def calculate_risk_score(verification_results: Dict[str, Any]) -> float:
    """Calculate risk score based on verification results"""
    base_score = 0.5
    
    for check, result in verification_results.items():
        if result["status"] in ["verified", "clear"]:
            base_score -= 0.1
        elif result["status"] in ["flagged", "failed"]:
            base_score += 0.2
        else:  # pending, partial
            base_score += 0.05
    
    return max(0.0, min(1.0, base_score))

@app.post("/verify", response_model=VerificationResponse)
async def verify_business(request: VerificationRequest):
    """Verify business information"""
    try:
        verification_id = str(uuid.uuid4())
        
        # Simulate verification process
        verification_results = simulate_verification(request.business_info)
        risk_score = calculate_risk_score(verification_results)
        
        # Determine overall status
        failed_checks = [k for k, v in verification_results.items() 
                        if v["status"] in ["failed", "flagged"]]
        
        if failed_checks:
            status = "failed"
        elif any(v["status"] == "pending" for v in verification_results.values()):
            status = "pending"
        else:
            status = "verified"
        
        verification_record = {
            "verification_id": verification_id,
            "business_info": request.business_info.dict(),
            "verification_type": request.verification_type,
            "status": status,
            "risk_score": risk_score,
            "verification_results": verification_results,
            "created_at": datetime.utcnow().isoformat(),
            "completed_at": datetime.utcnow().isoformat() if status != "pending" else None
        }
        
        verifications_db[verification_id] = verification_record
        
        logger.info(f"Business verification completed: {verification_id} - Status: {status}")
        
        return VerificationResponse(
            verification_id=verification_id,
            status=status,
            risk_score=risk_score,
            verification_results=verification_results
        )
        
    except Exception as e:
        logger.error(f"Failed to verify business: {e}")
        raise HTTPException(status_code=500, detail="Failed to verify business")

@app.get("/verification/{verification_id}")
async def get_verification(verification_id: str):
    """Get verification by ID"""
    try:
        verification = verifications_db.get(verification_id)
        if not verification:
            raise HTTPException(status_code=404, detail="Verification not found")
        
        return verification
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get verification: {e}")
        raise HTTPException(status_code=500, detail="Failed to get verification")

@app.get("/verifications")
async def list_verifications(limit: int = 100, offset: int = 0):
    """List verifications"""
    try:
        verifications = list(verifications_db.values())
        verifications.sort(key=lambda x: x["created_at"], reverse=True)
        
        return {
            "verifications": verifications[offset:offset+limit],
            "total": len(verifications),
            "limit": limit,
            "offset": offset
        }
        
    except Exception as e:
        logger.error(f"Failed to list verifications: {e}")
        raise HTTPException(status_code=500, detail="Failed to list verifications")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "service": "kyb-verification-service",
        "version": "1.0.0",
        "verifications_count": len(verifications_db)
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8011)
