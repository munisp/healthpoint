#!/usr/bin/env python3
"""
Healthcare Claims Platform - Simplified Document Verification Service
Basic document verification service without OCR dependencies for testing.
"""

from fastapi import FastAPI, HTTPException, UploadFile, File
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
class DocumentVerificationRequest(BaseModel):
    document_type: str
    provider_id: str
    metadata: Optional[Dict[str, Any]] = None

class DocumentVerificationResponse(BaseModel):
    verification_id: str
    document_type: str
    status: str
    confidence: float
    extracted_data: Dict[str, Any]
    validation_results: Dict[str, Any]

class DocumentStatus(BaseModel):
    id: str
    document_type: str
    status: str
    uploaded_at: str
    verified_at: Optional[str] = None

# In-memory storage for testing
document_verifications = {}

# Document types and their expected fields
DOCUMENT_TYPES = {
    "medical_license": ["license_number", "expiration_date", "issuing_state", "provider_name"],
    "insurance_certificate": ["policy_number", "coverage_amount", "effective_date", "expiration_date"],
    "tax_document": ["tax_id", "business_name", "tax_year", "filing_status"],
    "identity_document": ["document_number", "full_name", "date_of_birth", "expiration_date"],
    "business_registration": ["registration_number", "business_name", "registration_date", "business_type"]
}

# FastAPI app
app = FastAPI(
    title="Healthcare Claims Platform - Document Verification Service",
    description="Simplified document verification service for testing",
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

def simulate_ocr_extraction(document_type: str, file_content: bytes) -> Dict[str, Any]:
    """Simulate OCR data extraction"""
    if document_type not in DOCUMENT_TYPES:
        return {}
    
    expected_fields = DOCUMENT_TYPES[document_type]
    extracted_data = {}
    
    # Simulate extracted data based on document type
    if document_type == "medical_license":
        extracted_data = {
            "license_number": f"MD{random.randint(100000, 999999)}",
            "expiration_date": "2025-12-31",
            "issuing_state": random.choice(["CA", "NY", "TX", "FL"]),
            "provider_name": f"Dr. {random.choice(['Smith', 'Johnson', 'Williams', 'Brown'])}"
        }
    elif document_type == "insurance_certificate":
        extracted_data = {
            "policy_number": f"INS{random.randint(1000000, 9999999)}",
            "coverage_amount": f"${random.randint(1, 10)}M",
            "effective_date": "2024-01-01",
            "expiration_date": "2024-12-31"
        }
    elif document_type == "tax_document":
        extracted_data = {
            "tax_id": f"{random.randint(10, 99)}-{random.randint(1000000, 9999999)}",
            "business_name": f"{random.choice(['MedCorp', 'HealthCare', 'Regional'])} {random.choice(['LLC', 'Inc', 'Corp'])}",
            "tax_year": "2023",
            "filing_status": "Active"
        }
    
    # Add confidence scores for each field
    for field in extracted_data:
        extracted_data[f"{field}_confidence"] = round(random.uniform(0.8, 0.98), 2)
    
    return extracted_data

def validate_document_data(document_type: str, extracted_data: Dict[str, Any]) -> Dict[str, Any]:
    """Validate extracted document data"""
    validation_results = {
        "overall_valid": True,
        "field_validations": {},
        "anomalies": []
    }
    
    expected_fields = DOCUMENT_TYPES.get(document_type, [])
    
    for field in expected_fields:
        if field in extracted_data:
            # Simulate field validation
            is_valid = random.random() > 0.1  # 90% chance of being valid
            confidence = extracted_data.get(f"{field}_confidence", 0.9)
            
            validation_results["field_validations"][field] = {
                "valid": is_valid,
                "confidence": confidence,
                "value": extracted_data[field]
            }
            
            if not is_valid:
                validation_results["overall_valid"] = False
                validation_results["anomalies"].append(f"Invalid {field}: {extracted_data[field]}")
        else:
            validation_results["field_validations"][field] = {
                "valid": False,
                "confidence": 0.0,
                "value": None
            }
            validation_results["overall_valid"] = False
            validation_results["anomalies"].append(f"Missing required field: {field}")
    
    # Additional anomaly checks
    if random.random() < 0.05:  # 5% chance of quality issues
        validation_results["anomalies"].append("Document quality concerns detected")
    
    if random.random() < 0.02:  # 2% chance of tampering detection
        validation_results["anomalies"].append("Potential document tampering detected")
        validation_results["overall_valid"] = False
    
    return validation_results

@app.post("/verify", response_model=DocumentVerificationResponse)
async def verify_document(
    document_type: str,
    provider_id: str,
    file: UploadFile = File(...)
):
    """Verify uploaded document"""
    try:
        verification_id = str(uuid.uuid4())
        
        # Read file content
        file_content = await file.read()
        
        # Simulate OCR extraction
        extracted_data = simulate_ocr_extraction(document_type, file_content)
        
        # Validate extracted data
        validation_results = validate_document_data(document_type, extracted_data)
        
        # Determine overall status
        if validation_results["overall_valid"]:
            status = "verified"
        elif len(validation_results["anomalies"]) > 2:
            status = "rejected"
        else:
            status = "review_required"
        
        # Calculate overall confidence
        field_confidences = [
            v.get("confidence", 0) for v in validation_results["field_validations"].values()
        ]
        overall_confidence = sum(field_confidences) / len(field_confidences) if field_confidences else 0
        
        # Store verification record
        verification_record = {
            "verification_id": verification_id,
            "document_type": document_type,
            "provider_id": provider_id,
            "filename": file.filename,
            "file_size": len(file_content),
            "status": status,
            "confidence": round(overall_confidence, 3),
            "extracted_data": extracted_data,
            "validation_results": validation_results,
            "created_at": datetime.utcnow().isoformat(),
            "verified_at": datetime.utcnow().isoformat() if status == "verified" else None
        }
        
        document_verifications[verification_id] = verification_record
        
        logger.info(f"Document verification completed: {verification_id} - Status: {status}")
        
        return DocumentVerificationResponse(
            verification_id=verification_id,
            document_type=document_type,
            status=status,
            confidence=overall_confidence,
            extracted_data=extracted_data,
            validation_results=validation_results
        )
        
    except Exception as e:
        logger.error(f"Document verification failed: {e}")
        raise HTTPException(status_code=500, detail="Document verification failed")

@app.get("/verification/{verification_id}")
async def get_verification(verification_id: str):
    """Get verification by ID"""
    try:
        verification = document_verifications.get(verification_id)
        if not verification:
            raise HTTPException(status_code=404, detail="Verification not found")
        
        return verification
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get verification: {e}")
        raise HTTPException(status_code=500, detail="Failed to get verification")

@app.get("/verifications")
async def list_verifications(
    limit: int = 100, 
    offset: int = 0, 
    provider_id: Optional[str] = None,
    status: Optional[str] = None
):
    """List document verifications"""
    try:
        verifications = list(document_verifications.values())
        
        # Filter by provider if specified
        if provider_id:
            verifications = [v for v in verifications if v["provider_id"] == provider_id]
        
        # Filter by status if specified
        if status:
            verifications = [v for v in verifications if v["status"] == status]
        
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

@app.get("/stats")
async def get_verification_stats():
    """Get document verification statistics"""
    try:
        verifications = list(document_verifications.values())
        
        total_verifications = len(verifications)
        verified_count = len([v for v in verifications if v["status"] == "verified"])
        rejected_count = len([v for v in verifications if v["status"] == "rejected"])
        review_count = len([v for v in verifications if v["status"] == "review_required"])
        
        # Document type distribution
        type_distribution = {}
        for v in verifications:
            doc_type = v["document_type"]
            type_distribution[doc_type] = type_distribution.get(doc_type, 0) + 1
        
        avg_confidence = sum(v["confidence"] for v in verifications) / total_verifications if total_verifications > 0 else 0
        
        return {
            "total_verifications": total_verifications,
            "verified_documents": verified_count,
            "rejected_documents": rejected_count,
            "documents_under_review": review_count,
            "verification_rate": round(verified_count / total_verifications * 100, 2) if total_verifications > 0 else 0,
            "average_confidence": round(avg_confidence, 3),
            "document_type_distribution": type_distribution,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Failed to get verification stats: {e}")
        raise HTTPException(status_code=500, detail="Failed to get verification stats")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "service": "document-verification-service",
        "version": "1.0.0",
        "verifications_count": len(document_verifications),
        "supported_document_types": list(DOCUMENT_TYPES.keys())
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8010)
