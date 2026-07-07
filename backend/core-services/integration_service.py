"""
Healthcare Claims Platform - Integration Service
FHIR, HL7, EDI integration with real-time data synchronization and API management.

Author: Manus AI
Date: October 8, 2025
Port: 8010
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

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks, status, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
from typing import List, Optional, Dict, Any, Union
from datetime import datetime, timedelta
from enum import Enum
import uuid
import logging
import asyncio
import asyncpg

import json
import os
from contextlib import asynccontextmanager
import httpx
import xml.etree.ElementTree as ET
from xml.dom import minidom
import base64
import hashlib
import hmac
from cryptography.fernet import Fernet
import aiofiles

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.environ["DATABASE_URL"]
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

class IntegrationType(str, Enum):
    FHIR = "fhir"
    HL7 = "hl7"
    EDI = "edi"
    REST_API = "rest_api"
    SOAP = "soap"
    WEBHOOK = "webhook"
    FILE_TRANSFER = "file_transfer"
    DATABASE = "database"

class MessageFormat(str, Enum):
    JSON = "json"
    XML = "xml"
    HL7_V2 = "hl7_v2"
    EDI_X12 = "edi_x12"
    FHIR_JSON = "fhir_json"
    FHIR_XML = "fhir_xml"
    CSV = "csv"
    CUSTOM = "custom"

class IntegrationStatus(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    ERROR = "error"
    TESTING = "testing"
    MAINTENANCE = "maintenance"

class MessageStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    SENT = "sent"
    DELIVERED = "delivered"
    FAILED = "failed"
    ACKNOWLEDGED = "acknowledged"
    REJECTED = "rejected"

class SyncDirection(str, Enum):
    INBOUND = "inbound"
    OUTBOUND = "outbound"
    BIDIRECTIONAL = "bidirectional"

# Pydantic Models
class IntegrationEndpoint(BaseModel):
    id: Optional[str] = None
    name: str
    description: Optional[str] = None
    integration_type: IntegrationType
    endpoint_url: str
    authentication: Dict[str, Any] = {}  # API keys, tokens, certificates
    message_format: MessageFormat
    sync_direction: SyncDirection
    is_active: bool = True
    retry_attempts: int = 3
    timeout_seconds: int = 30
    rate_limit_per_minute: Optional[int] = None
    custom_headers: Dict[str, str] = {}
    transformation_rules: Dict[str, Any] = {}
    tenant_id: str
    created_by: str

class MessageMapping(BaseModel):
    id: Optional[str] = None
    name: str
    source_format: MessageFormat
    target_format: MessageFormat
    mapping_rules: Dict[str, Any]
    transformation_script: Optional[str] = None
    is_active: bool = True
    tenant_id: str

class IntegrationMessage(BaseModel):
    id: Optional[str] = None
    endpoint_id: str
    message_type: str
    direction: SyncDirection
    source_system: str
    target_system: str
    message_format: MessageFormat
    raw_message: str
    processed_message: Optional[str] = None
    status: MessageStatus = MessageStatus.PENDING
    error_message: Optional[str] = None
    retry_count: int = 0
    correlation_id: Optional[str] = None
    tenant_id: str
    created_at: Optional[datetime] = None
    processed_at: Optional[datetime] = None

class FHIRResource(BaseModel):
    resource_type: str
    resource_id: Optional[str] = None
    resource_data: Dict[str, Any]
    version: Optional[str] = None
    tenant_id: str

class HL7Message(BaseModel):
    message_type: str  # ADT, ORM, ORU, etc.
    message_control_id: str
    sending_application: str
    receiving_application: str
    message_segments: List[Dict[str, Any]]
    tenant_id: str

class EDITransaction(BaseModel):
    transaction_set: str  # 837, 835, 270, 271, etc.
    control_number: str
    sender_id: str
    receiver_id: str
    transaction_data: Dict[str, Any]
    tenant_id: str

class WebhookSubscription(BaseModel):
    id: Optional[str] = None
    endpoint_url: str
    event_types: List[str]
    secret_key: Optional[str] = None
    is_active: bool = True
    retry_attempts: int = 3
    tenant_id: str
    created_by: str

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
                CREATE TABLE IF NOT EXISTS integration_endpoints (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name VARCHAR(255) NOT NULL,
                    description TEXT,
                    integration_type VARCHAR(20) NOT NULL,
                    endpoint_url TEXT NOT NULL,
                    authentication JSONB,
                    message_format VARCHAR(20) NOT NULL,
                    sync_direction VARCHAR(20) NOT NULL,
                    is_active BOOLEAN DEFAULT TRUE,
                    retry_attempts INTEGER DEFAULT 3,
                    timeout_seconds INTEGER DEFAULT 30,
                    rate_limit_per_minute INTEGER,
                    custom_headers JSONB,
                    transformation_rules JSONB,
                    tenant_id VARCHAR(255) NOT NULL,
                    created_by VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS message_mappings (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name VARCHAR(255) NOT NULL,
                    source_format VARCHAR(20) NOT NULL,
                    target_format VARCHAR(20) NOT NULL,
                    mapping_rules JSONB NOT NULL,
                    transformation_script TEXT,
                    is_active BOOLEAN DEFAULT TRUE,
                    tenant_id VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS integration_messages (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    endpoint_id UUID NOT NULL,
                    message_type VARCHAR(50) NOT NULL,
                    direction VARCHAR(20) NOT NULL,
                    source_system VARCHAR(100),
                    target_system VARCHAR(100),
                    message_format VARCHAR(20) NOT NULL,
                    raw_message TEXT NOT NULL,
                    processed_message TEXT,
                    status VARCHAR(20) DEFAULT 'pending',
                    error_message TEXT,
                    retry_count INTEGER DEFAULT 0,
                    correlation_id VARCHAR(255),
                    tenant_id VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    processed_at TIMESTAMP,
                    FOREIGN KEY (endpoint_id) REFERENCES integration_endpoints(id)
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS fhir_resources (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    resource_type VARCHAR(50) NOT NULL,
                    resource_id VARCHAR(255),
                    resource_data JSONB NOT NULL,
                    version VARCHAR(20),
                    tenant_id VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS webhook_subscriptions (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    endpoint_url TEXT NOT NULL,
                    event_types TEXT[] NOT NULL,
                    secret_key VARCHAR(255),
                    is_active BOOLEAN DEFAULT TRUE,
                    retry_attempts INTEGER DEFAULT 3,
                    tenant_id VARCHAR(255) NOT NULL,
                    created_by VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS integration_logs (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    endpoint_id UUID,
                    message_id UUID,
                    log_level VARCHAR(10) NOT NULL,
                    log_message TEXT NOT NULL,
                    additional_data JSONB,
                    tenant_id VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    FOREIGN KEY (endpoint_id) REFERENCES integration_endpoints(id),
                    FOREIGN KEY (message_id) REFERENCES integration_messages(id)
                );
            """)
            
            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_integration_endpoints_tenant ON integration_endpoints(tenant_id);
                CREATE INDEX IF NOT EXISTS idx_integration_messages_endpoint ON integration_messages(endpoint_id);
                CREATE INDEX IF NOT EXISTS idx_integration_messages_status ON integration_messages(status);
                CREATE INDEX IF NOT EXISTS idx_integration_messages_created ON integration_messages(created_at);
                CREATE INDEX IF NOT EXISTS idx_fhir_resources_type ON fhir_resources(resource_type);
                CREATE INDEX IF NOT EXISTS idx_fhir_resources_tenant ON fhir_resources(tenant_id);
                CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_tenant ON webhook_subscriptions(tenant_id);
            """)

db_manager = DatabaseManager()

# Integration Manager
class IntegrationManager:
    def __init__(self):
        self.redis_client = None
        self.active_endpoints = {}
        self.message_processors = {}

    async def _get_redis_client(self):
        if not self.redis_client:
            self.redis_client = get_redis_client()
        return self.redis_client

    async def create_endpoint(self, endpoint: IntegrationEndpoint) -> str:
        """Create a new integration endpoint"""
        endpoint.id = str(uuid.uuid4())
        
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO integration_endpoints 
                (id, name, description, integration_type, endpoint_url, authentication,
                 message_format, sync_direction, is_active, retry_attempts, timeout_seconds,
                 rate_limit_per_minute, custom_headers, transformation_rules, tenant_id, created_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            """, endpoint.id, endpoint.name, endpoint.description, endpoint.integration_type.value,
                endpoint.endpoint_url, json.dumps(endpoint.authentication), endpoint.message_format.value,
                endpoint.sync_direction.value, endpoint.is_active, endpoint.retry_attempts,
                endpoint.timeout_seconds, endpoint.rate_limit_per_minute,
                json.dumps(endpoint.custom_headers), json.dumps(endpoint.transformation_rules),
                endpoint.tenant_id, endpoint.created_by)
        
        # Cache endpoint for quick access
        self.active_endpoints[endpoint.id] = endpoint
        
        logger.info(f"Created integration endpoint: {endpoint.name}")
        return endpoint.id

    async def send_message(self, message: IntegrationMessage) -> str:
        """Send integration message"""
        message.id = str(uuid.uuid4())
        message.created_at = datetime.utcnow()
        
        # Save message to database
        await self._save_message(message)
        
        # Process message in background
        asyncio.create_task(self._process_message(message))
        
        logger.info(f"Queued integration message: {message.id}")
        return message.id

    async def _save_message(self, message: IntegrationMessage):
        """Save message to database"""
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO integration_messages 
                (id, endpoint_id, message_type, direction, source_system, target_system,
                 message_format, raw_message, processed_message, status, error_message,
                 retry_count, correlation_id, tenant_id, created_at, processed_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                ON CONFLICT (id) DO UPDATE SET
                    processed_message = EXCLUDED.processed_message,
                    status = EXCLUDED.status,
                    error_message = EXCLUDED.error_message,
                    retry_count = EXCLUDED.retry_count,
                    processed_at = EXCLUDED.processed_at
            """, message.id, message.endpoint_id, message.message_type, message.direction.value,
                message.source_system, message.target_system, message.message_format.value,
                message.raw_message, message.processed_message, message.status.value,
                message.error_message, message.retry_count, message.correlation_id,
                message.tenant_id, message.created_at, message.processed_at)

    async def _process_message(self, message: IntegrationMessage):
        """Process integration message"""
        try:
            # Update status to processing
            message.status = MessageStatus.PROCESSING
            message.processed_at = datetime.utcnow()
            await self._save_message(message)
            
            # Get endpoint configuration
            endpoint = await self._get_endpoint(message.endpoint_id)
            if not endpoint:
                raise Exception("Endpoint not found")
            
            # Transform message if needed
            transformed_message = await self._transform_message(message, endpoint)
            message.processed_message = transformed_message
            
            # Send message based on integration type
            if endpoint['integration_type'] == IntegrationType.FHIR.value:
                await self._send_fhir_message(message, endpoint)
            elif endpoint['integration_type'] == IntegrationType.HL7.value:
                await self._send_hl7_message(message, endpoint)
            elif endpoint['integration_type'] == IntegrationType.EDI.value:
                await self._send_edi_message(message, endpoint)
            elif endpoint['integration_type'] == IntegrationType.REST_API.value:
                await self._send_rest_api_message(message, endpoint)
            elif endpoint['integration_type'] == IntegrationType.WEBHOOK.value:
                await self._send_webhook_message(message, endpoint)
            else:
                raise Exception(f"Unsupported integration type: {endpoint['integration_type']}")
            
            # Update status to sent
            message.status = MessageStatus.SENT
            await self._save_message(message)
            
            logger.info(f"Message sent successfully: {message.id}")
            
        except Exception as e:
            logger.error(f"Message processing failed: {e}")
            message.status = MessageStatus.FAILED
            message.error_message = str(e)
            message.retry_count += 1
            await self._save_message(message)
            
            # Retry if attempts remaining
            endpoint = await self._get_endpoint(message.endpoint_id)
            if endpoint and message.retry_count < endpoint['retry_attempts']:
                # Schedule retry with exponential backoff
                retry_delay = min(300, 2 ** message.retry_count * 10)  # Max 5 minutes
                await asyncio.sleep(retry_delay)
                asyncio.create_task(self._process_message(message))

    async def _get_endpoint(self, endpoint_id: str) -> Optional[Dict[str, Any]]:
        """Get endpoint configuration"""
        # Check cache first
        if endpoint_id in self.active_endpoints:
            return self.active_endpoints[endpoint_id].__dict__
        
        # Get from database
        async with db_manager.pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT * FROM integration_endpoints WHERE id = $1 AND is_active = TRUE
            """, endpoint_id)
            
            if row:
                endpoint_data = dict(row)
                endpoint_data['authentication'] = json.loads(endpoint_data['authentication'] or '{}')
                endpoint_data['custom_headers'] = json.loads(endpoint_data['custom_headers'] or '{}')
                endpoint_data['transformation_rules'] = json.loads(endpoint_data['transformation_rules'] or '{}')
                return endpoint_data
            
            return None

    async def _transform_message(self, message: IntegrationMessage, endpoint: Dict[str, Any]) -> str:
        """Transform message based on endpoint rules"""
        try:
            # Apply transformation rules
            transformation_rules = endpoint.get('transformation_rules', {})
            
            if message.message_format == MessageFormat.JSON:
                return await self._transform_json_message(message.raw_message, transformation_rules)
            elif message.message_format == MessageFormat.XML:
                return await self._transform_xml_message(message.raw_message, transformation_rules)
            elif message.message_format == MessageFormat.HL7_V2:
                return await self._transform_hl7_message(message.raw_message, transformation_rules)
            elif message.message_format == MessageFormat.EDI_X12:
                return await self._transform_edi_message(message.raw_message, transformation_rules)
            else:
                return message.raw_message
                
        except Exception as e:
            logger.error(f"Message transformation failed: {e}")
            return message.raw_message

    async def _transform_json_message(self, raw_message: str, rules: Dict[str, Any]) -> str:
        """Transform JSON message"""
        try:
            data = json.loads(raw_message)
            
            # Apply field mappings
            if 'field_mappings' in rules:
                for source_field, target_field in rules['field_mappings'].items():
                    if source_field in data:
                        data[target_field] = data.pop(source_field)
            
            # Apply value transformations
            if 'value_transformations' in rules:
                for field, transformation in rules['value_transformations'].items():
                    if field in data:
                        if transformation['type'] == 'format_date':
                            # Transform date format
                            from datetime import datetime
                            date_obj = datetime.fromisoformat(data[field])
                            data[field] = date_obj.strftime(transformation['format'])
                        elif transformation['type'] == 'lookup':
                            # Value lookup
                            lookup_table = transformation['lookup_table']
                            data[field] = lookup_table.get(data[field], data[field])
            
            return json.dumps(data)
            
        except Exception as e:
            logger.error(f"JSON transformation failed: {e}")
            return raw_message

    async def _transform_xml_message(self, raw_message: str, rules: Dict[str, Any]) -> str:
        """Transform XML message"""
        try:
            root = ET.fromstring(raw_message)
            
            # Apply XML transformations
            if 'xpath_mappings' in rules:
                for source_xpath, target_xpath in rules['xpath_mappings'].items():
                    source_elements = root.findall(source_xpath)
                    for element in source_elements:
                        # Simple transformation logic
                        element.tag = target_xpath.split('/')[-1]
            
            return ET.tostring(root, encoding='unicode')
            
        except Exception as e:
            logger.error(f"XML transformation failed: {e}")
            return raw_message

    async def _transform_hl7_message(self, raw_message: str, rules: Dict[str, Any]) -> str:
        """Transform HL7 message"""
        try:
            # Parse HL7 message
            segments = raw_message.split('\r')
            transformed_segments = []
            
            for segment in segments:
                if not segment:
                    continue
                
                fields = segment.split('|')
                segment_type = fields[0]
                
                # Apply segment-specific transformations
                if segment_type in rules.get('segment_mappings', {}):
                    mapping = rules['segment_mappings'][segment_type]
                    for field_index, new_value in mapping.items():
                        if int(field_index) < len(fields):
                            fields[int(field_index)] = new_value
                
                transformed_segments.append('|'.join(fields))
            
            return '\r'.join(transformed_segments)
            
        except Exception as e:
            logger.error(f"HL7 transformation failed: {e}")
            return raw_message

    async def _transform_edi_message(self, raw_message: str, rules: Dict[str, Any]) -> str:
        """Transform EDI message"""
        try:
            # Basic EDI transformation
            # In production, use proper EDI parsing library
            segments = raw_message.split('~')
            transformed_segments = []
            
            for segment in segments:
                if not segment:
                    continue
                
                elements = segment.split('*')
                segment_id = elements[0] if elements else ''
                
                # Apply segment transformations
                if segment_id in rules.get('edi_mappings', {}):
                    mapping = rules['edi_mappings'][segment_id]
                    for element_index, new_value in mapping.items():
                        if int(element_index) < len(elements):
                            elements[int(element_index)] = new_value
                
                transformed_segments.append('*'.join(elements))
            
            return '~'.join(transformed_segments)
            
        except Exception as e:
            logger.error(f"EDI transformation failed: {e}")
            return raw_message

    async def _send_fhir_message(self, message: IntegrationMessage, endpoint: Dict[str, Any]):
        """Send FHIR message"""
        headers = {
            'Content-Type': 'application/fhir+json',
            'Accept': 'application/fhir+json'
        }
        headers.update(endpoint.get('custom_headers', {}))
        
        # Add authentication
        auth_config = endpoint.get('authentication', {})
        if auth_config.get('type') == 'bearer_token':
            headers['Authorization'] = f"Bearer {auth_config['token']}"
        elif auth_config.get('type') == 'api_key':
            headers[auth_config['header_name']] = auth_config['api_key']
        
        async with httpx.AsyncClient(timeout=endpoint['timeout_seconds']) as client:
            response = await client.post(
                endpoint['endpoint_url'],
                content=message.processed_message or message.raw_message,
                headers=headers
            )
            
            if response.status_code not in [200, 201, 202]:
                raise Exception(f"FHIR API error: {response.status_code} - {response.text}")

    async def _send_hl7_message(self, message: IntegrationMessage, endpoint: Dict[str, Any]):
        """Send HL7 message"""
        # HL7 typically uses MLLP (Minimal Lower Layer Protocol)
        # For HTTP-based HL7, use REST API approach
        headers = {
            'Content-Type': 'application/hl7-v2',
            'Accept': 'application/hl7-v2'
        }
        headers.update(endpoint.get('custom_headers', {}))
        
        async with httpx.AsyncClient(timeout=endpoint['timeout_seconds']) as client:
            response = await client.post(
                endpoint['endpoint_url'],
                content=message.processed_message or message.raw_message,
                headers=headers
            )
            
            if response.status_code not in [200, 201, 202]:
                raise Exception(f"HL7 API error: {response.status_code} - {response.text}")

    async def _send_edi_message(self, message: IntegrationMessage, endpoint: Dict[str, Any]):
        """Send EDI message"""
        headers = {
            'Content-Type': 'application/edi-x12',
            'Accept': 'application/edi-x12'
        }
        headers.update(endpoint.get('custom_headers', {}))
        
        async with httpx.AsyncClient(timeout=endpoint['timeout_seconds']) as client:
            response = await client.post(
                endpoint['endpoint_url'],
                content=message.processed_message or message.raw_message,
                headers=headers
            )
            
            if response.status_code not in [200, 201, 202]:
                raise Exception(f"EDI API error: {response.status_code} - {response.text}")

    async def _send_rest_api_message(self, message: IntegrationMessage, endpoint: Dict[str, Any]):
        """Send REST API message"""
        headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
        headers.update(endpoint.get('custom_headers', {}))
        
        # Add authentication
        auth_config = endpoint.get('authentication', {})
        if auth_config.get('type') == 'bearer_token':
            headers['Authorization'] = f"Bearer {auth_config['token']}"
        elif auth_config.get('type') == 'api_key':
            headers[auth_config['header_name']] = auth_config['api_key']
        elif auth_config.get('type') == 'basic_auth':
            import base64
            credentials = base64.b64encode(f"{auth_config['username']}:{auth_config['password']}".encode()).decode()
            headers['Authorization'] = f"Basic {credentials}"
        
        async with httpx.AsyncClient(timeout=endpoint['timeout_seconds']) as client:
            response = await client.post(
                endpoint['endpoint_url'],
                content=message.processed_message or message.raw_message,
                headers=headers
            )
            
            if response.status_code not in [200, 201, 202]:
                raise Exception(f"REST API error: {response.status_code} - {response.text}")

    async def _send_webhook_message(self, message: IntegrationMessage, endpoint: Dict[str, Any]):
        """Send webhook message"""
        headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'Healthcare-Platform-Integration/1.0'
        }
        headers.update(endpoint.get('custom_headers', {}))
        
        # Add webhook signature if secret is configured
        auth_config = endpoint.get('authentication', {})
        if auth_config.get('secret_key'):
            signature = hmac.new(
                auth_config['secret_key'].encode(),
                (message.processed_message or message.raw_message).encode(),
                hashlib.sha256
            ).hexdigest()
            headers['X-Webhook-Signature'] = f"sha256={signature}"
        
        async with httpx.AsyncClient(timeout=endpoint['timeout_seconds']) as client:
            response = await client.post(
                endpoint['endpoint_url'],
                content=message.processed_message or message.raw_message,
                headers=headers
            )
            
            if response.status_code not in [200, 201, 202]:
                raise Exception(f"Webhook error: {response.status_code} - {response.text}")

    async def create_fhir_resource(self, resource: FHIRResource) -> str:
        """Create FHIR resource"""
        resource_id = str(uuid.uuid4())
        
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO fhir_resources 
                (id, resource_type, resource_id, resource_data, version, tenant_id)
                VALUES ($1, $2, $3, $4, $5, $6)
            """, resource_id, resource.resource_type, resource.resource_id,
                json.dumps(resource.resource_data), resource.version, resource.tenant_id)
        
        logger.info(f"Created FHIR resource: {resource.resource_type}/{resource_id}")
        return resource_id

    async def process_hl7_message(self, hl7_message: HL7Message) -> Dict[str, Any]:
        """Process HL7 message"""
        try:
            # Parse HL7 message segments
            processed_data = {
                'message_type': hl7_message.message_type,
                'control_id': hl7_message.message_control_id,
                'sending_app': hl7_message.sending_application,
                'receiving_app': hl7_message.receiving_application,
                'segments': hl7_message.message_segments,
                'processed_at': datetime.utcnow().isoformat()
            }
            
            # Extract patient information if ADT message
            if hl7_message.message_type.startswith('ADT'):
                patient_data = self._extract_patient_from_hl7(hl7_message.message_segments)
                if patient_data:
                    processed_data['patient'] = patient_data
            
            # Extract order information if ORM message
            elif hl7_message.message_type.startswith('ORM'):
                order_data = self._extract_order_from_hl7(hl7_message.message_segments)
                if order_data:
                    processed_data['order'] = order_data
            
            return processed_data
            
        except Exception as e:
            logger.error(f"HL7 message processing failed: {e}")
            raise HTTPException(status_code=400, detail=f"HL7 processing error: {str(e)}")

    def _extract_patient_from_hl7(self, segments: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """Extract patient data from HL7 segments"""
        for segment in segments:
            if segment.get('segment_type') == 'PID':
                # Extract patient demographics from PID segment
                fields = segment.get('fields', [])
                if len(fields) > 5:
                    return {
                        'patient_id': fields[3] if len(fields) > 3 else None,
                        'name': fields[5] if len(fields) > 5 else None,
                        'birth_date': fields[7] if len(fields) > 7 else None,
                        'gender': fields[8] if len(fields) > 8 else None,
                        'address': fields[11] if len(fields) > 11 else None
                    }
        return None

    def _extract_order_from_hl7(self, segments: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """Extract order data from HL7 segments"""
        for segment in segments:
            if segment.get('segment_type') == 'ORC':
                # Extract order control from ORC segment
                fields = segment.get('fields', [])
                if len(fields) > 2:
                    return {
                        'order_control': fields[1] if len(fields) > 1 else None,
                        'order_number': fields[2] if len(fields) > 2 else None,
                        'order_status': fields[5] if len(fields) > 5 else None
                    }
        return None

    async def process_edi_transaction(self, edi_transaction: EDITransaction) -> Dict[str, Any]:
        """Process EDI transaction"""
        try:
            processed_data = {
                'transaction_set': edi_transaction.transaction_set,
                'control_number': edi_transaction.control_number,
                'sender_id': edi_transaction.sender_id,
                'receiver_id': edi_transaction.receiver_id,
                'transaction_data': edi_transaction.transaction_data,
                'processed_at': datetime.utcnow().isoformat()
            }
            
            # Process based on transaction set
            if edi_transaction.transaction_set == '837':
                # Healthcare Claim
                processed_data['claim_data'] = self._process_837_claim(edi_transaction.transaction_data)
            elif edi_transaction.transaction_set == '835':
                # Healthcare Claim Payment/Advice
                processed_data['payment_data'] = self._process_835_payment(edi_transaction.transaction_data)
            elif edi_transaction.transaction_set == '270':
                # Healthcare Eligibility Inquiry
                processed_data['eligibility_inquiry'] = self._process_270_inquiry(edi_transaction.transaction_data)
            elif edi_transaction.transaction_set == '271':
                # Healthcare Eligibility Response
                processed_data['eligibility_response'] = self._process_271_response(edi_transaction.transaction_data)
            
            return processed_data
            
        except Exception as e:
            logger.error(f"EDI transaction processing failed: {e}")
            raise HTTPException(status_code=400, detail=f"EDI processing error: {str(e)}")

    def _process_837_claim(self, transaction_data: Dict[str, Any]) -> Dict[str, Any]:
        """Process 837 Healthcare Claim"""
        return {
            'claim_type': 'professional',  # or institutional
            'patient_info': transaction_data.get('patient', {}),
            'provider_info': transaction_data.get('provider', {}),
            'services': transaction_data.get('services', []),
            'total_amount': transaction_data.get('total_amount', 0)
        }

    def _process_835_payment(self, transaction_data: Dict[str, Any]) -> Dict[str, Any]:
        """Process 835 Healthcare Payment"""
        return {
            'payment_method': transaction_data.get('payment_method'),
            'payment_amount': transaction_data.get('payment_amount', 0),
            'payment_date': transaction_data.get('payment_date'),
            'claims': transaction_data.get('claims', [])
        }

    def _process_270_inquiry(self, transaction_data: Dict[str, Any]) -> Dict[str, Any]:
        """Process 270 Eligibility Inquiry"""
        return {
            'subscriber_info': transaction_data.get('subscriber', {}),
            'provider_info': transaction_data.get('provider', {}),
            'service_types': transaction_data.get('service_types', [])
        }

    def _process_271_response(self, transaction_data: Dict[str, Any]) -> Dict[str, Any]:
        """Process 271 Eligibility Response"""
        return {
            'eligibility_status': transaction_data.get('status'),
            'coverage_info': transaction_data.get('coverage', {}),
            'benefits': transaction_data.get('benefits', []),
            'limitations': transaction_data.get('limitations', [])
        }

    async def create_webhook_subscription(self, subscription: WebhookSubscription) -> str:
        """Create webhook subscription"""
        subscription.id = str(uuid.uuid4())
        
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO webhook_subscriptions 
                (id, endpoint_url, event_types, secret_key, is_active, retry_attempts, tenant_id, created_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """, subscription.id, subscription.endpoint_url, subscription.event_types,
                subscription.secret_key, subscription.is_active, subscription.retry_attempts,
                subscription.tenant_id, subscription.created_by)
        
        logger.info(f"Created webhook subscription: {subscription.id}")
        return subscription.id

integration_manager = IntegrationManager()

# Lifespan manager
@asynccontextmanager
async def lifespan(app: FastAPI):
    await db_manager.connect()
    yield
    await db_manager.disconnect()

app = FastAPI(
    title="Healthcare Claims Platform - Integration Service",
    description="FHIR, HL7, EDI integration with real-time data synchronization",
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
@app.post("/endpoints", status_code=status.HTTP_201_CREATED)
async def create_endpoint(endpoint: IntegrationEndpoint,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Create integration endpoint"""
    endpoint_id = await integration_manager.create_endpoint(endpoint)
    return {"endpoint_id": endpoint_id}

@app.get("/endpoints")
async def get_endpoints(tenant_id: str = Query(...),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get integration endpoints"""
    async with db_manager.pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT * FROM integration_endpoints WHERE tenant_id = $1 ORDER BY created_at DESC
        """, tenant_id)
        return {"endpoints": [dict(row) for row in rows]}

@app.post("/messages/send", status_code=status.HTTP_201_CREATED)
async def send_message(message: IntegrationMessage,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Send integration message"""
    message_id = await integration_manager.send_message(message)
    return {"message_id": message_id}

@app.get("/messages")
async def get_messages(tenant_id: str = Query(...), 
                      endpoint_id: Optional[str] = None,
                      status: Optional[MessageStatus] = None,
                      limit: int = Query(100, le=1000),
                          current_user: TokenPayload = Depends(get_current_user),
                      ):
    """Get integration messages"""
    query = "SELECT * FROM integration_messages WHERE tenant_id = $1"
    params = [tenant_id]
    
    if endpoint_id:
        query += f" AND endpoint_id = ${len(params) + 1}"
        params.append(endpoint_id)
    
    if status:
        query += f" AND status = ${len(params) + 1}"
        params.append(status.value)
    
    query += f" ORDER BY created_at DESC LIMIT ${len(params) + 1}"
    params.append(limit)
    
    async with db_manager.pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
        return {"messages": [dict(row) for row in rows]}

@app.post("/fhir/resources", status_code=status.HTTP_201_CREATED)
async def create_fhir_resource(resource: FHIRResource,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Create FHIR resource"""
    resource_id = await integration_manager.create_fhir_resource(resource)
    return {"resource_id": resource_id}

@app.get("/fhir/resources")
async def get_fhir_resources(tenant_id: str = Query(...), 
                            resource_type: Optional[str] = None,
                                current_user: TokenPayload = Depends(get_current_user),
                            ):
    """Get FHIR resources"""
    query = "SELECT * FROM fhir_resources WHERE tenant_id = $1"
    params = [tenant_id]
    
    if resource_type:
        query += f" AND resource_type = ${len(params) + 1}"
        params.append(resource_type)
    
    query += " ORDER BY created_at DESC"
    
    async with db_manager.pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
        return {"resources": [dict(row) for row in rows]}

@app.post("/hl7/process")
async def process_hl7_message(hl7_message: HL7Message,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Process HL7 message"""
    result = await integration_manager.process_hl7_message(hl7_message)
    return result

@app.post("/edi/process")
async def process_edi_transaction(edi_transaction: EDITransaction,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Process EDI transaction"""
    result = await integration_manager.process_edi_transaction(edi_transaction)
    return result

@app.post("/webhooks/subscribe", status_code=status.HTTP_201_CREATED)
async def create_webhook_subscription(subscription: WebhookSubscription,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Create webhook subscription"""
    subscription_id = await integration_manager.create_webhook_subscription(subscription)
    return {"subscription_id": subscription_id}

@app.get("/webhooks/subscriptions")
async def get_webhook_subscriptions(tenant_id: str = Query(...),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get webhook subscriptions"""
    async with db_manager.pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT * FROM webhook_subscriptions WHERE tenant_id = $1 ORDER BY created_at DESC
        """, tenant_id)
        return {"subscriptions": [dict(row) for row in rows]}

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "integration"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8010)