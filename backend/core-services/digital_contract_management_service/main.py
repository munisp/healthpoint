"""
Digital Contract Management Service
Handles contract lifecycle management between providers and aggregators
Port: 8023
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

from fastapi import FastAPI, HTTPException, Depends, UploadFile, File
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from enum import Enum
import uuid
import hashlib
import json
import asyncio
from cryptography.fernet import Fernet
import boto3
from docusign_esign import ApiClient, EnvelopesApi, EnvelopeDefinition, Document, Signer, Recipients, Tabs
import logging
from shared.telemetry import setup_telemetry, instrument_fastapi, get_tracer

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

setup_telemetry(service_name="digital-contract-management-service", service_version="1.0.0")
app = FastAPI(
instrument_fastapi(app)

app.middleware("http")(security_headers_middleware)
    title="Digital Contract Management Service",
    description="Comprehensive contract lifecycle management for healthcare provider-aggregator relationships",
    version="1.0.0"
)

# Enums
class ContractStatus(str, Enum):
    DRAFT = "draft"
    PENDING_REVIEW = "pending_review"
    PENDING_SIGNATURE = "pending_signature"
    ACTIVE = "active"
    EXPIRED = "expired"
    TERMINATED = "terminated"
    RENEWED = "renewed"

class ContractType(str, Enum):
    PROVIDER_AGREEMENT = "provider_agreement"
    SERVICE_AGREEMENT = "service_agreement"
    BILLING_AGREEMENT = "billing_agreement"
    DATA_SHARING_AGREEMENT = "data_sharing_agreement"
    COMPLIANCE_AGREEMENT = "compliance_agreement"

class SignatureStatus(str, Enum):
    PENDING = "pending"
    SIGNED = "signed"
    DECLINED = "declined"
    EXPIRED = "expired"

# Data Models
class ContractTemplate(BaseModel):
    template_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    contract_type: ContractType
    version: str
    template_content: str
    variables: Dict[str, Any] = {}
    created_by: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    is_active: bool = True

class Contract(BaseModel):
    contract_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    template_id: str
    provider_id: str
    aggregator_id: str
    contract_type: ContractType
    title: str
    content: str
    variables: Dict[str, Any] = {}
    status: ContractStatus = ContractStatus.DRAFT
    created_at: datetime = Field(default_factory=datetime.utcnow)
    effective_date: Optional[datetime] = None
    expiration_date: Optional[datetime] = None
    auto_renewal: bool = False
    renewal_period_days: int = 365
    version: str = "1.0"
    parent_contract_id: Optional[str] = None
    metadata: Dict[str, Any] = {}

class ContractSignature(BaseModel):
    signature_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    contract_id: str
    signer_id: str
    signer_name: str
    signer_email: str
    signer_role: str
    status: SignatureStatus = SignatureStatus.PENDING
    signed_at: Optional[datetime] = None
    signature_hash: Optional[str] = None
    ip_address: Optional[str] = None
    device_info: Optional[str] = None

class ContractPerformanceMetric(BaseModel):
    metric_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    contract_id: str
    metric_name: str
    metric_value: float
    target_value: Optional[float] = None
    measurement_date: datetime = Field(default_factory=datetime.utcnow)
    compliance_status: str = "compliant"

# In-memory storage (replace with database in production)
contract_templates = {}
contracts = {}
contract_signatures = {}
performance_metrics = {}

# Digital Contract Management Service
class DigitalContractManager:
    def __init__(self):
        self.encryption_key = Fernet.generate_key()
        self.cipher_suite = Fernet(self.encryption_key)
        self.docusign_client = None  # Initialize with DocuSign credentials
        
    def encrypt_content(self, content: str) -> str:
        """Encrypt sensitive contract content"""
        return self.cipher_suite.encrypt(content.encode()).decode()
    
    def decrypt_content(self, encrypted_content: str) -> str:
        """Decrypt contract content"""
        return self.cipher_suite.decrypt(encrypted_content.encode()).decode()
    
    def generate_contract_hash(self, content: str) -> str:
        """Generate hash for contract integrity verification"""
        return hashlib.sha256(content.encode()).hexdigest()
    
    async def create_template(self, template: ContractTemplate) -> ContractTemplate:
        """Create a new contract template"""
        template.template_content = self.encrypt_content(template.template_content)
        contract_templates[template.template_id] = template
        logger.info(f"Created contract template: {template.template_id}")
        return template
    
    async def create_contract_from_template(self, template_id: str, provider_id: str, 
                                          aggregator_id: str, variables: Dict[str, Any]) -> Contract:
        """Create a contract from a template"""
        if template_id not in contract_templates:
            raise HTTPException(status_code=404, detail="Template not found")
        
        template = contract_templates[template_id]
        decrypted_content = self.decrypt_content(template.template_content)
        
        # Replace variables in template
        contract_content = decrypted_content
        for key, value in variables.items():
            contract_content = contract_content.replace(f"{{{key}}}", str(value))
        
        contract = Contract(
            template_id=template_id,
            provider_id=provider_id,
            aggregator_id=aggregator_id,
            contract_type=template.contract_type,
            title=f"{template.name} - {provider_id}",
            content=self.encrypt_content(contract_content),
            variables=variables
        )
        
        contracts[contract.contract_id] = contract
        logger.info(f"Created contract: {contract.contract_id}")
        return contract
    
    async def initiate_signature_process(self, contract_id: str, signers: List[Dict[str, str]]) -> List[ContractSignature]:
        """Initiate digital signature process using DocuSign"""
        if contract_id not in contracts:
            raise HTTPException(status_code=404, detail="Contract not found")
        
        contract = contracts[contract_id]
        signatures = []
        
        for signer in signers:
            signature = ContractSignature(
                contract_id=contract_id,
                signer_id=signer["id"],
                signer_name=signer["name"],
                signer_email=signer["email"],
                signer_role=signer["role"]
            )
            contract_signatures[signature.signature_id] = signature
            signatures.append(signature)
        
        # Update contract status
        contract.status = ContractStatus.PENDING_SIGNATURE
        
        # In production, integrate with DocuSign API
        # self._send_docusign_envelope(contract, signatures)
        
        logger.info(f"Initiated signature process for contract: {contract_id}")
        return signatures
    
    async def process_signature(self, signature_id: str, signature_data: Dict[str, Any]) -> ContractSignature:
        """Process a digital signature"""
        if signature_id not in contract_signatures:
            raise HTTPException(status_code=404, detail="Signature not found")
        
        signature = contract_signatures[signature_id]
        signature.status = SignatureStatus.SIGNED
        signature.signed_at = datetime.utcnow()
        signature.signature_hash = self.generate_contract_hash(json.dumps(signature_data))
        signature.ip_address = signature_data.get("ip_address")
        signature.device_info = signature_data.get("device_info")
        
        # Check if all signatures are complete
        contract_signatures_list = [s for s in contract_signatures.values() if s.contract_id == signature.contract_id]
        all_signed = all(s.status == SignatureStatus.SIGNED for s in contract_signatures_list)
        
        if all_signed:
            contract = contracts[signature.contract_id]
            contract.status = ContractStatus.ACTIVE
            contract.effective_date = datetime.utcnow()
            
            # Set expiration date if specified
            if contract.expiration_date is None and hasattr(contract, 'term_months'):
                contract.expiration_date = datetime.utcnow() + timedelta(days=contract.term_months * 30)
        
        logger.info(f"Processed signature: {signature_id}")
        return signature
    
    async def track_performance(self, contract_id: str, metrics: List[Dict[str, Any]]) -> List[ContractPerformanceMetric]:
        """Track contract performance metrics"""
        if contract_id not in contracts:
            raise HTTPException(status_code=404, detail="Contract not found")
        
        performance_records = []
        for metric_data in metrics:
            metric = ContractPerformanceMetric(
                contract_id=contract_id,
                metric_name=metric_data["name"],
                metric_value=metric_data["value"],
                target_value=metric_data.get("target"),
                compliance_status="compliant" if metric_data["value"] >= metric_data.get("target", 0) else "non_compliant"
            )
            performance_metrics[metric.metric_id] = metric
            performance_records.append(metric)
        
        logger.info(f"Tracked performance for contract: {contract_id}")
        return performance_records
    
    async def check_renewal_eligibility(self, contract_id: str) -> Dict[str, Any]:
        """Check if contract is eligible for renewal"""
        if contract_id not in contracts:
            raise HTTPException(status_code=404, detail="Contract not found")
        
        contract = contracts[contract_id]
        
        # Check expiration date
        days_until_expiration = None
        if contract.expiration_date:
            days_until_expiration = (contract.expiration_date - datetime.utcnow()).days
        
        # Check performance metrics
        contract_metrics = [m for m in performance_metrics.values() if m.contract_id == contract_id]
        performance_score = 0
        if contract_metrics:
            compliant_metrics = [m for m in contract_metrics if m.compliance_status == "compliant"]
            performance_score = len(compliant_metrics) / len(contract_metrics) * 100
        
        renewal_eligible = (
            contract.status == ContractStatus.ACTIVE and
            (days_until_expiration is None or days_until_expiration <= 90) and
            performance_score >= 80
        )
        
        return {
            "contract_id": contract_id,
            "renewal_eligible": renewal_eligible,
            "days_until_expiration": days_until_expiration,
            "performance_score": performance_score,
            "auto_renewal": contract.auto_renewal
        }
    
    async def renew_contract(self, contract_id: str, renewal_terms: Dict[str, Any]) -> Contract:
        """Renew an existing contract"""
        if contract_id not in contracts:
            raise HTTPException(status_code=404, detail="Contract not found")
        
        original_contract = contracts[contract_id]
        
        # Create renewed contract
        renewed_contract = Contract(
            template_id=original_contract.template_id,
            provider_id=original_contract.provider_id,
            aggregator_id=original_contract.aggregator_id,
            contract_type=original_contract.contract_type,
            title=f"{original_contract.title} - Renewed",
            content=original_contract.content,
            variables={**original_contract.variables, **renewal_terms},
            status=ContractStatus.DRAFT,
            effective_date=original_contract.expiration_date,
            expiration_date=original_contract.expiration_date + timedelta(days=original_contract.renewal_period_days),
            auto_renewal=original_contract.auto_renewal,
            renewal_period_days=original_contract.renewal_period_days,
            version=f"{float(original_contract.version) + 0.1:.1f}",
            parent_contract_id=contract_id
        )
        
        contracts[renewed_contract.contract_id] = renewed_contract
        
        # Update original contract status
        original_contract.status = ContractStatus.RENEWED
        
        logger.info(f"Renewed contract: {contract_id} -> {renewed_contract.contract_id}")
        return renewed_contract

# Initialize service
contract_manager = DigitalContractManager()

# API Endpoints
@app.post("/templates", response_model=ContractTemplate)
async def create_template(template: ContractTemplate,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Create a new contract template"""
    return await contract_manager.create_template(template)

@app.get("/templates", response_model=List[ContractTemplate])
async def get_templates(,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get all contract templates"""
    return list(contract_templates.values())

@app.get("/templates/{template_id}", response_model=ContractTemplate)
async def get_template(template_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get a specific contract template"""
    if template_id not in contract_templates:
        raise HTTPException(status_code=404, detail="Template not found")
    return contract_templates[template_id]

@app.post("/contracts", response_model=Contract)
async def create_contract(template_id: str, provider_id: str, aggregator_id: str, variables: Dict[str, Any],
    current_user: TokenPayload = Depends(get_current_user),
):
    """Create a contract from template"""
    return await contract_manager.create_contract_from_template(template_id, provider_id, aggregator_id, variables)

@app.get("/contracts", response_model=List[Contract])
async def get_contracts(provider_id: Optional[str] = None, aggregator_id: Optional[str] = None, status: Optional[ContractStatus] = None,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get contracts with optional filtering"""
    filtered_contracts = list(contracts.values())
    
    if provider_id:
        filtered_contracts = [c for c in filtered_contracts if c.provider_id == provider_id]
    if aggregator_id:
        filtered_contracts = [c for c in filtered_contracts if c.aggregator_id == aggregator_id]
    if status:
        filtered_contracts = [c for c in filtered_contracts if c.status == status]
    
    return filtered_contracts

@app.get("/contracts/{contract_id}", response_model=Contract)
async def get_contract(contract_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get a specific contract"""
    if contract_id not in contracts:
        raise HTTPException(status_code=404, detail="Contract not found")
    return contracts[contract_id]

@app.post("/contracts/{contract_id}/signatures", response_model=List[ContractSignature])
async def initiate_signatures(contract_id: str, signers: List[Dict[str, str]],
    current_user: TokenPayload = Depends(get_current_user),
):
    """Initiate digital signature process"""
    return await contract_manager.initiate_signature_process(contract_id, signers)

@app.put("/signatures/{signature_id}", response_model=ContractSignature)
async def process_signature(signature_id: str, signature_data: Dict[str, Any],
    current_user: TokenPayload = Depends(get_current_user),
):
    """Process a digital signature"""
    return await contract_manager.process_signature(signature_id, signature_data)

@app.get("/contracts/{contract_id}/signatures", response_model=List[ContractSignature])
async def get_contract_signatures(contract_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get all signatures for a contract"""
    return [s for s in contract_signatures.values() if s.contract_id == contract_id]

@app.post("/contracts/{contract_id}/performance", response_model=List[ContractPerformanceMetric])
async def track_performance(contract_id: str, metrics: List[Dict[str, Any]],
    current_user: TokenPayload = Depends(get_current_user),
):
    """Track contract performance metrics"""
    return await contract_manager.track_performance(contract_id, metrics)

@app.get("/contracts/{contract_id}/performance", response_model=List[ContractPerformanceMetric])
async def get_performance_metrics(contract_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get performance metrics for a contract"""
    return [m for m in performance_metrics.values() if m.contract_id == contract_id]

@app.get("/contracts/{contract_id}/renewal-eligibility")
async def check_renewal_eligibility(contract_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Check contract renewal eligibility"""
    return await contract_manager.check_renewal_eligibility(contract_id)

@app.post("/contracts/{contract_id}/renew", response_model=Contract)
async def renew_contract(contract_id: str, renewal_terms: Dict[str, Any],
    current_user: TokenPayload = Depends(get_current_user),
):
    """Renew a contract"""
    return await contract_manager.renew_contract(contract_id, renewal_terms)

@app.get("/analytics/contracts")
async def get_contract_analytics(,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get contract analytics and insights"""
    total_contracts = len(contracts)
    active_contracts = len([c for c in contracts.values() if c.status == ContractStatus.ACTIVE])
    expiring_soon = len([c for c in contracts.values() if c.expiration_date and (c.expiration_date - datetime.utcnow()).days <= 30])
    
    # Performance analytics
    all_metrics = list(performance_metrics.values())
    avg_performance = sum(m.metric_value for m in all_metrics) / len(all_metrics) if all_metrics else 0
    
    return {
        "total_contracts": total_contracts,
        "active_contracts": active_contracts,
        "expiring_soon": expiring_soon,
        "renewal_rate": 85.2,  # Example metric
        "average_performance_score": avg_performance,
        "contract_types": {
            "provider_agreement": len([c for c in contracts.values() if c.contract_type == ContractType.PROVIDER_AGREEMENT]),
            "service_agreement": len([c for c in contracts.values() if c.contract_type == ContractType.SERVICE_AGREEMENT]),
            "billing_agreement": len([c for c in contracts.values() if c.contract_type == ContractType.BILLING_AGREEMENT])
        }
    }

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "Digital Contract Management Service",
        "version": "1.0.0",
        "timestamp": datetime.utcnow().isoformat()
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8023)