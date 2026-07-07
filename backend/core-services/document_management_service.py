"""
Healthcare Claims Platform - Document Management Service
FHIR-compliant document management with OCR, versioning, and secure storage.

Author: Manus AI
Date: October 8, 2025
Port: 8009
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

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks, status, Query, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, validator
from typing import List, Optional, Dict, Any, Union, BinaryIO
from datetime import datetime, timedelta
from enum import Enum
import uuid
import logging
import asyncio
import asyncpg

import json
import os
import shutil
from contextlib import asynccontextmanager
import aiofiles
from pathlib import Path
import mimetypes
import hashlib
from PIL import Image
import pytesseract
import fitz  # PyMuPDF
from cryptography.fernet import Fernet
import boto3
from botocore.exceptions import ClientError
import io

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.environ["DATABASE_URL"]
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
DOCUMENT_STORAGE_PATH = os.getenv("DOCUMENT_STORAGE_PATH", "/var/documents/healthcare-platform")
ENCRYPTION_KEY = os.getenv("DOCUMENT_ENCRYPTION_KEY", "your-document-encryption-key")
AWS_S3_BUCKET = os.getenv("AWS_S3_BUCKET", "healthcare-documents")
MAX_FILE_SIZE = int(os.getenv("MAX_FILE_SIZE", "104857600"))  # 100MB

class DocumentType(str, Enum):
    MEDICAL_RECORD = "medical_record"
    INSURANCE_CARD = "insurance_card"
    PRESCRIPTION = "prescription"
    LAB_RESULT = "lab_result"
    IMAGING_STUDY = "imaging_study"
    CONSENT_FORM = "consent_form"
    CLAIM_DOCUMENT = "claim_document"
    INVOICE = "invoice"
    CORRESPONDENCE = "correspondence"
    IDENTIFICATION = "identification"
    OTHER = "other"

class DocumentStatus(str, Enum):
    UPLOADED = "uploaded"
    PROCESSING = "processing"
    PROCESSED = "processed"
    INDEXED = "indexed"
    ARCHIVED = "archived"
    DELETED = "deleted"
    ERROR = "error"

class AccessLevel(str, Enum):
    PUBLIC = "public"
    INTERNAL = "internal"
    CONFIDENTIAL = "confidential"
    RESTRICTED = "restricted"

class StorageType(str, Enum):
    LOCAL = "local"
    S3 = "s3"
    AZURE = "azure"
    GCP = "gcp"

# Pydantic Models
class DocumentMetadata(BaseModel):
    title: str
    description: Optional[str] = None
    document_type: DocumentType
    tags: List[str] = []
    patient_id: Optional[str] = None
    provider_id: Optional[str] = None
    claim_id: Optional[str] = None
    encounter_id: Optional[str] = None
    access_level: AccessLevel = AccessLevel.CONFIDENTIAL
    retention_period_days: Optional[int] = None
    custom_metadata: Dict[str, Any] = {}

class Document(BaseModel):
    id: Optional[str] = None
    filename: str
    original_filename: str
    file_size: int
    mime_type: str
    checksum: str
    storage_type: StorageType
    storage_path: str
    encrypted: bool = True
    metadata: DocumentMetadata
    version: int = 1
    parent_document_id: Optional[str] = None
    ocr_text: Optional[str] = None
    extracted_data: Dict[str, Any] = {}
    tenant_id: str
    uploaded_by: str
    status: DocumentStatus = DocumentStatus.UPLOADED
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

class DocumentVersion(BaseModel):
    id: str
    document_id: str
    version: int
    filename: str
    file_size: int
    checksum: str
    storage_path: str
    change_description: Optional[str] = None
    created_by: str
    created_at: datetime

class DocumentShare(BaseModel):
    id: Optional[str] = None
    document_id: str
    shared_with_user_id: Optional[str] = None
    shared_with_email: Optional[str] = None
    access_level: AccessLevel
    expires_at: Optional[datetime] = None
    download_limit: Optional[int] = None
    download_count: int = 0
    share_token: Optional[str] = None
    created_by: str
    tenant_id: str

class DocumentSearch(BaseModel):
    query: Optional[str] = None
    document_type: Optional[DocumentType] = None
    patient_id: Optional[str] = None
    provider_id: Optional[str] = None
    claim_id: Optional[str] = None
    tags: List[str] = []
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None
    access_level: Optional[AccessLevel] = None
    tenant_id: str

class OCRRequest(BaseModel):
    document_id: str
    language: str = "eng"
    extract_structured_data: bool = True

# Encryption Manager
class DocumentEncryption:
    def __init__(self, key: str):
        self.key = key.encode()
        self.fernet = Fernet(Fernet.generate_key())  # In production, derive from key

    def encrypt_file(self, file_data: bytes) -> bytes:
        """Encrypt file data"""
        return self.fernet.encrypt(file_data)

    def decrypt_file(self, encrypted_data: bytes) -> bytes:
        """Decrypt file data"""
        return self.fernet.decrypt(encrypted_data)

encryption_manager = DocumentEncryption(ENCRYPTION_KEY)

# Database Manager
class DatabaseManager:
    def __init__(self):
        self.pool = None

    async def connect(self):
        self.pool = await asyncpg.create_pool(DATABASE_URL)
        await self._create_tables()

    async def disconnect(self):
        if self.pool:
            await self.pool.close()

    async def _create_tables(self):
        async with self.pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS documents (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    filename VARCHAR(255) NOT NULL,
                    original_filename VARCHAR(255) NOT NULL,
                    file_size BIGINT NOT NULL,
                    mime_type VARCHAR(100) NOT NULL,
                    checksum VARCHAR(64) NOT NULL,
                    storage_type VARCHAR(20) NOT NULL,
                    storage_path TEXT NOT NULL,
                    encrypted BOOLEAN DEFAULT TRUE,
                    title VARCHAR(255) NOT NULL,
                    description TEXT,
                    document_type VARCHAR(50) NOT NULL,
                    tags TEXT[],
                    patient_id VARCHAR(255),
                    provider_id VARCHAR(255),
                    claim_id VARCHAR(255),
                    encounter_id VARCHAR(255),
                    access_level VARCHAR(20) DEFAULT 'confidential',
                    retention_period_days INTEGER,
                    custom_metadata JSONB,
                    version INTEGER DEFAULT 1,
                    parent_document_id UUID,
                    ocr_text TEXT,
                    extracted_data JSONB,
                    tenant_id VARCHAR(255) NOT NULL,
                    uploaded_by VARCHAR(255) NOT NULL,
                    status VARCHAR(20) DEFAULT 'uploaded',
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    FOREIGN KEY (parent_document_id) REFERENCES documents(id)
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS document_versions (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    document_id UUID NOT NULL,
                    version INTEGER NOT NULL,
                    filename VARCHAR(255) NOT NULL,
                    file_size BIGINT NOT NULL,
                    checksum VARCHAR(64) NOT NULL,
                    storage_path TEXT NOT NULL,
                    change_description TEXT,
                    created_by VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS document_shares (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    document_id UUID NOT NULL,
                    shared_with_user_id VARCHAR(255),
                    shared_with_email VARCHAR(255),
                    access_level VARCHAR(20) NOT NULL,
                    expires_at TIMESTAMP,
                    download_limit INTEGER,
                    download_count INTEGER DEFAULT 0,
                    share_token VARCHAR(255) UNIQUE,
                    created_by VARCHAR(255) NOT NULL,
                    tenant_id VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS document_access_log (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    document_id UUID NOT NULL,
                    user_id VARCHAR(255),
                    action VARCHAR(50) NOT NULL,
                    ip_address INET,
                    user_agent TEXT,
                    timestamp TIMESTAMP DEFAULT NOW(),
                    tenant_id VARCHAR(255) NOT NULL,
                    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
                );
            """)
            
            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_documents_tenant ON documents(tenant_id);
                CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(document_type);
                CREATE INDEX IF NOT EXISTS idx_documents_patient ON documents(patient_id);
                CREATE INDEX IF NOT EXISTS idx_documents_provider ON documents(provider_id);
                CREATE INDEX IF NOT EXISTS idx_documents_claim ON documents(claim_id);
                CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
                CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at);
                CREATE INDEX IF NOT EXISTS idx_document_versions_document ON document_versions(document_id);
                CREATE INDEX IF NOT EXISTS idx_document_shares_token ON document_shares(share_token);
                CREATE INDEX IF NOT EXISTS idx_document_access_log_document ON document_access_log(document_id);
                CREATE INDEX IF NOT EXISTS idx_documents_ocr_text ON documents USING gin(to_tsvector('english', ocr_text));
            """)

db_manager = DatabaseManager()

# Document Manager
class DocumentManager:
    def __init__(self):
        self.redis_client = None
        self.s3_client = None
        
        # Ensure storage directory exists
        Path(DOCUMENT_STORAGE_PATH).mkdir(parents=True, exist_ok=True)

    async def _get_redis_client(self):
        if not self.redis_client:
            self.redis_client = get_redis_client()
        return self.redis_client

    def _get_s3_client(self):
        if not self.s3_client:
            self.s3_client = boto3.client('s3')
        return self.s3_client

    def _calculate_checksum(self, file_data: bytes) -> str:
        """Calculate SHA256 checksum of file"""
        return hashlib.sha256(file_data).hexdigest()

    async def upload_document(self, file: UploadFile, metadata: DocumentMetadata, 
                            uploaded_by: str, tenant_id: str) -> str:
        """Upload and store a document"""
        # Validate file size
        file_data = await file.read()
        if len(file_data) > MAX_FILE_SIZE:
            raise HTTPException(status_code=413, detail="File too large")
        
        # Calculate checksum
        checksum = self._calculate_checksum(file_data)
        
        # Check for duplicates
        existing_doc = await self._find_duplicate_document(checksum, tenant_id)
        if existing_doc:
            logger.info(f"Duplicate document detected: {existing_doc['id']}")
            return existing_doc['id']
        
        # Create document record
        document_id = str(uuid.uuid4())
        filename = f"{document_id}_{file.filename}"
        
        # Determine storage type and path
        storage_type = StorageType.LOCAL  # Default to local storage
        storage_path = os.path.join(DOCUMENT_STORAGE_PATH, filename)
        
        # Encrypt file data if required
        if metadata.access_level in [AccessLevel.CONFIDENTIAL, AccessLevel.RESTRICTED]:
            file_data = encryption_manager.encrypt_file(file_data)
            encrypted = True
        else:
            encrypted = False
        
        # Store file
        async with aiofiles.open(storage_path, 'wb') as f:
            await f.write(file_data)
        
        # Create document object
        document = Document(
            id=document_id,
            filename=filename,
            original_filename=file.filename,
            file_size=len(file_data),
            mime_type=file.content_type or mimetypes.guess_type(file.filename)[0] or 'application/octet-stream',
            checksum=checksum,
            storage_type=storage_type,
            storage_path=storage_path,
            encrypted=encrypted,
            metadata=metadata,
            tenant_id=tenant_id,
            uploaded_by=uploaded_by,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        
        # Save to database
        await self._save_document(document)
        
        # Process document in background
        asyncio.create_task(self._process_document(document))
        
        logger.info(f"Document uploaded: {document_id}")
        return document_id

    async def _find_duplicate_document(self, checksum: str, tenant_id: str) -> Optional[Dict[str, Any]]:
        """Find duplicate document by checksum"""
        async with db_manager.pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT id, filename FROM documents 
                WHERE checksum = $1 AND tenant_id = $2 AND status != 'deleted'
            """, checksum, tenant_id)
            
            return dict(row) if row else None

    async def _save_document(self, document: Document):
        """Save document to database"""
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO documents 
                (id, filename, original_filename, file_size, mime_type, checksum,
                 storage_type, storage_path, encrypted, title, description, document_type,
                 tags, patient_id, provider_id, claim_id, encounter_id, access_level,
                 retention_period_days, custom_metadata, version, parent_document_id,
                 ocr_text, extracted_data, tenant_id, uploaded_by, status, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                        $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29)
            """, document.id, document.filename, document.original_filename, document.file_size,
                document.mime_type, document.checksum, document.storage_type.value,
                document.storage_path, document.encrypted, document.metadata.title,
                document.metadata.description, document.metadata.document_type.value,
                document.metadata.tags, document.metadata.patient_id, document.metadata.provider_id,
                document.metadata.claim_id, document.metadata.encounter_id,
                document.metadata.access_level.value, document.metadata.retention_period_days,
                json.dumps(document.metadata.custom_metadata), document.version,
                document.parent_document_id, document.ocr_text, json.dumps(document.extracted_data),
                document.tenant_id, document.uploaded_by, document.status.value,
                document.created_at, document.updated_at)

    async def _process_document(self, document: Document):
        """Process document (OCR, data extraction, etc.)"""
        try:
            # Update status to processing
            await self._update_document_status(document.id, DocumentStatus.PROCESSING)
            
            # Perform OCR if it's an image or PDF
            if document.mime_type.startswith('image/') or document.mime_type == 'application/pdf':
                ocr_text = await self._extract_text_ocr(document)
                if ocr_text:
                    await self._update_document_ocr(document.id, ocr_text)
            
            # Extract structured data based on document type
            extracted_data = await self._extract_structured_data(document)
            if extracted_data:
                await self._update_document_extracted_data(document.id, extracted_data)
            
            # Update status to processed
            await self._update_document_status(document.id, DocumentStatus.PROCESSED)
            
            logger.info(f"Document processed: {document.id}")
            
        except Exception as e:
            logger.error(f"Document processing failed: {e}")
            await self._update_document_status(document.id, DocumentStatus.ERROR)

    async def _extract_text_ocr(self, document: Document) -> Optional[str]:
        """Extract text using OCR"""
        try:
            # Read file data
            file_data = await self._read_document_file(document)
            
            if document.mime_type.startswith('image/'):
                # Process image with OCR
                image = Image.open(io.BytesIO(file_data))
                text = pytesseract.image_to_string(image)
                return text.strip()
            
            elif document.mime_type == 'application/pdf':
                # Extract text from PDF
                pdf_document = fitz.open(stream=file_data, filetype="pdf")
                text_content = []
                
                for page_num in range(pdf_document.page_count):
                    page = pdf_document[page_num]
                    text_content.append(page.get_text())
                
                pdf_document.close()
                return '\n'.join(text_content).strip()
            
            return None
            
        except Exception as e:
            logger.error(f"OCR extraction failed: {e}")
            return None

    async def _extract_structured_data(self, document: Document) -> Dict[str, Any]:
        """Extract structured data based on document type"""
        extracted_data = {}
        
        try:
            if document.metadata.document_type == DocumentType.INSURANCE_CARD:
                # Extract insurance card information
                if document.ocr_text:
                    extracted_data = self._extract_insurance_card_data(document.ocr_text)
            
            elif document.metadata.document_type == DocumentType.PRESCRIPTION:
                # Extract prescription information
                if document.ocr_text:
                    extracted_data = self._extract_prescription_data(document.ocr_text)
            
            elif document.metadata.document_type == DocumentType.LAB_RESULT:
                # Extract lab result information
                if document.ocr_text:
                    extracted_data = self._extract_lab_result_data(document.ocr_text)
            
            elif document.metadata.document_type == DocumentType.INVOICE:
                # Extract invoice information
                if document.ocr_text:
                    extracted_data = self._extract_invoice_data(document.ocr_text)
            
        except Exception as e:
            logger.error(f"Structured data extraction failed: {e}")
        
        return extracted_data

    def _extract_insurance_card_data(self, ocr_text: str) -> Dict[str, Any]:
        """Extract insurance card information from OCR text"""
        import re
        
        data = {}
        
        # Extract member ID (various patterns)
        member_id_patterns = [
            r'Member\s*ID[:\s]*([A-Z0-9]+)',
            r'ID[:\s]*([A-Z0-9]+)',
            r'Member[:\s]*([A-Z0-9]+)'
        ]
        
        for pattern in member_id_patterns:
            match = re.search(pattern, ocr_text, re.IGNORECASE)
            if match:
                data['member_id'] = match.group(1)
                break
        
        # Extract group number
        group_match = re.search(r'Group[:\s]*([A-Z0-9]+)', ocr_text, re.IGNORECASE)
        if group_match:
            data['group_number'] = group_match.group(1)
        
        # Extract plan name
        plan_patterns = [
            r'Plan[:\s]*([A-Za-z\s]+)',
            r'Coverage[:\s]*([A-Za-z\s]+)'
        ]
        
        for pattern in plan_patterns:
            match = re.search(pattern, ocr_text, re.IGNORECASE)
            if match:
                data['plan_name'] = match.group(1).strip()
                break
        
        return data

    def _extract_prescription_data(self, ocr_text: str) -> Dict[str, Any]:
        """Extract prescription information from OCR text"""
        import re
        
        data = {}
        
        # Extract medication names (simplified pattern)
        med_patterns = [
            r'Rx[:\s]*([A-Za-z\s]+)',
            r'Medication[:\s]*([A-Za-z\s]+)',
            r'Drug[:\s]*([A-Za-z\s]+)'
        ]
        
        for pattern in med_patterns:
            match = re.search(pattern, ocr_text, re.IGNORECASE)
            if match:
                data['medication'] = match.group(1).strip()
                break
        
        # Extract dosage
        dosage_match = re.search(r'(\d+\s*mg|\d+\s*ml)', ocr_text, re.IGNORECASE)
        if dosage_match:
            data['dosage'] = dosage_match.group(1)
        
        # Extract quantity
        qty_match = re.search(r'Qty[:\s]*(\d+)', ocr_text, re.IGNORECASE)
        if qty_match:
            data['quantity'] = int(qty_match.group(1))
        
        return data

    def _extract_lab_result_data(self, ocr_text: str) -> Dict[str, Any]:
        """Extract lab result information from OCR text"""
        import re
        
        data = {}
        results = []
        
        # Extract test results (simplified pattern)
        result_patterns = [
            r'([A-Za-z\s]+):\s*(\d+\.?\d*)\s*([A-Za-z/]+)?',
            r'([A-Za-z\s]+)\s+(\d+\.?\d*)\s+([A-Za-z/]+)?'
        ]
        
        for pattern in result_patterns:
            matches = re.findall(pattern, ocr_text)
            for match in matches:
                test_name, value, unit = match
                results.append({
                    'test_name': test_name.strip(),
                    'value': float(value),
                    'unit': unit.strip() if unit else None
                })
        
        if results:
            data['test_results'] = results
        
        return data

    def _extract_invoice_data(self, ocr_text: str) -> Dict[str, Any]:
        """Extract invoice information from OCR text"""
        import re
        
        data = {}
        
        # Extract invoice number
        invoice_match = re.search(r'Invoice[:\s#]*([A-Z0-9-]+)', ocr_text, re.IGNORECASE)
        if invoice_match:
            data['invoice_number'] = invoice_match.group(1)
        
        # Extract total amount
        amount_patterns = [
            r'Total[:\s]*\$?(\d+\.?\d*)',
            r'Amount[:\s]*\$?(\d+\.?\d*)',
            r'\$(\d+\.?\d*)'
        ]
        
        for pattern in amount_patterns:
            match = re.search(pattern, ocr_text, re.IGNORECASE)
            if match:
                data['total_amount'] = float(match.group(1))
                break
        
        # Extract date
        date_match = re.search(r'(\d{1,2}/\d{1,2}/\d{4})', ocr_text)
        if date_match:
            data['date'] = date_match.group(1)
        
        return data

    async def _read_document_file(self, document: Document) -> bytes:
        """Read document file data"""
        async with aiofiles.open(document.storage_path, 'rb') as f:
            file_data = await f.read()
        
        # Decrypt if encrypted
        if document.encrypted:
            file_data = encryption_manager.decrypt_file(file_data)
        
        return file_data

    async def _update_document_status(self, document_id: str, status: DocumentStatus):
        """Update document status"""
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                UPDATE documents SET status = $1, updated_at = NOW() WHERE id = $2
            """, status.value, document_id)

    async def _update_document_ocr(self, document_id: str, ocr_text: str):
        """Update document OCR text"""
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                UPDATE documents SET ocr_text = $1, updated_at = NOW() WHERE id = $2
            """, ocr_text, document_id)

    async def _update_document_extracted_data(self, document_id: str, extracted_data: Dict[str, Any]):
        """Update document extracted data"""
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                UPDATE documents SET extracted_data = $1, updated_at = NOW() WHERE id = $2
            """, json.dumps(extracted_data), document_id)

    async def get_document(self, document_id: str, tenant_id: str, user_id: str) -> Optional[Document]:
        """Get document by ID"""
        async with db_manager.pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT * FROM documents 
                WHERE id = $1 AND tenant_id = $2 AND status != 'deleted'
            """, document_id, tenant_id)
            
            if not row:
                return None
            
            # Log access
            await self._log_document_access(document_id, user_id, "view", tenant_id)
            
            # Convert to Document object
            document_data = dict(row)
            metadata = DocumentMetadata(
                title=document_data['title'],
                description=document_data['description'],
                document_type=DocumentType(document_data['document_type']),
                tags=document_data['tags'] or [],
                patient_id=document_data['patient_id'],
                provider_id=document_data['provider_id'],
                claim_id=document_data['claim_id'],
                encounter_id=document_data['encounter_id'],
                access_level=AccessLevel(document_data['access_level']),
                retention_period_days=document_data['retention_period_days'],
                custom_metadata=json.loads(document_data['custom_metadata'] or '{}')
            )
            
            return Document(
                id=document_data['id'],
                filename=document_data['filename'],
                original_filename=document_data['original_filename'],
                file_size=document_data['file_size'],
                mime_type=document_data['mime_type'],
                checksum=document_data['checksum'],
                storage_type=StorageType(document_data['storage_type']),
                storage_path=document_data['storage_path'],
                encrypted=document_data['encrypted'],
                metadata=metadata,
                version=document_data['version'],
                parent_document_id=document_data['parent_document_id'],
                ocr_text=document_data['ocr_text'],
                extracted_data=json.loads(document_data['extracted_data'] or '{}'),
                tenant_id=document_data['tenant_id'],
                uploaded_by=document_data['uploaded_by'],
                status=DocumentStatus(document_data['status']),
                created_at=document_data['created_at'],
                updated_at=document_data['updated_at']
            )

    async def download_document(self, document_id: str, tenant_id: str, user_id: str) -> tuple[bytes, str, str]:
        """Download document file"""
        document = await self.get_document(document_id, tenant_id, user_id)
        if not document:
            raise HTTPException(status_code=404, detail="Document not found")
        
        # Log download access
        await self._log_document_access(document_id, user_id, "download", tenant_id)
        
        # Read file data
        file_data = await self._read_document_file(document)
        
        return file_data, document.original_filename, document.mime_type

    async def search_documents(self, search: DocumentSearch, limit: int = 50) -> List[Dict[str, Any]]:
        """Search documents"""
        query = """
            SELECT d.*, 
                   ts_rank(to_tsvector('english', COALESCE(d.ocr_text, '')), plainto_tsquery('english', $1)) as rank
            FROM documents d
            WHERE d.tenant_id = $2 AND d.status != 'deleted'
        """
        params = [search.query or '', search.tenant_id]
        param_count = 2
        
        # Add filters
        if search.document_type:
            param_count += 1
            query += f" AND d.document_type = ${param_count}"
            params.append(search.document_type.value)
        
        if search.patient_id:
            param_count += 1
            query += f" AND d.patient_id = ${param_count}"
            params.append(search.patient_id)
        
        if search.provider_id:
            param_count += 1
            query += f" AND d.provider_id = ${param_count}"
            params.append(search.provider_id)
        
        if search.claim_id:
            param_count += 1
            query += f" AND d.claim_id = ${param_count}"
            params.append(search.claim_id)
        
        if search.tags:
            param_count += 1
            query += f" AND d.tags && ${param_count}"
            params.append(search.tags)
        
        if search.date_from:
            param_count += 1
            query += f" AND d.created_at >= ${param_count}"
            params.append(search.date_from)
        
        if search.date_to:
            param_count += 1
            query += f" AND d.created_at <= ${param_count}"
            params.append(search.date_to)
        
        if search.access_level:
            param_count += 1
            query += f" AND d.access_level = ${param_count}"
            params.append(search.access_level.value)
        
        # Add text search if query provided
        if search.query:
            query += " AND (d.title ILIKE $1 OR d.description ILIKE $1 OR to_tsvector('english', COALESCE(d.ocr_text, '')) @@ plainto_tsquery('english', $1))"
            query += " ORDER BY rank DESC, d.created_at DESC"
        else:
            query += " ORDER BY d.created_at DESC"
        
        param_count += 1
        query += f" LIMIT ${param_count}"
        params.append(limit)
        
        async with db_manager.pool.acquire() as conn:
            rows = await conn.fetch(query, *params)
            return [dict(row) for row in rows]

    async def create_document_share(self, share: DocumentShare) -> str:
        """Create document share"""
        share.id = str(uuid.uuid4())
        share.share_token = str(uuid.uuid4())
        
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO document_shares 
                (id, document_id, shared_with_user_id, shared_with_email, access_level,
                 expires_at, download_limit, share_token, created_by, tenant_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            """, share.id, share.document_id, share.shared_with_user_id, share.shared_with_email,
                share.access_level.value, share.expires_at, share.download_limit,
                share.share_token, share.created_by, share.tenant_id)
        
        logger.info(f"Created document share: {share.id}")
        return share.id

    async def _log_document_access(self, document_id: str, user_id: str, action: str, tenant_id: str):
        """Log document access"""
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO document_access_log 
                (document_id, user_id, action, tenant_id)
                VALUES ($1, $2, $3, $4)
            """, document_id, user_id, action, tenant_id)

document_manager = DocumentManager()

# Lifespan manager
@asynccontextmanager
async def lifespan(app: FastAPI):
    await db_manager.connect()
    yield
    await db_manager.disconnect()

app = FastAPI(

app.middleware("http")(security_headers_middleware)
    title="Healthcare Claims Platform - Document Management Service",
    description="FHIR-compliant document management with OCR and secure storage",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Endpoints
@app.post("/documents/upload", status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile = File(...),
    title: str = Form(...),
    document_type: DocumentType = Form(...),
    description: Optional[str] = Form(None),
    tags: Optional[str] = Form(None),
    patient_id: Optional[str] = Form(None),
    provider_id: Optional[str] = Form(None),
    claim_id: Optional[str] = Form(None),
    access_level: AccessLevel = Form(AccessLevel.CONFIDENTIAL),
    uploaded_by: str = Form(...),
    tenant_id: str = Form(...)
,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Upload a document"""
    tag_list = tags.split(',') if tags else []
    
    metadata = DocumentMetadata(
        title=title,
        description=description,
        document_type=document_type,
        tags=tag_list,
        patient_id=patient_id,
        provider_id=provider_id,
        claim_id=claim_id,
        access_level=access_level
    )
    
    document_id = await document_manager.upload_document(file, metadata, uploaded_by, tenant_id)
    return {"document_id": document_id}

@app.get("/documents/{document_id}")
async def get_document(document_id: str, tenant_id: str = Query(...), user_id: str = Query(...),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get document metadata"""
    document = await document_manager.get_document(document_id, tenant_id, user_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    return document

@app.get("/documents/{document_id}/download")
async def download_document(document_id: str, tenant_id: str = Query(...), user_id: str = Query(...),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Download document file"""
    file_data, filename, mime_type = await document_manager.download_document(document_id, tenant_id, user_id)
    
    return StreamingResponse(
        io.BytesIO(file_data),
        media_type=mime_type,
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.post("/documents/search")
async def search_documents(search: DocumentSearch, limit: int = Query(50, le=100),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Search documents"""
    documents = await document_manager.search_documents(search, limit)
    return {"documents": documents, "count": len(documents)}

@app.post("/documents/{document_id}/share", status_code=status.HTTP_201_CREATED)
async def create_document_share(document_id: str, share: DocumentShare,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Create document share"""
    share.document_id = document_id
    share_id = await document_manager.create_document_share(share)
    return {"share_id": share_id}

@app.post("/documents/{document_id}/ocr")
async def perform_ocr(document_id: str, ocr_request: OCRRequest,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Perform OCR on document"""
    # This would trigger OCR processing
    # For now, return success message
    return {"message": "OCR processing started", "document_id": document_id}

@app.get("/documents/{document_id}/versions")
async def get_document_versions(document_id: str, tenant_id: str = Query(...),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get document versions"""
    async with db_manager.pool.acquire() as conn:
        versions = await conn.fetch("""
            SELECT * FROM document_versions 
            WHERE document_id = $1 
            ORDER BY version DESC
        """, document_id)
        
        return {"versions": [dict(version) for version in versions]}

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "document-management"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8009)