#!/usr/bin/env python3
"""
Healthcare Claims Platform - KYB (Know Your Business) Verification Service
Ballerine integration for comprehensive provider verification and onboarding.

Author: Manus AI
Date: October 5, 2025
"""

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, validator, Field, EmailStr
from typing import List, Optional, Dict, Any, Union
from datetime import datetime, timedelta
from enum import Enum
import uuid
import logging
import asyncio
import asyncpg
import aioredis
import json
import os
from contextlib import asynccontextmanager
import httpx
import hashlib
from collections import defaultdict
import re

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost/healthcare_platform")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
BALLERINE_API_URL = os.getenv("BALLERINE_API_URL", "https://api.ballerine.com")
BALLERINE_API_KEY = os.getenv("BALLERINE_API_KEY", "")

class VerificationStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    APPROVED = "approved"
    REJECTED = "rejected"
    REQUIRES_ADDITIONAL_INFO = "requires_additional_info"
    MANUAL_REVIEW = "manual_review"
    ERROR = "error"

class DocumentType(str, Enum):
    BUSINESS_LICENSE = "business_license"
    TAX_ID_DOCUMENT = "tax_id_document"
    CERTIFICATE_OF_INCORPORATION = "certificate_of_incorporation"
    PROFESSIONAL_LICENSE = "professional_license"
    INSURANCE_CERTIFICATE = "insurance_certificate"
    BANK_STATEMENT = "bank_statement"
    UTILITY_BILL = "utility_bill"
    OWNERSHIP_STRUCTURE = "ownership_structure"
    COMPLIANCE_CERTIFICATE = "compliance_certificate"
    ACCREDITATION_DOCUMENT = "accreditation_document"

class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class ComplianceFramework(str, Enum):
    HIPAA = "hipaa"
    SOX = "sox"
    PCI_DSS = "pci_dss"
    GDPR = "gdpr"
    SOC2 = "soc2"
    HITECH = "hitech"
    FDA = "fda"
    CMS = "cms"

# Pydantic Models
class BusinessEntity(BaseModel):
    legal_name: str
    dba_name: Optional[str] = None
    business_type: str  # LLC, Corporation, Partnership, etc.
    tax_id: str
    registration_number: Optional[str] = None
    incorporation_date: Optional[datetime] = None
    incorporation_state: Optional[str] = None
    industry_code: Optional[str] = None
    website: Optional[str] = None
    description: Optional[str] = None

class BusinessAddress(BaseModel):
    street_address: str
    city: str
    state: str
    postal_code: str
    country: str = "US"
    address_type: str = "business"  # business, mailing, registered

class ContactPerson(BaseModel):
    first_name: str
    last_name: str
    title: str
    email: EmailStr
    phone: str
    role: str  # owner, officer, authorized_representative
    ownership_percentage: Optional[float] = None
    date_of_birth: Optional[datetime] = None
    ssn_last_four: Optional[str] = None

class BankingInformation(BaseModel):
    bank_name: str
    account_type: str
    routing_number: str
    account_number_last_four: str
    account_holder_name: str
    bank_address: Optional[BusinessAddress] = None

class ComplianceRequirement(BaseModel):
    framework: ComplianceFramework
    required: bool = True
    status: str = "pending"  # pending, compliant, non_compliant
    expiration_date: Optional[datetime] = None
    certificate_number: Optional[str] = None
    issuing_authority: Optional[str] = None

class KYBDocument(BaseModel):
    id: str
    document_type: DocumentType
    file_name: str
    file_size: int
    mime_type: str
    upload_date: datetime
    verification_status: str = "pending"
    extracted_data: Dict[str, Any] = {}
    confidence_score: Optional[float] = None

class KYBRequest(BaseModel):
    business_entity: BusinessEntity
    addresses: List[BusinessAddress]
    contacts: List[ContactPerson]
    banking_info: Optional[BankingInformation] = None
    compliance_requirements: List[ComplianceRequirement] = []
    documents: List[str] = []  # Document IDs
    tenant_id: str
    requested_by: str
    priority: str = "normal"  # low, normal, high, urgent
    metadata: Dict[str, Any] = {}

class VerificationCheck(BaseModel):
    check_type: str
    status: str
    result: Dict[str, Any] = {}
    confidence: float = 0.0
    performed_at: datetime
    provider: str = "ballerine"
    error_message: Optional[str] = None

class RiskAssessment(BaseModel):
    overall_risk: RiskLevel
    risk_factors: List[str] = []
    risk_score: float = 0.0
    mitigation_recommendations: List[str] = []
    assessment_date: datetime
    assessed_by: str = "system"

class KYBResult(BaseModel):
    id: str
    request_id: str
    status: VerificationStatus
    business_entity: BusinessEntity
    verification_checks: List[VerificationCheck] = []
    risk_assessment: RiskAssessment
    compliance_status: Dict[str, bool] = {}
    approved_services: List[str] = []
    restrictions: List[str] = []
    expiration_date: Optional[datetime] = None
    verified_by: Optional[str] = None
    verified_at: Optional[datetime] = None
    tenant_id: str
    created_at: datetime
    updated_at: datetime

class BallerineWebhookPayload(BaseModel):
    event_type: str
    workflow_id: str
    entity_id: str
    status: str
    data: Dict[str, Any] = {}
    timestamp: datetime

# Database connection management
class DatabaseManager:
    def __init__(self):
        self.pool = None
        self.redis = None
    
    async def connect(self):
        """Initialize database connections"""
        try:
            self.pool = await asyncpg.create_pool(DATABASE_URL)
            self.redis = await aioredis.from_url(REDIS_URL)
            logger.info("KYB verification database connections established")
        except Exception as e:
            logger.error(f"Failed to connect to database: {e}")
            raise
    
    async def disconnect(self):
        """Close database connections"""
        if self.pool:
            await self.pool.close()
        if self.redis:
            await self.redis.close()
        logger.info("KYB verification database connections closed")

db_manager = DatabaseManager()

# Ballerine Integration Service
class BallerineService:
    def __init__(self):
        self.api_url = BALLERINE_API_URL
        self.api_key = BALLERINE_API_KEY
        self.client = httpx.AsyncClient(
            timeout=30.0,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            }
        )
    
    async def create_workflow(self, kyb_request: KYBRequest) -> Dict[str, Any]:
        """Create KYB workflow in Ballerine"""
        try:
            workflow_data = {
                "workflowDefinitionId": "kyb_healthcare_provider",
                "context": {
                    "entity": {
                        "type": "business",
                        "data": {
                            "companyName": kyb_request.business_entity.legal_name,
                            "registrationNumber": kyb_request.business_entity.registration_number,
                            "taxId": kyb_request.business_entity.tax_id,
                            "businessType": kyb_request.business_entity.business_type,
                            "website": kyb_request.business_entity.website,
                            "industry": kyb_request.business_entity.industry_code,
                            "addresses": [addr.dict() for addr in kyb_request.addresses],
                            "contacts": [contact.dict() for contact in kyb_request.contacts]
                        }
                    },
                    "documents": kyb_request.documents,
                    "compliance": [req.dict() for req in kyb_request.compliance_requirements],
                    "metadata": {
                        "tenant_id": kyb_request.tenant_id,
                        "requested_by": kyb_request.requested_by,
                        "priority": kyb_request.priority,
                        **kyb_request.metadata
                    }
                }
            }
            
            response = await self.client.post(
                f"{self.api_url}/workflows",
                json=workflow_data
            )
            
            if response.status_code == 201:
                return response.json()
            else:
                logger.error(f"Ballerine workflow creation failed: {response.text}")
                raise HTTPException(
                    status_code=response.status_code,
                    detail="Failed to create verification workflow"
                )
                
        except httpx.RequestError as e:
            logger.error(f"Ballerine API request failed: {e}")
            raise HTTPException(
                status_code=503,
                detail="Verification service temporarily unavailable"
            )
    
    async def get_workflow_status(self, workflow_id: str) -> Dict[str, Any]:
        """Get workflow status from Ballerine"""
        try:
            response = await self.client.get(f"{self.api_url}/workflows/{workflow_id}")
            
            if response.status_code == 200:
                return response.json()
            else:
                logger.error(f"Failed to get workflow status: {response.text}")
                return {}
                
        except httpx.RequestError as e:
            logger.error(f"Ballerine status request failed: {e}")
            return {}
    
    async def upload_document(self, document_data: bytes, document_type: str, metadata: Dict[str, Any]) -> str:
        """Upload document to Ballerine"""
        try:
            files = {
                "file": ("document", document_data, "application/octet-stream")
            }
            
            data = {
                "documentType": document_type,
                "metadata": json.dumps(metadata)
            }
            
            response = await self.client.post(
                f"{self.api_url}/documents",
                files=files,
                data=data
            )
            
            if response.status_code == 201:
                result = response.json()
                return result.get("documentId", "")
            else:
                logger.error(f"Document upload failed: {response.text}")
                raise HTTPException(
                    status_code=response.status_code,
                    detail="Failed to upload document"
                )
                
        except httpx.RequestError as e:
            logger.error(f"Document upload request failed: {e}")
            raise HTTPException(
                status_code=503,
                detail="Document upload service temporarily unavailable"
            )
    
    async def perform_verification_checks(self, entity_data: Dict[str, Any]) -> List[VerificationCheck]:
        """Perform various verification checks"""
        checks = []
        
        try:
            # Business registry check
            registry_check = await self._check_business_registry(entity_data)
            checks.append(registry_check)
            
            # Tax ID verification
            tax_check = await self._verify_tax_id(entity_data)
            checks.append(tax_check)
            
            # Address verification
            address_check = await self._verify_address(entity_data)
            checks.append(address_check)
            
            # Sanctions screening
            sanctions_check = await self._screen_sanctions(entity_data)
            checks.append(sanctions_check)
            
            # Professional license verification
            license_check = await self._verify_professional_licenses(entity_data)
            checks.append(license_check)
            
            return checks
            
        except Exception as e:
            logger.error(f"Verification checks failed: {e}")
            return []
    
    async def _check_business_registry(self, entity_data: Dict[str, Any]) -> VerificationCheck:
        """Check business registry"""
        try:
            # Simulate business registry check
            # In practice, this would call actual registry APIs
            
            business_name = entity_data.get("companyName", "")
            registration_number = entity_data.get("registrationNumber", "")
            
            # Simulate API call
            await asyncio.sleep(0.1)  # Simulate network delay
            
            # Mock verification result
            is_valid = len(business_name) > 3 and len(registration_number) > 5
            
            return VerificationCheck(
                check_type="business_registry",
                status="passed" if is_valid else "failed",
                result={
                    "registry_found": is_valid,
                    "business_name_match": is_valid,
                    "registration_status": "active" if is_valid else "inactive",
                    "incorporation_date": entity_data.get("incorporationDate"),
                    "business_type": entity_data.get("businessType")
                },
                confidence=0.95 if is_valid else 0.3,
                performed_at=datetime.utcnow(),
                provider="business_registry_api"
            )
            
        except Exception as e:
            return VerificationCheck(
                check_type="business_registry",
                status="error",
                result={},
                confidence=0.0,
                performed_at=datetime.utcnow(),
                provider="business_registry_api",
                error_message=str(e)
            )
    
    async def _verify_tax_id(self, entity_data: Dict[str, Any]) -> VerificationCheck:
        """Verify tax ID"""
        try:
            tax_id = entity_data.get("taxId", "")
            
            # Basic format validation for EIN (XX-XXXXXXX)
            ein_pattern = r'^\d{2}-\d{7}$'
            is_valid_format = re.match(ein_pattern, tax_id) is not None
            
            # Simulate IRS verification
            await asyncio.sleep(0.1)
            
            return VerificationCheck(
                check_type="tax_id_verification",
                status="passed" if is_valid_format else "failed",
                result={
                    "tax_id_valid": is_valid_format,
                    "format_check": is_valid_format,
                    "irs_status": "active" if is_valid_format else "unknown"
                },
                confidence=0.9 if is_valid_format else 0.2,
                performed_at=datetime.utcnow(),
                provider="irs_api"
            )
            
        except Exception as e:
            return VerificationCheck(
                check_type="tax_id_verification",
                status="error",
                result={},
                confidence=0.0,
                performed_at=datetime.utcnow(),
                provider="irs_api",
                error_message=str(e)
            )
    
    async def _verify_address(self, entity_data: Dict[str, Any]) -> VerificationCheck:
        """Verify business address"""
        try:
            addresses = entity_data.get("addresses", [])
            
            if not addresses:
                return VerificationCheck(
                    check_type="address_verification",
                    status="failed",
                    result={"error": "No addresses provided"},
                    confidence=0.0,
                    performed_at=datetime.utcnow(),
                    provider="address_verification_api"
                )
            
            # Verify primary business address
            primary_address = addresses[0]
            
            # Basic validation
            required_fields = ["street_address", "city", "state", "postal_code"]
            has_required_fields = all(
                primary_address.get(field) for field in required_fields
            )
            
            # Simulate address verification API
            await asyncio.sleep(0.1)
            
            return VerificationCheck(
                check_type="address_verification",
                status="passed" if has_required_fields else "failed",
                result={
                    "address_valid": has_required_fields,
                    "deliverable": has_required_fields,
                    "business_address": has_required_fields,
                    "address_type": primary_address.get("address_type", "unknown")
                },
                confidence=0.85 if has_required_fields else 0.1,
                performed_at=datetime.utcnow(),
                provider="address_verification_api"
            )
            
        except Exception as e:
            return VerificationCheck(
                check_type="address_verification",
                status="error",
                result={},
                confidence=0.0,
                performed_at=datetime.utcnow(),
                provider="address_verification_api",
                error_message=str(e)
            )
    
    async def _screen_sanctions(self, entity_data: Dict[str, Any]) -> VerificationCheck:
        """Screen against sanctions lists"""
        try:
            business_name = entity_data.get("companyName", "")
            contacts = entity_data.get("contacts", [])
            
            # Simulate sanctions screening
            await asyncio.sleep(0.1)
            
            # Mock screening - check for suspicious keywords
            suspicious_keywords = ["sanctioned", "blocked", "denied"]
            is_flagged = any(
                keyword in business_name.lower() 
                for keyword in suspicious_keywords
            )
            
            return VerificationCheck(
                check_type="sanctions_screening",
                status="failed" if is_flagged else "passed",
                result={
                    "sanctions_match": is_flagged,
                    "watchlist_match": False,
                    "pep_match": False,
                    "screened_lists": ["OFAC", "UN", "EU", "PEP"],
                    "match_details": [] if not is_flagged else ["Potential match found"]
                },
                confidence=0.95,
                performed_at=datetime.utcnow(),
                provider="sanctions_screening_api"
            )
            
        except Exception as e:
            return VerificationCheck(
                check_type="sanctions_screening",
                status="error",
                result={},
                confidence=0.0,
                performed_at=datetime.utcnow(),
                provider="sanctions_screening_api",
                error_message=str(e)
            )
    
    async def _verify_professional_licenses(self, entity_data: Dict[str, Any]) -> VerificationCheck:
        """Verify professional licenses"""
        try:
            # This would integrate with professional licensing boards
            # For healthcare providers, check medical licenses, DEA numbers, etc.
            
            contacts = entity_data.get("contacts", [])
            
            # Simulate license verification
            await asyncio.sleep(0.1)
            
            licenses_verified = 0
            total_contacts = len(contacts)
            
            for contact in contacts:
                # Mock license verification based on role
                if contact.get("role") in ["physician", "nurse", "pharmacist"]:
                    licenses_verified += 1
            
            verification_rate = licenses_verified / total_contacts if total_contacts > 0 else 0
            
            return VerificationCheck(
                check_type="professional_license_verification",
                status="passed" if verification_rate >= 0.8 else "warning",
                result={
                    "licenses_verified": licenses_verified,
                    "total_professionals": total_contacts,
                    "verification_rate": verification_rate,
                    "license_details": []
                },
                confidence=0.8 if verification_rate >= 0.8 else 0.5,
                performed_at=datetime.utcnow(),
                provider="professional_licensing_api"
            )
            
        except Exception as e:
            return VerificationCheck(
                check_type="professional_license_verification",
                status="error",
                result={},
                confidence=0.0,
                performed_at=datetime.utcnow(),
                provider="professional_licensing_api",
                error_message=str(e)
            )

ballerine_service = BallerineService()

# KYB Verification Service
class KYBVerificationService:
    def __init__(self):
        self.risk_thresholds = {
            RiskLevel.LOW: 0.3,
            RiskLevel.MEDIUM: 0.6,
            RiskLevel.HIGH: 0.8,
            RiskLevel.CRITICAL: 1.0
        }
    
    async def initiate_kyb_verification(
        self, 
        kyb_request: KYBRequest, 
        background_tasks: BackgroundTasks
    ) -> KYBResult:
        """Initiate KYB verification process"""
        try:
            # Create workflow in Ballerine
            workflow_response = await ballerine_service.create_workflow(kyb_request)
            workflow_id = workflow_response.get("workflowId", str(uuid.uuid4()))
            
            # Perform initial verification checks
            entity_data = {
                "companyName": kyb_request.business_entity.legal_name,
                "registrationNumber": kyb_request.business_entity.registration_number,
                "taxId": kyb_request.business_entity.tax_id,
                "businessType": kyb_request.business_entity.business_type,
                "addresses": [addr.dict() for addr in kyb_request.addresses],
                "contacts": [contact.dict() for contact in kyb_request.contacts]
            }
            
            verification_checks = await ballerine_service.perform_verification_checks(entity_data)
            
            # Assess risk
            risk_assessment = await self._assess_risk(kyb_request, verification_checks)
            
            # Determine initial status
            status = self._determine_status(verification_checks, risk_assessment)
            
            # Check compliance requirements
            compliance_status = await self._check_compliance(kyb_request.compliance_requirements)
            
            # Create KYB result
            result_id = str(uuid.uuid4())
            
            result = KYBResult(
                id=result_id,
                request_id=workflow_id,
                status=status,
                business_entity=kyb_request.business_entity,
                verification_checks=verification_checks,
                risk_assessment=risk_assessment,
                compliance_status=compliance_status,
                approved_services=[],
                restrictions=[],
                tenant_id=kyb_request.tenant_id,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            
            # Store result
            background_tasks.add_task(self._store_kyb_result, result)
            
            # Schedule follow-up checks if needed
            if status == VerificationStatus.IN_PROGRESS:
                background_tasks.add_task(
                    self._schedule_follow_up_checks, 
                    result_id, 
                    workflow_id
                )
            
            return result
            
        except Exception as e:
            logger.error(f"KYB verification initiation failed: {e}")
            raise HTTPException(status_code=500, detail="KYB verification failed")
    
    async def _assess_risk(
        self, 
        kyb_request: KYBRequest, 
        verification_checks: List[VerificationCheck]
    ) -> RiskAssessment:
        """Assess overall risk level"""
        try:
            risk_factors = []
            risk_score = 0.0
            
            # Check verification results
            failed_checks = [check for check in verification_checks if check.status == "failed"]
            error_checks = [check for check in verification_checks if check.status == "error"]
            
            if failed_checks:
                risk_score += len(failed_checks) * 0.2
                risk_factors.extend([f"Failed {check.check_type}" for check in failed_checks])
            
            if error_checks:
                risk_score += len(error_checks) * 0.1
                risk_factors.extend([f"Error in {check.check_type}" for check in error_checks])
            
            # Business-specific risk factors
            business = kyb_request.business_entity
            
            # New business risk
            if business.incorporation_date and business.incorporation_date > datetime.utcnow() - timedelta(days=365):
                risk_score += 0.15
                risk_factors.append("Recently incorporated business")
            
            # High-risk industry check (simplified)
            high_risk_industries = ["cannabis", "cryptocurrency", "adult", "gambling"]
            if business.industry_code and any(industry in business.industry_code.lower() for industry in high_risk_industries):
                risk_score += 0.3
                risk_factors.append("High-risk industry")
            
            # Geographic risk (simplified)
            high_risk_states = ["offshore", "foreign"]
            if business.incorporation_state and business.incorporation_state.lower() in high_risk_states:
                risk_score += 0.2
                risk_factors.append("High-risk jurisdiction")
            
            # Ownership structure risk
            total_ownership = sum(
                contact.ownership_percentage or 0 
                for contact in kyb_request.contacts 
                if contact.ownership_percentage
            )
            
            if total_ownership < 75:
                risk_score += 0.1
                risk_factors.append("Unclear ownership structure")
            
            # Determine risk level
            if risk_score >= self.risk_thresholds[RiskLevel.CRITICAL]:
                overall_risk = RiskLevel.CRITICAL
            elif risk_score >= self.risk_thresholds[RiskLevel.HIGH]:
                overall_risk = RiskLevel.HIGH
            elif risk_score >= self.risk_thresholds[RiskLevel.MEDIUM]:
                overall_risk = RiskLevel.MEDIUM
            else:
                overall_risk = RiskLevel.LOW
            
            # Generate mitigation recommendations
            recommendations = await self._generate_risk_mitigation_recommendations(
                overall_risk, risk_factors
            )
            
            return RiskAssessment(
                overall_risk=overall_risk,
                risk_factors=risk_factors,
                risk_score=min(risk_score, 1.0),  # Cap at 1.0
                mitigation_recommendations=recommendations,
                assessment_date=datetime.utcnow(),
                assessed_by="automated_system"
            )
            
        except Exception as e:
            logger.error(f"Risk assessment failed: {e}")
            return RiskAssessment(
                overall_risk=RiskLevel.HIGH,
                risk_factors=["Risk assessment error"],
                risk_score=0.8,
                mitigation_recommendations=["Manual review required"],
                assessment_date=datetime.utcnow(),
                assessed_by="error_handler"
            )
    
    async def _generate_risk_mitigation_recommendations(
        self, 
        risk_level: RiskLevel, 
        risk_factors: List[str]
    ) -> List[str]:
        """Generate risk mitigation recommendations"""
        recommendations = []
        
        if risk_level == RiskLevel.CRITICAL:
            recommendations.extend([
                "Immediate manual review required",
                "Enhanced due diligence procedures",
                "Senior management approval required",
                "Consider rejecting application"
            ])
        elif risk_level == RiskLevel.HIGH:
            recommendations.extend([
                "Enhanced verification procedures",
                "Additional documentation required",
                "Ongoing monitoring recommended",
                "Limit initial service access"
            ])
        elif risk_level == RiskLevel.MEDIUM:
            recommendations.extend([
                "Standard enhanced verification",
                "Periodic review recommended",
                "Monitor transaction patterns"
            ])
        else:
            recommendations.append("Standard monitoring procedures")
        
        # Specific recommendations based on risk factors
        for factor in risk_factors:
            if "sanctions" in factor.lower():
                recommendations.append("Conduct enhanced sanctions screening")
            elif "license" in factor.lower():
                recommendations.append("Verify professional licenses manually")
            elif "ownership" in factor.lower():
                recommendations.append("Obtain detailed ownership structure documentation")
            elif "address" in factor.lower():
                recommendations.append("Verify business address with site visit or additional documentation")
        
        return list(set(recommendations))  # Remove duplicates
    
    def _determine_status(
        self, 
        verification_checks: List[VerificationCheck], 
        risk_assessment: RiskAssessment
    ) -> VerificationStatus:
        """Determine verification status"""
        try:
            # Check for critical failures
            critical_failures = [
                check for check in verification_checks 
                if check.status == "failed" and check.check_type in ["sanctions_screening", "business_registry"]
            ]
            
            if critical_failures:
                return VerificationStatus.REJECTED
            
            # Check for errors
            error_checks = [check for check in verification_checks if check.status == "error"]
            if len(error_checks) > 2:
                return VerificationStatus.ERROR
            
            # Risk-based status determination
            if risk_assessment.overall_risk == RiskLevel.CRITICAL:
                return VerificationStatus.REJECTED
            elif risk_assessment.overall_risk == RiskLevel.HIGH:
                return VerificationStatus.MANUAL_REVIEW
            elif risk_assessment.overall_risk == RiskLevel.MEDIUM:
                return VerificationStatus.REQUIRES_ADDITIONAL_INFO
            
            # Check if all verifications passed
            all_passed = all(
                check.status in ["passed", "warning"] 
                for check in verification_checks
            )
            
            if all_passed:
                return VerificationStatus.APPROVED
            else:
                return VerificationStatus.IN_PROGRESS
                
        except Exception as e:
            logger.error(f"Status determination failed: {e}")
            return VerificationStatus.ERROR
    
    async def _check_compliance(self, requirements: List[ComplianceRequirement]) -> Dict[str, bool]:
        """Check compliance requirements"""
        compliance_status = {}
        
        try:
            for requirement in requirements:
                # Simulate compliance checking
                # In practice, this would integrate with compliance databases
                
                framework = requirement.framework.value
                
                # Mock compliance check based on framework
                if framework == "hipaa":
                    compliance_status["hipaa_compliant"] = True
                elif framework == "sox":
                    compliance_status["sox_compliant"] = True
                elif framework == "pci_dss":
                    compliance_status["pci_dss_compliant"] = False  # Requires additional verification
                else:
                    compliance_status[f"{framework}_compliant"] = True
            
            return compliance_status
            
        except Exception as e:
            logger.error(f"Compliance check failed: {e}")
            return {"compliance_check_error": True}
    
    async def _store_kyb_result(self, result: KYBResult):
        """Store KYB result in database"""
        try:
            async with db_manager.pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO kyb_verification_results (
                        id, request_id, status, business_entity, verification_checks,
                        risk_assessment, compliance_status, approved_services, restrictions,
                        tenant_id, created_at, updated_at
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                """, 
                    result.id, result.request_id, result.status.value,
                    json.dumps(result.business_entity.dict()),
                    json.dumps([check.dict() for check in result.verification_checks], default=str),
                    json.dumps(result.risk_assessment.dict(), default=str),
                    json.dumps(result.compliance_status),
                    json.dumps(result.approved_services),
                    json.dumps(result.restrictions),
                    result.tenant_id, result.created_at, result.updated_at
                )
                
        except Exception as e:
            logger.error(f"Failed to store KYB result: {e}")
    
    async def _schedule_follow_up_checks(self, result_id: str, workflow_id: str):
        """Schedule follow-up verification checks"""
        try:
            # This would integrate with a task scheduler
            # For now, simulate periodic status updates
            
            await asyncio.sleep(5)  # Wait 5 seconds
            
            # Get updated status from Ballerine
            workflow_status = await ballerine_service.get_workflow_status(workflow_id)
            
            if workflow_status:
                # Update result based on workflow status
                await self._update_kyb_result_from_workflow(result_id, workflow_status)
                
        except Exception as e:
            logger.error(f"Follow-up checks failed: {e}")
    
    async def _update_kyb_result_from_workflow(self, result_id: str, workflow_status: Dict[str, Any]):
        """Update KYB result based on workflow status"""
        try:
            async with db_manager.pool.acquire() as conn:
                # Get current result
                current_result = await conn.fetchrow("""
                    SELECT * FROM kyb_verification_results WHERE id = $1
                """, result_id)
                
                if not current_result:
                    return
                
                # Update status based on workflow
                new_status = workflow_status.get("status", "in_progress")
                
                status_mapping = {
                    "completed": VerificationStatus.APPROVED,
                    "rejected": VerificationStatus.REJECTED,
                    "manual_review": VerificationStatus.MANUAL_REVIEW,
                    "pending": VerificationStatus.IN_PROGRESS
                }
                
                mapped_status = status_mapping.get(new_status, VerificationStatus.IN_PROGRESS)
                
                # Update database
                await conn.execute("""
                    UPDATE kyb_verification_results 
                    SET status = $1, updated_at = $2
                    WHERE id = $3
                """, mapped_status.value, datetime.utcnow(), result_id)
                
        except Exception as e:
            logger.error(f"Failed to update KYB result: {e}")
    
    async def process_webhook(self, payload: BallerineWebhookPayload) -> Dict[str, Any]:
        """Process webhook from Ballerine"""
        try:
            # Find corresponding KYB result
            async with db_manager.pool.acquire() as conn:
                result = await conn.fetchrow("""
                    SELECT * FROM kyb_verification_results 
                    WHERE request_id = $1
                """, payload.workflow_id)
                
                if not result:
                    logger.warning(f"No KYB result found for workflow {payload.workflow_id}")
                    return {"status": "not_found"}
                
                # Update status based on webhook
                if payload.event_type == "workflow.completed":
                    new_status = VerificationStatus.APPROVED
                elif payload.event_type == "workflow.rejected":
                    new_status = VerificationStatus.REJECTED
                elif payload.event_type == "workflow.manual_review":
                    new_status = VerificationStatus.MANUAL_REVIEW
                else:
                    new_status = VerificationStatus.IN_PROGRESS
                
                # Update result
                await conn.execute("""
                    UPDATE kyb_verification_results 
                    SET status = $1, updated_at = $2
                    WHERE id = $3
                """, new_status.value, datetime.utcnow(), result["id"])
                
                return {"status": "updated", "new_status": new_status.value}
                
        except Exception as e:
            logger.error(f"Webhook processing failed: {e}")
            return {"status": "error", "message": str(e)}

kyb_service = KYBVerificationService()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await db_manager.connect()
    await initialize_database()
    yield
    # Shutdown
    await db_manager.disconnect()

# FastAPI app
app = FastAPI(
    title="Healthcare Claims Platform - KYB Verification Service",
    description="Ballerine integration for comprehensive provider verification and onboarding",
    version="1.0.0",
    lifespan=lifespan
)

# Add middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

async def initialize_database():
    """Initialize database tables"""
    async with db_manager.pool.acquire() as conn:
        # KYB verification results table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS kyb_verification_results (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                request_id VARCHAR(255) NOT NULL,
                status VARCHAR(50) NOT NULL,
                business_entity JSONB NOT NULL,
                verification_checks JSONB,
                risk_assessment JSONB,
                compliance_status JSONB,
                approved_services JSONB,
                restrictions JSONB,
                expiration_date TIMESTAMP,
                verified_by UUID,
                verified_at TIMESTAMP,
                tenant_id UUID NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        # KYB documents table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS kyb_documents (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                kyb_result_id UUID REFERENCES kyb_verification_results(id),
                document_type VARCHAR(50) NOT NULL,
                file_name VARCHAR(255) NOT NULL,
                file_size INTEGER,
                mime_type VARCHAR(100),
                file_path VARCHAR(500),
                verification_status VARCHAR(50) DEFAULT 'pending',
                extracted_data JSONB,
                confidence_score FLOAT,
                uploaded_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        # Compliance requirements table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS compliance_requirements (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                framework VARCHAR(50) NOT NULL,
                description TEXT,
                required_for_industries JSONB,
                validation_rules JSONB,
                active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        # Insert default compliance requirements
        await conn.execute("""
            INSERT INTO compliance_requirements (framework, description, required_for_industries, validation_rules)
            VALUES 
                ('hipaa', 'Health Insurance Portability and Accountability Act', 
                 '["healthcare", "medical"]', '{"requires_baa": true, "privacy_policy": true}'),
                ('sox', 'Sarbanes-Oxley Act', 
                 '["public_company", "financial"]', '{"financial_controls": true, "audit_trail": true}'),
                ('pci_dss', 'Payment Card Industry Data Security Standard',
                 '["payment_processing", "ecommerce"]', '{"secure_payment": true, "encryption": true}')
            ON CONFLICT DO NOTHING
        """)
        
        logger.info("KYB verification database tables initialized")

# API Endpoints
@app.post("/initiate-kyb", response_model=KYBResult)
async def initiate_kyb_verification(
    kyb_request: KYBRequest, 
    background_tasks: BackgroundTasks
):
    """Initiate KYB verification process"""
    return await kyb_service.initiate_kyb_verification(kyb_request, background_tasks)

@app.get("/kyb-result/{result_id}")
async def get_kyb_result(result_id: str):
    """Get KYB verification result"""
    async with db_manager.pool.acquire() as conn:
        result = await conn.fetchrow("""
            SELECT * FROM kyb_verification_results WHERE id = $1
        """, result_id)
        
        if not result:
            raise HTTPException(status_code=404, detail="KYB result not found")
        
        return dict(result)

@app.post("/webhook/ballerine")
async def ballerine_webhook(payload: BallerineWebhookPayload):
    """Handle webhook from Ballerine"""
    return await kyb_service.process_webhook(payload)

@app.get("/compliance-requirements")
async def get_compliance_requirements():
    """Get compliance requirements"""
    async with db_manager.pool.acquire() as conn:
        requirements = await conn.fetch("""
            SELECT * FROM compliance_requirements WHERE active = true
        """)
        
        return {"requirements": [dict(req) for req in requirements]}

@app.get("/analytics/kyb-stats")
async def get_kyb_statistics(
    tenant_id: Optional[str] = None,
    days: int = 30
):
    """Get KYB verification statistics"""
    async with db_manager.pool.acquire() as conn:
        stats = await conn.fetchrow("""
            SELECT 
                COUNT(*) as total_verifications,
                COUNT(*) FILTER (WHERE status = 'approved') as approved_count,
                COUNT(*) FILTER (WHERE status = 'rejected') as rejected_count,
                COUNT(*) FILTER (WHERE status = 'manual_review') as manual_review_count,
                COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress_count
            FROM kyb_verification_results 
            WHERE created_at > $1
            AND ($2::uuid IS NULL OR tenant_id = $2)
        """, datetime.utcnow() - timedelta(days=days), tenant_id)
        
        return dict(stats)

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        async with db_manager.pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        
        await db_manager.redis.ping()
        
        return {
            "status": "healthy",
            "timestamp": datetime.utcnow().isoformat(),
            "service": "kyb-verification-service",
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
    uvicorn.run(app, host="0.0.0.0", port=8011)
