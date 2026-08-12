#!/usr/bin/env python3
"""
Healthcare Claims Platform - Simplified Provider Management Service
Basic provider management service without Redis dependency for testing.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from typing import List, Optional, Dict, Any
from datetime import datetime
import uuid
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Pydantic Models
class ProviderCreate(BaseModel):
    name: str
    npi: str
    tax_id: str
    specialty: str
    email: EmailStr
    phone: str
    address: str
    city: str
    state: str
    zip_code: str

class ProviderResponse(BaseModel):
    id: str
    name: str
    npi: str
    specialty: str
    email: str
    phone: str
    status: str
    created_at: str
    verified_at: Optional[str] = None

class ProviderUpdate(BaseModel):
    name: Optional[str] = None
    specialty: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    status: Optional[str] = None

# In-memory storage for testing
providers_db = {
    "prov1": {
        "id": "prov1",
        "name": "MedCorp Healthcare",
        "npi": "1234567890",
        "tax_id": "12-3456789",
        "specialty": "Internal Medicine",
        "email": "contact@medcorp.com",
        "phone": "(555) 123-4567",
        "address": "123 Medical Center Dr",
        "city": "Healthcare City",
        "state": "CA",
        "zip_code": "90210",
        "status": "verified",
        "created_at": "2024-01-15T10:00:00Z",
        "verified_at": "2024-01-16T15:30:00Z"
    },
    "prov2": {
        "id": "prov2",
        "name": "Regional Medical Group",
        "npi": "0987654321",
        "tax_id": "98-7654321",
        "specialty": "Family Medicine",
        "email": "info@regionalmed.com",
        "phone": "(555) 987-6543",
        "address": "456 Health Plaza",
        "city": "Wellness Town",
        "state": "NY",
        "zip_code": "10001",
        "status": "pending",
        "created_at": "2024-02-20T14:30:00Z",
        "verified_at": None
    }
}

# FastAPI app
app = FastAPI(
    title="Healthcare Claims Platform - Provider Management Service",
    description="Simplified provider management service for testing",
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

@app.post("/providers", response_model=ProviderResponse)
async def create_provider(provider: ProviderCreate):
    """Create new provider"""
    try:
        # Check if provider already exists
        if any(p["npi"] == provider.npi for p in providers_db.values()):
            raise HTTPException(status_code=400, detail="Provider with this NPI already exists")
        
        provider_id = str(uuid.uuid4())
        
        provider_record = {
            "id": provider_id,
            "name": provider.name,
            "npi": provider.npi,
            "tax_id": provider.tax_id,
            "specialty": provider.specialty,
            "email": provider.email,
            "phone": provider.phone,
            "address": provider.address,
            "city": provider.city,
            "state": provider.state,
            "zip_code": provider.zip_code,
            "status": "pending",
            "created_at": datetime.utcnow().isoformat(),
            "verified_at": None
        }
        
        providers_db[provider_id] = provider_record
        logger.info(f"Provider created: {provider_id} - {provider.name}")
        
        return ProviderResponse(**provider_record)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create provider: {e}")
        raise HTTPException(status_code=500, detail="Failed to create provider")

@app.get("/providers/{provider_id}", response_model=ProviderResponse)
async def get_provider(provider_id: str):
    """Get provider by ID"""
    try:
        provider = providers_db.get(provider_id)
        if not provider:
            raise HTTPException(status_code=404, detail="Provider not found")
        
        return ProviderResponse(**provider)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get provider: {e}")
        raise HTTPException(status_code=500, detail="Failed to get provider")

@app.get("/providers")
async def list_providers(limit: int = 100, offset: int = 0, status: Optional[str] = None):
    """List providers"""
    try:
        providers = list(providers_db.values())
        
        # Filter by status if specified
        if status:
            providers = [p for p in providers if p["status"] == status]
        
        providers.sort(key=lambda x: x["created_at"], reverse=True)
        
        return {
            "providers": providers[offset:offset+limit],
            "total": len(providers),
            "limit": limit,
            "offset": offset
        }
        
    except Exception as e:
        logger.error(f"Failed to list providers: {e}")
        raise HTTPException(status_code=500, detail="Failed to list providers")

@app.put("/providers/{provider_id}", response_model=ProviderResponse)
async def update_provider(provider_id: str, provider_update: ProviderUpdate):
    """Update provider"""
    try:
        provider = providers_db.get(provider_id)
        if not provider:
            raise HTTPException(status_code=404, detail="Provider not found")
        
        update_data = provider_update.dict(exclude_unset=True)
        for field, value in update_data.items():
            provider[field] = value
        
        # If status is being set to verified, add verification timestamp
        if update_data.get("status") == "verified" and not provider.get("verified_at"):
            provider["verified_at"] = datetime.utcnow().isoformat()
        
        providers_db[provider_id] = provider
        logger.info(f"Provider updated: {provider_id}")
        
        return ProviderResponse(**provider)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update provider: {e}")
        raise HTTPException(status_code=500, detail="Failed to update provider")

@app.post("/providers/{provider_id}/verify")
async def verify_provider(provider_id: str):
    """Verify provider"""
    try:
        provider = providers_db.get(provider_id)
        if not provider:
            raise HTTPException(status_code=404, detail="Provider not found")
        
        provider["status"] = "verified"
        provider["verified_at"] = datetime.utcnow().isoformat()
        
        providers_db[provider_id] = provider
        logger.info(f"Provider verified: {provider_id}")
        
        return {"message": "Provider verified successfully", "provider_id": provider_id}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to verify provider: {e}")
        raise HTTPException(status_code=500, detail="Failed to verify provider")

@app.delete("/providers/{provider_id}")
async def delete_provider(provider_id: str):
    """Delete provider"""
    try:
        if provider_id not in providers_db:
            raise HTTPException(status_code=404, detail="Provider not found")
        
        del providers_db[provider_id]
        logger.info(f"Provider deleted: {provider_id}")
        
        return {"message": "Provider deleted successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete provider: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete provider")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "service": "provider-management-service",
        "version": "1.0.0",
        "providers_count": len(providers_db)
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
