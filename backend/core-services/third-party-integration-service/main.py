from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from typing import Dict, List, Optional, Any, Union
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
import logging
import json
import asyncio
import uuid
import hashlib
import hmac
import base64
from enum import Enum
import httpx
import aiofiles
import asyncpg
import aioredis
from cryptography.fernet import Fernet
import xml.etree.ElementTree as ET
import warnings
warnings.filterwarnings('ignore')

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class IntegrationPartnerType(str, Enum):
    INSURANCE_PLAN = "insurance_plan"
    HEALTHCARE_PROVIDER = "healthcare_provider"
    IDR_ENTITY = "idr_entity"
    CLEARINGHOUSE = "clearinghouse"
    BILLING_COMPANY = "billing_company"
    GOVERNMENT_AGENCY = "government_agency"
    TECHNOLOGY_VENDOR = "technology_vendor"
    AGGREGATOR = "aggregator"
    CONSULTANT = "consultant"

class IntegrationMethod(str, Enum):
    REST_API = "rest_api"
    SOAP_API = "soap_api"
    WEBHOOK = "webhook"
    SFTP = "sftp"
    EDI_X12 = "edi_x12"
    HL7_FHIR = "hl7_fhir"
    EMAIL = "email"
    FILE_UPLOAD = "file_upload"
    DIRECT_DATABASE = "direct_database"

class DataFormat(str, Enum):
    JSON = "json"
    XML = "xml"
    CSV = "csv"
    EDI = "edi"
    HL7 = "hl7"
    FHIR = "fhir"
    PDF = "pdf"
    EXCEL = "excel"

class IntegrationStatus(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    TESTING = "testing"
    ERROR = "error"
    MAINTENANCE = "maintenance"
    PENDING_APPROVAL = "pending_approval"

class MessageDirection(str, Enum):
    INBOUND = "inbound"
    OUTBOUND = "outbound"
    BIDIRECTIONAL = "bidirectional"

class SecurityLevel(str, Enum):
    BASIC = "basic"
    ENHANCED = "enhanced"
    ENTERPRISE = "enterprise"
    GOVERNMENT = "government"

class ThirdPartyPartner(BaseModel):
    id: Optional[str] = None
    name: str = Field(..., description="Partner organization name")
    partner_type: IntegrationPartnerType = Field(..., description="Type of partner")
    contact_email: str = Field(..., description="Primary contact email")
    contact_phone: Optional[str] = Field(None, description="Primary contact phone")
    website: Optional[str] = Field(None, description="Partner website")
    description: Optional[str] = Field(None, description="Partner description")
    integration_methods: List[IntegrationMethod] = Field(..., description="Supported integration methods")
    data_formats: List[DataFormat] = Field(..., description="Supported data formats")
    security_level: SecurityLevel = Field(SecurityLevel.BASIC, description="Required security level")
    api_endpoints: Dict[str, str] = Field(default_factory=dict, description="API endpoint URLs")
    authentication_config: Dict[str, Any] = Field(default_factory=dict, description="Authentication configuration")
    rate_limits: Dict[str, int] = Field(default_factory=dict, description="Rate limiting configuration")
    sla_requirements: Dict[str, Any] = Field(default_factory=dict, description="SLA requirements")
    compliance_requirements: List[str] = Field(default_factory=list, description="Compliance requirements")
    geographic_coverage: List[str] = Field(default_factory=list, description="Geographic coverage areas")
    specialty_focus: List[str] = Field(default_factory=list, description="Medical specialty focus")
    is_active: bool = Field(True, description="Partner active status")
    onboarding_date: Optional[datetime] = Field(None, description="Partner onboarding date")
    last_activity: Optional[datetime] = Field(None, description="Last activity timestamp")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata")

class IntegrationEndpoint(BaseModel):
    id: Optional[str] = None
    partner_id: str = Field(..., description="Partner ID")
    endpoint_name: str = Field(..., description="Endpoint name")
    endpoint_url: str = Field(..., description="Endpoint URL")
    integration_method: IntegrationMethod = Field(..., description="Integration method")
    data_format: DataFormat = Field(..., description="Data format")
    direction: MessageDirection = Field(..., description="Message direction")
    authentication_required: bool = Field(True, description="Authentication required")
    encryption_required: bool = Field(True, description="Encryption required")
    rate_limit_per_minute: Optional[int] = Field(None, description="Rate limit per minute")
    timeout_seconds: int = Field(30, description="Request timeout in seconds")
    retry_attempts: int = Field(3, description="Number of retry attempts")
    custom_headers: Dict[str, str] = Field(default_factory=dict, description="Custom headers")
    transformation_rules: Dict[str, Any] = Field(default_factory=dict, description="Data transformation rules")
    validation_rules: Dict[str, Any] = Field(default_factory=dict, description="Data validation rules")
    is_active: bool = Field(True, description="Endpoint active status")

class IntegrationMessage(BaseModel):
    id: Optional[str] = None
    partner_id: str = Field(..., description="Partner ID")
    endpoint_id: str = Field(..., description="Endpoint ID")
    message_type: str = Field(..., description="Message type")
    direction: MessageDirection = Field(..., description="Message direction")
    source_system: str = Field(..., description="Source system")
    target_system: str = Field(..., description="Target system")
    data_format: DataFormat = Field(..., description="Data format")
    raw_data: str = Field(..., description="Raw message data")
    processed_data: Optional[str] = Field(None, description="Processed message data")
    status: str = Field("pending", description="Message status")
    error_message: Optional[str] = Field(None, description="Error message")
    retry_count: int = Field(0, description="Retry count")
    correlation_id: Optional[str] = Field(None, description="Correlation ID")
    priority: str = Field("medium", description="Message priority")
    created_at: Optional[datetime] = Field(None, description="Creation timestamp")
    processed_at: Optional[datetime] = Field(None, description="Processing timestamp")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata")

class WebhookSubscription(BaseModel):
    id: Optional[str] = None
    partner_id: str = Field(..., description="Partner ID")
    webhook_url: str = Field(..., description="Webhook URL")
    event_types: List[str] = Field(..., description="Subscribed event types")
    secret_key: Optional[str] = Field(None, description="Webhook secret key")
    is_active: bool = Field(True, description="Subscription active status")
    retry_attempts: int = Field(3, description="Number of retry attempts")
    timeout_seconds: int = Field(30, description="Request timeout")
    last_delivery: Optional[datetime] = Field(None, description="Last successful delivery")
    failure_count: int = Field(0, description="Consecutive failure count")

class APIKey(BaseModel):
    id: Optional[str] = None
    partner_id: str = Field(..., description="Partner ID")
    key_name: str = Field(..., description="API key name")
    key_hash: str = Field(..., description="Hashed API key")
    permissions: List[str] = Field(..., description="API permissions")
    rate_limit_per_minute: int = Field(100, description="Rate limit per minute")
    is_active: bool = Field(True, description="API key active status")
    expires_at: Optional[datetime] = Field(None, description="Expiration timestamp")
    created_at: Optional[datetime] = Field(None, description="Creation timestamp")
    last_used: Optional[datetime] = Field(None, description="Last used timestamp")

class IntegrationMetrics(BaseModel):
    partner_id: str
    total_messages: int
    successful_messages: int
    failed_messages: int
    average_response_time: float
    uptime_percentage: float
    last_24h_volume: int
    error_rate: float
    compliance_score: float

class GeorgetownThirdPartyIntegration:
    def __init__(self):
        # Georgetown research insights for third-party integration
        self.georgetown_insights = {
            "integration_patterns": {
                "high_volume_partners": {
                    "insurance_plans": ["Aetna", "Anthem", "UnitedHealth", "Cigna", "Humana"],
                    "provider_organizations": ["Radiology Partners", "Team Health", "SCP Health"],
                    "clearinghouses": ["Change Healthcare", "Availity", "Relay Health"]
                },
                "geographic_distribution": {
                    "high_volume_states": ["TX", "FL", "AZ", "TN", "GA", "NJ", "NY"],
                    "integration_complexity": {
                        "TX": "high",  # Complex regulatory environment
                        "FL": "medium",
                        "AZ": "medium",
                        "CA": "high",  # Strict privacy requirements
                        "NY": "high"   # Complex billing requirements
                    }
                },
                "specialty_integration_needs": {
                    "radiology": ["DICOM integration", "RIS connectivity", "AI workflow"],
                    "emergency": ["Real-time alerts", "Trauma registry", "EMS integration"],
                    "neurology": ["EEG data", "Imaging protocols", "Specialty billing"],
                    "surgery": ["OR scheduling", "Implant tracking", "Outcome reporting"]
                }
            },
            "compliance_requirements": {
                "hipaa": ["encryption", "audit_logs", "access_controls"],
                "hitech": ["breach_notification", "risk_assessment", "security_measures"],
                "state_regulations": {
                    "CA": ["CCPA", "CMIA"],
                    "TX": ["Texas Medical Privacy Act"],
                    "NY": ["SHIELD Act", "Public Health Law"]
                }
            },
            "performance_benchmarks": {
                "response_time_targets": {
                    "real_time": "< 100ms",
                    "near_real_time": "< 1s",
                    "batch": "< 5min"
                },
                "availability_targets": {
                    "critical": "99.9%",
                    "standard": "99.5%",
                    "batch": "99.0%"
                }
            }
        }
        
        # Initialize partner registry
        self.partner_registry = {}
        self.endpoint_registry = {}
        self.webhook_subscriptions = {}
        self.api_keys = {}
        
        # Initialize security components
        self.encryption_key = Fernet.generate_key()
        self.cipher_suite = Fernet(self.encryption_key)
        
        # Initialize monitoring
        self.metrics_cache = {}
        self.health_status = {}
    
    async def register_partner(self, partner: ThirdPartyPartner) -> str:
        """Register a new third-party partner"""
        try:
            partner.id = str(uuid.uuid4())
            partner.onboarding_date = datetime.utcnow()
            
            # Validate partner based on Georgetown insights
            validation_result = await self._validate_partner(partner)
            if not validation_result["valid"]:
                raise HTTPException(
                    status_code=400, 
                    detail=f"Partner validation failed: {validation_result['errors']}"
                )
            
            # Apply Georgetown-based configuration
            partner = await self._apply_georgetown_config(partner)
            
            # Store partner
            self.partner_registry[partner.id] = partner
            
            # Initialize partner metrics
            self.metrics_cache[partner.id] = IntegrationMetrics(
                partner_id=partner.id,
                total_messages=0,
                successful_messages=0,
                failed_messages=0,
                average_response_time=0.0,
                uptime_percentage=100.0,
                last_24h_volume=0,
                error_rate=0.0,
                compliance_score=100.0
            )
            
            logger.info(f"Registered partner: {partner.name} ({partner.id})")
            return partner.id
            
        except Exception as e:
            logger.error(f"Error registering partner: {e}")
            raise HTTPException(status_code=500, detail=f"Partner registration failed: {str(e)}")
    
    async def _validate_partner(self, partner: ThirdPartyPartner) -> Dict[str, Any]:
        """Validate partner configuration using Georgetown insights"""
        errors = []
        warnings = []
        
        # Validate partner type and integration methods
        if partner.partner_type == IntegrationPartnerType.INSURANCE_PLAN:
            required_methods = [IntegrationMethod.EDI_X12, IntegrationMethod.REST_API]
            if not any(method in partner.integration_methods for method in required_methods):
                errors.append("Insurance plans must support EDI X12 or REST API")
        
        # Validate geographic coverage
        if partner.geographic_coverage:
            high_complexity_states = ["TX", "CA", "NY"]
            for state in partner.geographic_coverage:
                if state in high_complexity_states and partner.security_level == SecurityLevel.BASIC:
                    warnings.append(f"State {state} requires enhanced security level")
        
        # Validate compliance requirements
        if partner.partner_type in [IntegrationPartnerType.INSURANCE_PLAN, IntegrationPartnerType.HEALTHCARE_PROVIDER]:
            required_compliance = ["HIPAA", "HITECH"]
            missing_compliance = [req for req in required_compliance if req not in partner.compliance_requirements]
            if missing_compliance:
                errors.append(f"Missing required compliance: {missing_compliance}")
        
        # Validate specialty focus
        if partner.specialty_focus:
            georgetown_specialties = list(self.georgetown_insights["integration_patterns"]["specialty_integration_needs"].keys())
            unsupported_specialties = [spec for spec in partner.specialty_focus if spec not in georgetown_specialties]
            if unsupported_specialties:
                warnings.append(f"Unsupported specialties: {unsupported_specialties}")
        
        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "warnings": warnings
        }
    
    async def _apply_georgetown_config(self, partner: ThirdPartyPartner) -> ThirdPartyPartner:
        """Apply Georgetown-based configuration to partner"""
        
        # Apply security level based on partner type and coverage
        if partner.partner_type == IntegrationPartnerType.GOVERNMENT_AGENCY:
            partner.security_level = SecurityLevel.GOVERNMENT
        elif any(state in ["TX", "CA", "NY"] for state in partner.geographic_coverage):
            if partner.security_level == SecurityLevel.BASIC:
                partner.security_level = SecurityLevel.ENHANCED
        
        # Apply rate limits based on partner type
        if partner.partner_type == IntegrationPartnerType.INSURANCE_PLAN:
            partner.rate_limits = {
                "api_calls_per_minute": 1000,
                "batch_size_limit": 10000,
                "concurrent_connections": 50
            }
        elif partner.partner_type == IntegrationPartnerType.HEALTHCARE_PROVIDER:
            partner.rate_limits = {
                "api_calls_per_minute": 500,
                "batch_size_limit": 5000,
                "concurrent_connections": 25
            }
        else:
            partner.rate_limits = {
                "api_calls_per_minute": 100,
                "batch_size_limit": 1000,
                "concurrent_connections": 10
            }
        
        # Apply SLA requirements based on Georgetown benchmarks
        if partner.partner_type in [IntegrationPartnerType.INSURANCE_PLAN, IntegrationPartnerType.IDR_ENTITY]:
            partner.sla_requirements = {
                "response_time_ms": 1000,
                "availability_percentage": 99.9,
                "error_rate_threshold": 0.1,
                "recovery_time_minutes": 15
            }
        else:
            partner.sla_requirements = {
                "response_time_ms": 5000,
                "availability_percentage": 99.5,
                "error_rate_threshold": 1.0,
                "recovery_time_minutes": 60
            }
        
        return partner
    
    async def create_endpoint(self, endpoint: IntegrationEndpoint) -> str:
        """Create a new integration endpoint"""
        try:
            endpoint.id = str(uuid.uuid4())
            
            # Validate endpoint configuration
            validation_result = await self._validate_endpoint(endpoint)
            if not validation_result["valid"]:
                raise HTTPException(
                    status_code=400,
                    detail=f"Endpoint validation failed: {validation_result['errors']}"
                )
            
            # Apply Georgetown-based endpoint configuration
            endpoint = await self._apply_endpoint_config(endpoint)
            
            # Store endpoint
            self.endpoint_registry[endpoint.id] = endpoint
            
            logger.info(f"Created endpoint: {endpoint.endpoint_name} ({endpoint.id})")
            return endpoint.id
            
        except Exception as e:
            logger.error(f"Error creating endpoint: {e}")
            raise HTTPException(status_code=500, detail=f"Endpoint creation failed: {str(e)}")
    
    async def _validate_endpoint(self, endpoint: IntegrationEndpoint) -> Dict[str, Any]:
        """Validate endpoint configuration"""
        errors = []
        
        # Validate partner exists
        if endpoint.partner_id not in self.partner_registry:
            errors.append("Partner not found")
            return {"valid": False, "errors": errors}
        
        partner = self.partner_registry[endpoint.partner_id]
        
        # Validate integration method is supported by partner
        if endpoint.integration_method not in partner.integration_methods:
            errors.append(f"Integration method {endpoint.integration_method} not supported by partner")
        
        # Validate data format is supported by partner
        if endpoint.data_format not in partner.data_formats:
            errors.append(f"Data format {endpoint.data_format} not supported by partner")
        
        # Validate security requirements
        if partner.security_level in [SecurityLevel.ENHANCED, SecurityLevel.ENTERPRISE, SecurityLevel.GOVERNMENT]:
            if not endpoint.authentication_required:
                errors.append("Authentication required for this security level")
            if not endpoint.encryption_required:
                errors.append("Encryption required for this security level")
        
        return {
            "valid": len(errors) == 0,
            "errors": errors
        }
    
    async def _apply_endpoint_config(self, endpoint: IntegrationEndpoint) -> IntegrationEndpoint:
        """Apply Georgetown-based endpoint configuration"""
        
        partner = self.partner_registry[endpoint.partner_id]
        
        # Apply rate limits from partner configuration
        if "api_calls_per_minute" in partner.rate_limits:
            endpoint.rate_limit_per_minute = partner.rate_limits["api_calls_per_minute"]
        
        # Apply timeout based on partner SLA
        if "response_time_ms" in partner.sla_requirements:
            endpoint.timeout_seconds = max(30, partner.sla_requirements["response_time_ms"] // 1000 + 5)
        
        # Apply retry attempts based on partner type
        if partner.partner_type in [IntegrationPartnerType.INSURANCE_PLAN, IntegrationPartnerType.IDR_ENTITY]:
            endpoint.retry_attempts = 5  # Higher retry for critical partners
        else:
            endpoint.retry_attempts = 3
        
        # Apply transformation rules based on specialty focus
        if partner.specialty_focus:
            specialty_rules = {}
            for specialty in partner.specialty_focus:
                if specialty in self.georgetown_insights["integration_patterns"]["specialty_integration_needs"]:
                    specialty_requirements = self.georgetown_insights["integration_patterns"]["specialty_integration_needs"][specialty]
                    specialty_rules[specialty] = specialty_requirements
            
            if specialty_rules:
                endpoint.transformation_rules["specialty_requirements"] = specialty_rules
        
        return endpoint
    
    async def send_message(self, message: IntegrationMessage) -> str:
        """Send integration message to third-party partner"""
        try:
            message.id = str(uuid.uuid4())
            message.created_at = datetime.utcnow()
            
            # Validate message
            validation_result = await self._validate_message(message)
            if not validation_result["valid"]:
                raise HTTPException(
                    status_code=400,
                    detail=f"Message validation failed: {validation_result['errors']}"
                )
            
            # Process message asynchronously
            asyncio.create_task(self._process_message(message))
            
            logger.info(f"Queued message: {message.id}")
            return message.id
            
        except Exception as e:
            logger.error(f"Error sending message: {e}")
            raise HTTPException(status_code=500, detail=f"Message sending failed: {str(e)}")
    
    async def _validate_message(self, message: IntegrationMessage) -> Dict[str, Any]:
        """Validate integration message"""
        errors = []
        
        # Validate partner and endpoint exist
        if message.partner_id not in self.partner_registry:
            errors.append("Partner not found")
        
        if message.endpoint_id not in self.endpoint_registry:
            errors.append("Endpoint not found")
        
        if errors:
            return {"valid": False, "errors": errors}
        
        partner = self.partner_registry[message.partner_id]
        endpoint = self.endpoint_registry[message.endpoint_id]
        
        # Validate data format matches endpoint
        if message.data_format != endpoint.data_format:
            errors.append("Message data format doesn't match endpoint")
        
        # Validate direction matches endpoint
        if endpoint.direction != MessageDirection.BIDIRECTIONAL and message.direction != endpoint.direction:
            errors.append("Message direction not supported by endpoint")
        
        return {
            "valid": len(errors) == 0,
            "errors": errors
        }
    
    async def _process_message(self, message: IntegrationMessage):
        """Process integration message"""
        try:
            # Update message status
            message.status = "processing"
            message.processed_at = datetime.utcnow()
            
            # Get partner and endpoint configuration
            partner = self.partner_registry[message.partner_id]
            endpoint = self.endpoint_registry[message.endpoint_id]
            
            # Apply data transformation
            transformed_data = await self._transform_data(message, endpoint)
            message.processed_data = transformed_data
            
            # Send message based on integration method
            if endpoint.integration_method == IntegrationMethod.REST_API:
                await self._send_rest_message(message, endpoint)
            elif endpoint.integration_method == IntegrationMethod.WEBHOOK:
                await self._send_webhook_message(message, endpoint)
            elif endpoint.integration_method == IntegrationMethod.EDI_X12:
                await self._send_edi_message(message, endpoint)
            elif endpoint.integration_method == IntegrationMethod.HL7_FHIR:
                await self._send_fhir_message(message, endpoint)
            elif endpoint.integration_method == IntegrationMethod.EMAIL:
                await self._send_email_message(message, endpoint)
            else:
                raise Exception(f"Unsupported integration method: {endpoint.integration_method}")
            
            # Update message status
            message.status = "sent"
            
            # Update metrics
            await self._update_metrics(message.partner_id, success=True)
            
            logger.info(f"Message processed successfully: {message.id}")
            
        except Exception as e:
            logger.error(f"Message processing failed: {e}")
            message.status = "failed"
            message.error_message = str(e)
            message.retry_count += 1
            
            # Update metrics
            await self._update_metrics(message.partner_id, success=False)
            
            # Retry if attempts remaining
            endpoint = self.endpoint_registry[message.endpoint_id]
            if message.retry_count < endpoint.retry_attempts:
                # Schedule retry with exponential backoff
                retry_delay = min(300, 2 ** message.retry_count * 10)
                await asyncio.sleep(retry_delay)
                await self._process_message(message)
    
    async def _transform_data(self, message: IntegrationMessage, endpoint: IntegrationEndpoint) -> str:
        """Transform message data based on endpoint configuration"""
        try:
            # Apply basic transformation rules
            transformed_data = message.raw_data
            
            # Apply Georgetown-specific transformations
            if "specialty_requirements" in endpoint.transformation_rules:
                specialty_rules = endpoint.transformation_rules["specialty_requirements"]
                # Apply specialty-specific field mappings
                try:
                    import json as _json
                    data = _json.loads(message.raw_data) if isinstance(message.raw_data, str) else message.raw_data
                    for field_map in specialty_rules.get("field_mappings", []):
                        src, dst = field_map.get("from"), field_map.get("to")
                        if src and dst and src in data:
                            data[dst] = data.pop(src)
                    transformed_data = _json.dumps(data)
                except Exception:
                    transformed_data = message.raw_data
            
            # Apply data format conversions
            if message.data_format == DataFormat.JSON and endpoint.data_format == DataFormat.XML:
                # Convert JSON to XML using dict2xml pattern
                import json as _json
                try:
                    data = _json.loads(message.raw_data)
                    # Build simple XML from dict
                    def _to_xml(d, root="root"):
                        if isinstance(d, dict):
                            inner = "".join(f"<{k}>{_to_xml(v, k)}</{k}>" for k, v in d.items())
                            return inner
                        elif isinstance(d, list):
                            return "".join(f"<item>{_to_xml(i)}</item>" for i in d)
                        else:
                            return str(d)
                    transformed_data = f'<?xml version="1.0"?><root>{_to_xml(data)}</root>'
                except Exception:
                    transformed_data = message.raw_data
            elif message.data_format == DataFormat.CSV and endpoint.data_format == DataFormat.JSON:
                # Convert CSV to JSON
                import csv, io, json as _json
                try:
                    reader = csv.DictReader(io.StringIO(message.raw_data))
                    transformed_data = _json.dumps(list(reader))
                except Exception:
                    transformed_data = message.raw_data
            
            return transformed_data
            
        except Exception as e:
            logger.error(f"Data transformation failed: {e}")
            return message.raw_data
    
    async def _send_rest_message(self, message: IntegrationMessage, endpoint: IntegrationEndpoint):
        """Send REST API message"""
        async with httpx.AsyncClient() as client:
            headers = {
                "Content-Type": f"application/{endpoint.data_format.value}",
                **endpoint.custom_headers
            }
            
            response = await client.post(
                endpoint.endpoint_url,
                data=message.processed_data,
                headers=headers,
                timeout=endpoint.timeout_seconds
            )
            
            if response.status_code not in [200, 201, 202]:
                raise Exception(f"HTTP {response.status_code}: {response.text}")
    
    async def _send_webhook_message(self, message: IntegrationMessage, endpoint: IntegrationEndpoint):
        """Send webhook message"""
        # Similar to REST but with webhook-specific handling
        await self._send_rest_message(message, endpoint)
    
    async def _send_edi_message(self, message: IntegrationMessage, endpoint: IntegrationEndpoint):
        """Send EDI X12 message via HTTP to EDI gateway."""
        import httpx
        edi_gateway = os.getenv("EDI_GATEWAY_URL", endpoint.endpoint_url)
        async with httpx.AsyncClient(timeout=endpoint.timeout_seconds) as client:
            headers = {
                "Content-Type": "application/edi-x12",
                "X-ISA-Sender": os.getenv("EDI_SENDER_ID", "HEALTHPOINT"),
                **endpoint.custom_headers
            }
            response = await client.post(edi_gateway, content=message.processed_data, headers=headers)
            if response.status_code not in (200, 201, 202):
                raise Exception(f"EDI gateway returned HTTP {response.status_code}: {response.text[:200]}")
    
    async def _send_fhir_message(self, message: IntegrationMessage, endpoint: IntegrationEndpoint):
        """Send HL7 FHIR R4 resource to FHIR server."""
        import httpx, json as _json
        async with httpx.AsyncClient(timeout=endpoint.timeout_seconds) as client:
            headers = {
                "Content-Type": "application/fhir+json",
                "Accept": "application/fhir+json",
                **endpoint.custom_headers
            }
            # Determine FHIR resource type from payload
            try:
                payload = _json.loads(message.processed_data)
                resource_type = payload.get("resourceType", "Bundle")
            except Exception:
                resource_type = "Bundle"
            url = f"{endpoint.endpoint_url}/{resource_type}"
            response = await client.post(url, content=message.processed_data, headers=headers)
            if response.status_code not in (200, 201):
                raise Exception(f"FHIR server returned HTTP {response.status_code}: {response.text[:200]}")
    
    async def _send_email_message(self, message: IntegrationMessage, endpoint: IntegrationEndpoint):
        """Send email notification via SMTP."""
        import smtplib, os
        from email.mime.text import MIMEText
        from email.mime.multipart import MIMEMultipart

        smtp_host = os.getenv("SMTP_HOST", "smtp.healthpoint.local")
        smtp_port = int(os.getenv("SMTP_PORT", "587"))
        smtp_user = os.getenv("SMTP_USER", "")
        smtp_pass = os.getenv("SMTP_PASSWORD", "")
        from_addr = os.getenv("SMTP_FROM", "noreply@healthpoint.com")

        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"HealthPoint Integration: {message.message_type}"
        msg["From"] = from_addr
        msg["To"] = endpoint.endpoint_url  # endpoint_url used as recipient for email type

        body = MIMEText(message.processed_data, "plain")
        msg.attach(body)

        try:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=endpoint.timeout_seconds) as server:
                if smtp_user:
                    server.starttls()
                    server.login(smtp_user, smtp_pass)
                server.sendmail(from_addr, [endpoint.endpoint_url], msg.as_string())
        except Exception as e:
            raise Exception(f"Email send failed: {e}")
    
    async def _update_metrics(self, partner_id: str, success: bool):
        """Update partner metrics"""
        if partner_id in self.metrics_cache:
            metrics = self.metrics_cache[partner_id]
            metrics.total_messages += 1
            
            if success:
                metrics.successful_messages += 1
            else:
                metrics.failed_messages += 1
            
            # Calculate error rate
            metrics.error_rate = (metrics.failed_messages / metrics.total_messages) * 100
            
            # Update compliance score based on error rate
            if metrics.error_rate < 1.0:
                metrics.compliance_score = 100.0
            elif metrics.error_rate < 5.0:
                metrics.compliance_score = 90.0
            else:
                metrics.compliance_score = max(50.0, 100.0 - metrics.error_rate)
    
    async def get_partner_metrics(self, partner_id: str) -> IntegrationMetrics:
        """Get metrics for a specific partner"""
        if partner_id not in self.metrics_cache:
            raise HTTPException(status_code=404, detail="Partner not found")
        
        return self.metrics_cache[partner_id]
    
    async def get_georgetown_recommendations(self, partner_type: IntegrationPartnerType, 
                                           geographic_coverage: List[str]) -> Dict[str, Any]:
        """Get Georgetown-based integration recommendations"""
        recommendations = {
            "integration_methods": [],
            "security_requirements": [],
            "compliance_requirements": [],
            "performance_targets": {},
            "specialty_considerations": []
        }
        
        # Integration method recommendations
        if partner_type == IntegrationPartnerType.INSURANCE_PLAN:
            recommendations["integration_methods"] = ["EDI_X12", "REST_API", "HL7_FHIR"]
        elif partner_type == IntegrationPartnerType.HEALTHCARE_PROVIDER:
            recommendations["integration_methods"] = ["HL7_FHIR", "REST_API", "WEBHOOK"]
        elif partner_type == IntegrationPartnerType.IDR_ENTITY:
            recommendations["integration_methods"] = ["REST_API", "WEBHOOK", "EMAIL"]
        
        # Security requirements based on geographic coverage
        high_security_states = ["TX", "CA", "NY"]
        if any(state in high_security_states for state in geographic_coverage):
            recommendations["security_requirements"] = [
                "Enhanced encryption",
                "Multi-factor authentication",
                "Audit logging",
                "Data residency compliance"
            ]
        
        # Compliance requirements
        base_compliance = ["HIPAA", "HITECH"]
        state_compliance = []
        
        for state in geographic_coverage:
            if state in self.georgetown_insights["compliance_requirements"]["state_regulations"]:
                state_compliance.extend(
                    self.georgetown_insights["compliance_requirements"]["state_regulations"][state]
                )
        
        recommendations["compliance_requirements"] = base_compliance + list(set(state_compliance))
        
        # Performance targets
        if partner_type in [IntegrationPartnerType.INSURANCE_PLAN, IntegrationPartnerType.IDR_ENTITY]:
            recommendations["performance_targets"] = {
                "response_time": "< 1s",
                "availability": "99.9%",
                "throughput": "1000 req/min"
            }
        else:
            recommendations["performance_targets"] = {
                "response_time": "< 5s",
                "availability": "99.5%",
                "throughput": "100 req/min"
            }
        
        return recommendations

# Initialize the integration service
integration_service = GeorgetownThirdPartyIntegration()

app = FastAPI(
    title="Georgetown-Enhanced Third-Party Integration Service",
    description="Comprehensive third-party integration framework with Georgetown University research insights",
    version="2.0.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security
security = HTTPBearer()

@app.post("/partners", response_model=Dict[str, str])
async def register_partner(partner: ThirdPartyPartner):
    """Register a new third-party partner"""
    partner_id = await integration_service.register_partner(partner)
    return {"partner_id": partner_id, "status": "registered"}

@app.get("/partners/{partner_id}")
async def get_partner(partner_id: str):
    """Get partner details"""
    if partner_id not in integration_service.partner_registry:
        raise HTTPException(status_code=404, detail="Partner not found")
    
    return integration_service.partner_registry[partner_id]

@app.get("/partners")
async def list_partners(partner_type: Optional[IntegrationPartnerType] = None):
    """List all partners with optional filtering"""
    partners = list(integration_service.partner_registry.values())
    
    if partner_type:
        partners = [p for p in partners if p.partner_type == partner_type]
    
    return {"partners": partners, "total": len(partners)}

@app.post("/endpoints", response_model=Dict[str, str])
async def create_endpoint(endpoint: IntegrationEndpoint):
    """Create a new integration endpoint"""
    endpoint_id = await integration_service.create_endpoint(endpoint)
    return {"endpoint_id": endpoint_id, "status": "created"}

@app.get("/endpoints/{endpoint_id}")
async def get_endpoint(endpoint_id: str):
    """Get endpoint details"""
    if endpoint_id not in integration_service.endpoint_registry:
        raise HTTPException(status_code=404, detail="Endpoint not found")
    
    return integration_service.endpoint_registry[endpoint_id]

@app.post("/messages", response_model=Dict[str, str])
async def send_message(message: IntegrationMessage):
    """Send integration message"""
    message_id = await integration_service.send_message(message)
    return {"message_id": message_id, "status": "queued"}

@app.get("/partners/{partner_id}/metrics", response_model=IntegrationMetrics)
async def get_partner_metrics(partner_id: str):
    """Get partner integration metrics"""
    return await integration_service.get_partner_metrics(partner_id)

@app.get("/recommendations")
async def get_integration_recommendations(
    partner_type: IntegrationPartnerType,
    geographic_coverage: List[str] = Query(...)
):
    """Get Georgetown-based integration recommendations"""
    return await integration_service.get_georgetown_recommendations(partner_type, geographic_coverage)

@app.get("/georgetown-insights")
async def get_georgetown_insights():
    """Get Georgetown University research insights for third-party integration"""
    return {
        "research_source": "Georgetown University Center on Health Insurance Reforms",
        "insights": integration_service.georgetown_insights,
        "integration_best_practices": {
            "security": "Implement enhanced security for high-volume states",
            "compliance": "Ensure state-specific compliance requirements",
            "performance": "Optimize for specialty-specific workflows",
            "monitoring": "Continuous monitoring of partner performance"
        }
    }

@app.get("/compliance-requirements/{state}")
async def get_state_compliance_requirements(state: str):
    """Get compliance requirements for a specific state"""
    state_upper = state.upper()
    
    base_requirements = integration_service.georgetown_insights["compliance_requirements"]["hipaa"] + \
                       integration_service.georgetown_insights["compliance_requirements"]["hitech"]
    
    state_requirements = integration_service.georgetown_insights["compliance_requirements"]["state_regulations"].get(
        state_upper, []
    )
    
    return {
        "state": state_upper,
        "base_requirements": base_requirements,
        "state_specific_requirements": state_requirements,
        "all_requirements": base_requirements + state_requirements
    }

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "third-party-integration",
        "version": "2.0.0",
        "timestamp": datetime.utcnow().isoformat(),
        "registered_partners": len(integration_service.partner_registry),
        "active_endpoints": len(integration_service.endpoint_registry),
        "georgetown_insights_loaded": True
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8083)
