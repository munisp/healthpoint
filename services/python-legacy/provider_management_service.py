#!/usr/bin/env python3
"""
Healthcare Claims Platform - Provider Management Service
Comprehensive provider onboarding, credentialing, and contract management.

Author: Manus AI
Date: October 5, 2025
"""

from fastapi import FastAPI, HTTPException, Depends, status, UploadFile, File
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr, validator
from typing import List, Optional, Dict, Any
from datetime import datetime, date, timedelta
import uuid
import logging
from enum import Enum
import asyncio
import asyncpg
import os
import json
from contextlib import asynccontextmanager
import aiofiles

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost/healthcare_platform")
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/tmp/uploads")
JWT_SECRET = os.getenv("JWT_SECRET", "your-secret-key-change-in-production")

# Security
security = HTTPBearer()

class ProviderType(str, Enum):
    INDIVIDUAL = "individual"
    GROUP = "group"
    FACILITY = "facility"
    HOSPITAL = "hospital"
    CLINIC = "clinic"
    LABORATORY = "laboratory"
    PHARMACY = "pharmacy"

class ProviderStatus(str, Enum):
    PENDING = "pending"
    UNDER_REVIEW = "under_review"
    CREDENTIALING = "credentialing"
    APPROVED = "approved"
    SUSPENDED = "suspended"
    TERMINATED = "terminated"

class ContractStatus(str, Enum):
    DRAFT = "draft"
    PENDING_SIGNATURE = "pending_signature"
    ACTIVE = "active"
    EXPIRED = "expired"
    TERMINATED = "terminated"

class DocumentType(str, Enum):
    LICENSE = "license"
    CERTIFICATION = "certification"
    INSURANCE = "insurance"
    TAX_ID = "tax_id"
    NPI_VERIFICATION = "npi_verification"
    HOSPITAL_PRIVILEGES = "hospital_privileges"
    EDUCATION_VERIFICATION = "education_verification"
    REFERENCE = "reference"
    CONTRACT = "contract"
    OTHER = "other"

class CredentialingStatus(str, Enum):
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    PENDING_VERIFICATION = "pending_verification"
    COMPLETED = "completed"
    FAILED = "failed"
    EXPIRED = "expired"

# Pydantic Models
class AddressBase(BaseModel):
    street1: str
    street2: Optional[str] = None
    city: str
    state: str
    zip_code: str
    country: str = "US"

class ContactBase(BaseModel):
    first_name: str
    last_name: str
    title: Optional[str] = None
    email: EmailStr
    phone: str
    is_primary: bool = False

class ProviderBase(BaseModel):
    name: str
    provider_type: ProviderType
    npi: str
    tax_id: str
    email: EmailStr
    phone: str
    website: Optional[str] = None
    specialty: Optional[str] = None
    sub_specialty: Optional[str] = None
    license_number: Optional[str] = None
    license_state: Optional[str] = None
    license_expiry: Optional[date] = None

class ProviderCreate(ProviderBase):
    tenant_id: str
    address: AddressBase
    contacts: List[ContactBase] = []

class ProviderUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    specialty: Optional[str] = None
    sub_specialty: Optional[str] = None
    license_number: Optional[str] = None
    license_state: Optional[str] = None
    license_expiry: Optional[date] = None
    status: Optional[ProviderStatus] = None

class ProviderResponse(ProviderBase):
    id: str
    tenant_id: str
    status: ProviderStatus
    credentialing_status: CredentialingStatus
    created_at: datetime
    updated_at: datetime
    address: AddressBase
    contacts: List[ContactBase]
    documents_count: int
    contracts_count: int

class DocumentBase(BaseModel):
    name: str
    document_type: DocumentType
    description: Optional[str] = None
    expiry_date: Optional[date] = None
    is_required: bool = True

class DocumentCreate(DocumentBase):
    provider_id: str

class DocumentResponse(DocumentBase):
    id: str
    provider_id: str
    file_path: str
    file_size: int
    uploaded_at: datetime
    verified: bool = False
    verified_at: Optional[datetime] = None
    verified_by: Optional[str] = None

class ContractBase(BaseModel):
    name: str
    contract_type: str
    effective_date: date
    expiry_date: Optional[date] = None
    terms: Dict[str, Any] = {}

class ContractCreate(ContractBase):
    provider_id: str

class ContractResponse(ContractBase):
    id: str
    provider_id: str
    status: ContractStatus
    created_at: datetime
    updated_at: datetime
    signed_at: Optional[datetime] = None

class CredentialingChecklistItem(BaseModel):
    item: str
    required: bool
    completed: bool
    completed_at: Optional[datetime] = None
    notes: Optional[str] = None

class CredentialingResponse(BaseModel):
    provider_id: str
    status: CredentialingStatus
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    checklist: List[CredentialingChecklistItem]
    notes: Optional[str] = None

# Database connection management
class DatabaseManager:
    def __init__(self):
        self.pool = None
    
    async def connect(self):
        """Initialize database connections"""
        try:
            self.pool = await asyncpg.create_pool(DATABASE_URL)
            logger.info("Database connection established")
        except Exception as e:
            logger.error(f"Failed to connect to database: {e}")
            raise
    
    async def disconnect(self):
        """Close database connections"""
        if self.pool:
            await self.pool.close()
        logger.info("Database connection closed")

db_manager = DatabaseManager()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await db_manager.connect()
    await initialize_database()
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    yield
    # Shutdown
    await db_manager.disconnect()

# FastAPI app
app = FastAPI(
    title="Healthcare Claims Platform - Provider Management Service",
    description="Comprehensive provider onboarding, credentialing, and contract management",
    version="1.0.0",
    lifespan=lifespan
)

async def initialize_database():
    """Initialize database tables"""
    async with db_manager.pool.acquire() as conn:
        # Create providers table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS providers (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id UUID NOT NULL,
                name VARCHAR(255) NOT NULL,
                provider_type VARCHAR(50) NOT NULL,
                npi VARCHAR(20) UNIQUE NOT NULL,
                tax_id VARCHAR(50) NOT NULL,
                email VARCHAR(255) NOT NULL,
                phone VARCHAR(50) NOT NULL,
                website VARCHAR(255),
                specialty VARCHAR(255),
                sub_specialty VARCHAR(255),
                license_number VARCHAR(100),
                license_state VARCHAR(10),
                license_expiry DATE,
                status VARCHAR(50) DEFAULT 'pending',
                credentialing_status VARCHAR(50) DEFAULT 'not_started',
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        # Create provider addresses table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS provider_addresses (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
                street1 VARCHAR(255) NOT NULL,
                street2 VARCHAR(255),
                city VARCHAR(100) NOT NULL,
                state VARCHAR(10) NOT NULL,
                zip_code VARCHAR(20) NOT NULL,
                country VARCHAR(10) DEFAULT 'US',
                is_primary BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        # Create provider contacts table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS provider_contacts (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
                first_name VARCHAR(100) NOT NULL,
                last_name VARCHAR(100) NOT NULL,
                title VARCHAR(100),
                email VARCHAR(255) NOT NULL,
                phone VARCHAR(50) NOT NULL,
                is_primary BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        # Create provider documents table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS provider_documents (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
                name VARCHAR(255) NOT NULL,
                document_type VARCHAR(50) NOT NULL,
                description TEXT,
                file_path VARCHAR(500) NOT NULL,
                file_size INTEGER NOT NULL,
                expiry_date DATE,
                is_required BOOLEAN DEFAULT true,
                verified BOOLEAN DEFAULT false,
                verified_at TIMESTAMP,
                verified_by UUID,
                uploaded_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        # Create provider contracts table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS provider_contracts (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
                name VARCHAR(255) NOT NULL,
                contract_type VARCHAR(100) NOT NULL,
                effective_date DATE NOT NULL,
                expiry_date DATE,
                status VARCHAR(50) DEFAULT 'draft',
                terms JSONB DEFAULT '{}',
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                signed_at TIMESTAMP
            )
        """)
        
        # Create credentialing checklist table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS credentialing_checklist (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
                item VARCHAR(255) NOT NULL,
                required BOOLEAN DEFAULT true,
                completed BOOLEAN DEFAULT false,
                completed_at TIMESTAMP,
                notes TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        logger.info("Provider management database tables initialized")

# Utility functions
async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """Get current user from JWT token (simplified for demo)"""
    # In production, this would validate JWT and return user info
    return {
        "id": "user-123",
        "tenant_id": "tenant-123",
        "role": "tenant_admin"
    }

async def create_default_credentialing_checklist(provider_id: str):
    """Create default credentialing checklist for a provider"""
    default_items = [
        {"item": "NPI Verification", "required": True},
        {"item": "License Verification", "required": True},
        {"item": "DEA Verification", "required": False},
        {"item": "Board Certification", "required": True},
        {"item": "Education Verification", "required": True},
        {"item": "Work History Verification", "required": True},
        {"item": "Professional References", "required": True},
        {"item": "Hospital Privileges Verification", "required": False},
        {"item": "Malpractice Insurance", "required": True},
        {"item": "Background Check", "required": True},
        {"item": "OIG/SAM Check", "required": True},
        {"item": "State Sanctions Check", "required": True}
    ]
    
    async with db_manager.pool.acquire() as conn:
        for item in default_items:
            await conn.execute("""
                INSERT INTO credentialing_checklist (provider_id, item, required)
                VALUES ($1, $2, $3)
            """, provider_id, item["item"], item["required"])

# API Endpoints

@app.post("/providers", response_model=ProviderResponse)
async def create_provider(provider_data: ProviderCreate, current_user: dict = Depends(get_current_user)):
    """Create a new provider"""
    async with db_manager.pool.acquire() as conn:
        # Check if NPI already exists
        existing = await conn.fetchrow("SELECT id FROM providers WHERE npi = $1", provider_data.npi)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Provider with this NPI already exists"
            )
        
        # Create provider
        provider_id = await conn.fetchval("""
            INSERT INTO providers (
                tenant_id, name, provider_type, npi, tax_id, email, phone, 
                website, specialty, sub_specialty, license_number, license_state, license_expiry
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING id
        """, provider_data.tenant_id, provider_data.name, provider_data.provider_type.value,
            provider_data.npi, provider_data.tax_id, provider_data.email, provider_data.phone,
            provider_data.website, provider_data.specialty, provider_data.sub_specialty,
            provider_data.license_number, provider_data.license_state, provider_data.license_expiry)
        
        # Create address
        await conn.execute("""
            INSERT INTO provider_addresses (
                provider_id, street1, street2, city, state, zip_code, country
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        """, provider_id, provider_data.address.street1, provider_data.address.street2,
            provider_data.address.city, provider_data.address.state, 
            provider_data.address.zip_code, provider_data.address.country)
        
        # Create contacts
        for contact in provider_data.contacts:
            await conn.execute("""
                INSERT INTO provider_contacts (
                    provider_id, first_name, last_name, title, email, phone, is_primary
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            """, provider_id, contact.first_name, contact.last_name, contact.title,
                contact.email, contact.phone, contact.is_primary)
        
        # Create default credentialing checklist
        await create_default_credentialing_checklist(str(provider_id))
        
        # Get created provider with related data
        provider = await get_provider_with_details(str(provider_id))
        
        return provider

@app.get("/providers", response_model=List[ProviderResponse])
async def list_providers(
    current_user: dict = Depends(get_current_user),
    skip: int = 0,
    limit: int = 100,
    status: Optional[ProviderStatus] = None,
    provider_type: Optional[ProviderType] = None
):
    """List providers with optional filtering"""
    async with db_manager.pool.acquire() as conn:
        query = "SELECT * FROM providers WHERE tenant_id = $1"
        params = [current_user["tenant_id"]]
        param_count = 2
        
        if status:
            query += f" AND status = ${param_count}"
            params.append(status.value)
            param_count += 1
        
        if provider_type:
            query += f" AND provider_type = ${param_count}"
            params.append(provider_type.value)
            param_count += 1
        
        query += f" ORDER BY created_at DESC LIMIT ${param_count} OFFSET ${param_count + 1}"
        params.extend([limit, skip])
        
        providers = await conn.fetch(query, *params)
        
        result = []
        for provider in providers:
            provider_details = await get_provider_with_details(str(provider["id"]))
            result.append(provider_details)
        
        return result

async def get_provider_with_details(provider_id: str) -> ProviderResponse:
    """Get provider with all related details"""
    async with db_manager.pool.acquire() as conn:
        # Get provider
        provider = await conn.fetchrow("SELECT * FROM providers WHERE id = $1", provider_id)
        if not provider:
            raise HTTPException(status_code=404, detail="Provider not found")
        
        # Get address
        address = await conn.fetchrow(
            "SELECT * FROM provider_addresses WHERE provider_id = $1 AND is_primary = true",
            provider_id
        )
        
        # Get contacts
        contacts = await conn.fetch(
            "SELECT * FROM provider_contacts WHERE provider_id = $1",
            provider_id
        )
        
        # Get document count
        doc_count = await conn.fetchval(
            "SELECT COUNT(*) FROM provider_documents WHERE provider_id = $1",
            provider_id
        )
        
        # Get contract count
        contract_count = await conn.fetchval(
            "SELECT COUNT(*) FROM provider_contracts WHERE provider_id = $1",
            provider_id
        )
        
        return ProviderResponse(
            id=str(provider["id"]),
            tenant_id=str(provider["tenant_id"]),
            name=provider["name"],
            provider_type=ProviderType(provider["provider_type"]),
            npi=provider["npi"],
            tax_id=provider["tax_id"],
            email=provider["email"],
            phone=provider["phone"],
            website=provider["website"],
            specialty=provider["specialty"],
            sub_specialty=provider["sub_specialty"],
            license_number=provider["license_number"],
            license_state=provider["license_state"],
            license_expiry=provider["license_expiry"],
            status=ProviderStatus(provider["status"]),
            credentialing_status=CredentialingStatus(provider["credentialing_status"]),
            created_at=provider["created_at"],
            updated_at=provider["updated_at"],
            address=AddressBase(
                street1=address["street1"],
                street2=address["street2"],
                city=address["city"],
                state=address["state"],
                zip_code=address["zip_code"],
                country=address["country"]
            ) if address else None,
            contacts=[
                ContactBase(
                    first_name=contact["first_name"],
                    last_name=contact["last_name"],
                    title=contact["title"],
                    email=contact["email"],
                    phone=contact["phone"],
                    is_primary=contact["is_primary"]
                )
                for contact in contacts
            ],
            documents_count=doc_count,
            contracts_count=contract_count
        )

@app.get("/providers/{provider_id}", response_model=ProviderResponse)
async def get_provider(provider_id: str, current_user: dict = Depends(get_current_user)):
    """Get a specific provider"""
    return await get_provider_with_details(provider_id)

@app.put("/providers/{provider_id}", response_model=ProviderResponse)
async def update_provider(
    provider_id: str,
    provider_data: ProviderUpdate,
    current_user: dict = Depends(get_current_user)
):
    """Update a provider"""
    async with db_manager.pool.acquire() as conn:
        # Check if provider exists
        existing = await conn.fetchrow(
            "SELECT * FROM providers WHERE id = $1 AND tenant_id = $2",
            provider_id, current_user["tenant_id"]
        )
        
        if not existing:
            raise HTTPException(status_code=404, detail="Provider not found")
        
        # Build update query
        update_fields = []
        update_values = []
        param_count = 1
        
        for field, value in provider_data.dict(exclude_unset=True).items():
            if value is not None:
                if isinstance(value, Enum):
                    value = value.value
                update_fields.append(f"{field} = ${param_count}")
                update_values.append(value)
                param_count += 1
        
        if not update_fields:
            raise HTTPException(status_code=400, detail="No fields to update")
        
        update_fields.append("updated_at = NOW()")
        update_values.extend([provider_id, current_user["tenant_id"]])
        
        query = f"""
            UPDATE providers 
            SET {', '.join(update_fields)}
            WHERE id = ${param_count} AND tenant_id = ${param_count + 1}
        """
        
        await conn.execute(query, *update_values)
        
        return await get_provider_with_details(provider_id)

@app.post("/providers/{provider_id}/documents", response_model=DocumentResponse)
async def upload_document(
    provider_id: str,
    file: UploadFile = File(...),
    document_type: DocumentType = DocumentType.OTHER,
    description: Optional[str] = None,
    expiry_date: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Upload a document for a provider"""
    # Verify provider exists
    async with db_manager.pool.acquire() as conn:
        provider = await conn.fetchrow(
            "SELECT id FROM providers WHERE id = $1 AND tenant_id = $2",
            provider_id, current_user["tenant_id"]
        )
        
        if not provider:
            raise HTTPException(status_code=404, detail="Provider not found")
        
        # Save file
        file_id = str(uuid.uuid4())
        file_extension = file.filename.split('.')[-1] if '.' in file.filename else 'bin'
        file_path = f"{UPLOAD_DIR}/{file_id}.{file_extension}"
        
        async with aiofiles.open(file_path, 'wb') as f:
            content = await file.read()
            await f.write(content)
        
        # Parse expiry date
        parsed_expiry = None
        if expiry_date:
            try:
                parsed_expiry = datetime.strptime(expiry_date, "%Y-%m-%d").date()
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid expiry date format. Use YYYY-MM-DD")
        
        # Save document record
        doc_id = await conn.fetchval("""
            INSERT INTO provider_documents (
                provider_id, name, document_type, description, file_path, 
                file_size, expiry_date
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id
        """, provider_id, file.filename, document_type.value, description,
            file_path, len(content), parsed_expiry)
        
        # Get created document
        document = await conn.fetchrow(
            "SELECT * FROM provider_documents WHERE id = $1",
            doc_id
        )
        
        return DocumentResponse(
            id=str(document["id"]),
            provider_id=str(document["provider_id"]),
            name=document["name"],
            document_type=DocumentType(document["document_type"]),
            description=document["description"],
            file_path=document["file_path"],
            file_size=document["file_size"],
            expiry_date=document["expiry_date"],
            is_required=document["is_required"],
            uploaded_at=document["uploaded_at"],
            verified=document["verified"],
            verified_at=document["verified_at"],
            verified_by=document["verified_by"]
        )

@app.get("/providers/{provider_id}/documents", response_model=List[DocumentResponse])
async def list_provider_documents(
    provider_id: str,
    current_user: dict = Depends(get_current_user)
):
    """List documents for a provider"""
    async with db_manager.pool.acquire() as conn:
        documents = await conn.fetch(
            "SELECT * FROM provider_documents WHERE provider_id = $1 ORDER BY uploaded_at DESC",
            provider_id
        )
        
        return [
            DocumentResponse(
                id=str(doc["id"]),
                provider_id=str(doc["provider_id"]),
                name=doc["name"],
                document_type=DocumentType(doc["document_type"]),
                description=doc["description"],
                file_path=doc["file_path"],
                file_size=doc["file_size"],
                expiry_date=doc["expiry_date"],
                is_required=doc["is_required"],
                uploaded_at=doc["uploaded_at"],
                verified=doc["verified"],
                verified_at=doc["verified_at"],
                verified_by=doc["verified_by"]
            )
            for doc in documents
        ]

@app.get("/providers/{provider_id}/credentialing", response_model=CredentialingResponse)
async def get_credentialing_status(
    provider_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get credentialing status and checklist for a provider"""
    async with db_manager.pool.acquire() as conn:
        # Get provider credentialing status
        provider = await conn.fetchrow(
            "SELECT credentialing_status FROM providers WHERE id = $1 AND tenant_id = $2",
            provider_id, current_user["tenant_id"]
        )
        
        if not provider:
            raise HTTPException(status_code=404, detail="Provider not found")
        
        # Get checklist items
        checklist_items = await conn.fetch(
            "SELECT * FROM credentialing_checklist WHERE provider_id = $1 ORDER BY created_at",
            provider_id
        )
        
        checklist = [
            CredentialingChecklistItem(
                item=item["item"],
                required=item["required"],
                completed=item["completed"],
                completed_at=item["completed_at"],
                notes=item["notes"]
            )
            for item in checklist_items
        ]
        
        return CredentialingResponse(
            provider_id=provider_id,
            status=CredentialingStatus(provider["credentialing_status"]),
            checklist=checklist
        )

@app.put("/providers/{provider_id}/credentialing/{item_id}")
async def update_credentialing_item(
    provider_id: str,
    item_id: str,
    completed: bool,
    notes: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Update a credentialing checklist item"""
    async with db_manager.pool.acquire() as conn:
        # Update checklist item
        await conn.execute("""
            UPDATE credentialing_checklist 
            SET completed = $1, completed_at = $2, notes = $3
            WHERE id = $4 AND provider_id = $5
        """, completed, datetime.utcnow() if completed else None, notes, item_id, provider_id)
        
        # Check if all required items are completed
        incomplete_required = await conn.fetchval("""
            SELECT COUNT(*) FROM credentialing_checklist 
            WHERE provider_id = $1 AND required = true AND completed = false
        """, provider_id)
        
        # Update provider credentialing status
        new_status = CredentialingStatus.COMPLETED if incomplete_required == 0 else CredentialingStatus.IN_PROGRESS
        
        await conn.execute("""
            UPDATE providers 
            SET credentialing_status = $1, updated_at = NOW()
            WHERE id = $2
        """, new_status.value, provider_id)
        
        return {"message": "Credentialing item updated successfully"}

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        async with db_manager.pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        
        return {
            "status": "healthy",
            "timestamp": datetime.utcnow().isoformat(),
            "service": "provider-management-service",
            "version": "1.0.0"
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service unhealthy"
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
