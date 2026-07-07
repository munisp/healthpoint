"""
Healthcare Claims Platform - Configuration Service
Centralized configuration management with versioning, encryption, and multi-tenant support.

Author: Manus AI
Date: October 8, 2025
Port: 8012
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

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks, status, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
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
import hashlib
import base64
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import yaml
from shared.telemetry import setup_telemetry, instrument_fastapi, get_tracer

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.environ["DATABASE_URL"]
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY", "your-secret-key-here")

class ConfigType(str, Enum):
    STRING = "string"
    INTEGER = "integer"
    FLOAT = "float"
    BOOLEAN = "boolean"
    JSON = "json"
    ENCRYPTED = "encrypted"
    FILE_PATH = "file_path"
    URL = "url"
    EMAIL = "email"

class ConfigScope(str, Enum):
    GLOBAL = "global"
    TENANT = "tenant"
    SERVICE = "service"
    USER = "user"
    ENVIRONMENT = "environment"

class ConfigStatus(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    DEPRECATED = "deprecated"
    DRAFT = "draft"

# Pydantic Models
class ConfigurationItem(BaseModel):
    key: str = Field(..., regex=r'^[a-zA-Z0-9_\-\.]+$')
    value: Any
    config_type: ConfigType
    scope: ConfigScope
    tenant_id: Optional[str] = None
    service_name: Optional[str] = None
    environment: str = Field(default="production")
    description: Optional[str] = None
    is_sensitive: bool = False
    is_required: bool = False
    default_value: Optional[Any] = None
    validation_rules: Dict[str, Any] = {}
    tags: List[str] = []
    created_by: str
    
    @validator('key')
    def validate_key(cls, v):
        if len(v) < 1 or len(v) > 255:
            raise ValueError('Key must be between 1 and 255 characters')
        return v

class ConfigurationUpdate(BaseModel):
    value: Any
    description: Optional[str] = None
    tags: List[str] = []
    updated_by: str

class ConfigurationBatch(BaseModel):
    configurations: List[ConfigurationItem]
    batch_description: Optional[str] = None
    created_by: str

class ConfigurationTemplate(BaseModel):
    name: str
    description: str
    template_data: Dict[str, Any]
    scope: ConfigScope
    created_by: str

class ConfigurationExport(BaseModel):
    format: str = Field(default="json", regex=r'^(json|yaml|env)$')
    scope: Optional[ConfigScope] = None
    tenant_id: Optional[str] = None
    service_name: Optional[str] = None
    environment: Optional[str] = None
    include_sensitive: bool = False

# Encryption Manager
class EncryptionManager:
    def __init__(self, key: str):
        self.key = key.encode()
        self.fernet = self._create_fernet()

    def _create_fernet(self):
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b'healthcare_platform_salt',
            iterations=100000,
        )
        key = base64.urlsafe_b64encode(kdf.derive(self.key))
        return Fernet(key)

    def encrypt(self, data: str) -> str:
        """Encrypt sensitive data"""
        return self.fernet.encrypt(data.encode()).decode()

    def decrypt(self, encrypted_data: str) -> str:
        """Decrypt sensitive data"""
        return self.fernet.decrypt(encrypted_data.encode()).decode()

encryption_manager = EncryptionManager(ENCRYPTION_KEY)

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
                CREATE TABLE IF NOT EXISTS configurations (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    key VARCHAR(255) NOT NULL,
                    value TEXT,
                    config_type VARCHAR(20) NOT NULL,
                    scope VARCHAR(20) NOT NULL,
                    tenant_id VARCHAR(255),
                    service_name VARCHAR(255),
                    environment VARCHAR(50) NOT NULL DEFAULT 'production',
                    description TEXT,
                    is_sensitive BOOLEAN DEFAULT FALSE,
                    is_required BOOLEAN DEFAULT FALSE,
                    default_value TEXT,
                    validation_rules JSONB,
                    tags TEXT[],
                    status VARCHAR(20) DEFAULT 'active',
                    version INTEGER DEFAULT 1,
                    created_by VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_by VARCHAR(255),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(key, scope, tenant_id, service_name, environment)
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS configuration_history (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    configuration_id UUID NOT NULL,
                    key VARCHAR(255) NOT NULL,
                    old_value TEXT,
                    new_value TEXT,
                    changed_by VARCHAR(255) NOT NULL,
                    changed_at TIMESTAMP DEFAULT NOW(),
                    change_reason TEXT
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS configuration_templates (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name VARCHAR(255) NOT NULL,
                    description TEXT,
                    template_data JSONB NOT NULL,
                    scope VARCHAR(20) NOT NULL,
                    created_by VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(name, scope)
                );
            """)
            
            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_configurations_key ON configurations(key);
                CREATE INDEX IF NOT EXISTS idx_configurations_scope ON configurations(scope);
                CREATE INDEX IF NOT EXISTS idx_configurations_tenant ON configurations(tenant_id);
                CREATE INDEX IF NOT EXISTS idx_configurations_service ON configurations(service_name);
                CREATE INDEX IF NOT EXISTS idx_configurations_environment ON configurations(environment);
                CREATE INDEX IF NOT EXISTS idx_configuration_history_config_id ON configuration_history(configuration_id);
            """)

db_manager = DatabaseManager()

# Configuration Manager
class ConfigurationManager:
    def __init__(self):
        self.redis_client = None
        self.cache_ttl = 300  # 5 minutes

    async def _get_redis_client(self):
        if not self.redis_client:
            self.redis_client = get_redis_client()
        return self.redis_client

    async def create_configuration(self, config: ConfigurationItem) -> str:
        """Create a new configuration item"""
        # Validate configuration
        await self._validate_configuration(config)
        
        # Encrypt sensitive values
        value = config.value
        if config.is_sensitive and config.config_type == ConfigType.ENCRYPTED:
            value = encryption_manager.encrypt(str(value))
        
        async with db_manager.pool.acquire() as conn:
            config_id = await conn.fetchval("""
                INSERT INTO configurations 
                (key, value, config_type, scope, tenant_id, service_name, environment,
                 description, is_sensitive, is_required, default_value, validation_rules,
                 tags, created_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                RETURNING id
            """, 
            config.key, str(value), config.config_type.value, config.scope.value,
            config.tenant_id, config.service_name, config.environment,
            config.description, config.is_sensitive, config.is_required,
            str(config.default_value) if config.default_value else None,
            json.dumps(config.validation_rules), config.tags, config.created_by)
        
        # Clear cache
        await self._clear_cache(config.key, config.scope, config.tenant_id, 
                               config.service_name, config.environment)
        
        logger.info(f"Created configuration: {config.key}")
        return str(config_id)

    async def get_configuration(self, key: str, scope: ConfigScope, 
                               tenant_id: Optional[str] = None,
                               service_name: Optional[str] = None,
                               environment: str = "production") -> Optional[Dict[str, Any]]:
        """Get configuration value"""
        # Check cache first
        cache_key = self._build_cache_key(key, scope, tenant_id, service_name, environment)
        redis_client = await self._get_redis_client()
        cached_value = await redis_client.get(cache_key)
        
        if cached_value:
            config_data = json.loads(cached_value)
            return self._process_configuration_value(config_data)
        
        # Get from database
        async with db_manager.pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT * FROM configurations 
                WHERE key = $1 AND scope = $2 AND 
                      COALESCE(tenant_id, '') = COALESCE($3, '') AND
                      COALESCE(service_name, '') = COALESCE($4, '') AND
                      environment = $5 AND status = 'active'
            """, key, scope.value, tenant_id or '', service_name or '', environment)
            
            if not row:
                return None
            
            config_data = dict(row)
            
            # Cache the result
            await redis_client.setex(cache_key, self.cache_ttl, json.dumps(config_data, default=str))
            
            return self._process_configuration_value(config_data)

    def _process_configuration_value(self, config_data: Dict[str, Any]) -> Dict[str, Any]:
        """Process configuration value based on type"""
        value = config_data['value']
        config_type = config_data['config_type']
        is_sensitive = config_data['is_sensitive']
        
        # Decrypt sensitive values
        if is_sensitive and config_type == 'encrypted':
            try:
                value = encryption_manager.decrypt(value)
            except Exception as e:
                logger.error(f"Failed to decrypt configuration: {e}")
                value = None
        
        # Convert value based on type
        if config_type == 'integer':
            value = int(value) if value else None
        elif config_type == 'float':
            value = float(value) if value else None
        elif config_type == 'boolean':
            value = value.lower() in ('true', '1', 'yes', 'on') if value else False
        elif config_type == 'json':
            try:
                value = json.loads(value) if value else None
            except json.JSONDecodeError:
                value = None
        
        config_data['processed_value'] = value
        return config_data

    async def update_configuration(self, key: str, scope: ConfigScope, 
                                  update: ConfigurationUpdate,
                                  tenant_id: Optional[str] = None,
                                  service_name: Optional[str] = None,
                                  environment: str = "production") -> bool:
        """Update configuration value"""
        async with db_manager.pool.acquire() as conn:
            # Get current configuration
            current_config = await conn.fetchrow("""
                SELECT * FROM configurations 
                WHERE key = $1 AND scope = $2 AND 
                      COALESCE(tenant_id, '') = COALESCE($3, '') AND
                      COALESCE(service_name, '') = COALESCE($4, '') AND
                      environment = $5 AND status = 'active'
            """, key, scope.value, tenant_id or '', service_name or '', environment)
            
            if not current_config:
                return False
            
            # Encrypt sensitive values
            new_value = update.value
            if current_config['is_sensitive'] and current_config['config_type'] == 'encrypted':
                new_value = encryption_manager.encrypt(str(update.value))
            
            # Record history
            await conn.execute("""
                INSERT INTO configuration_history 
                (configuration_id, key, old_value, new_value, changed_by)
                VALUES ($1, $2, $3, $4, $5)
            """, current_config['id'], key, current_config['value'], 
                str(new_value), update.updated_by)
            
            # Update configuration
            await conn.execute("""
                UPDATE configurations 
                SET value = $1, description = COALESCE($2, description),
                    tags = COALESCE($3, tags), updated_by = $4, 
                    updated_at = NOW(), version = version + 1
                WHERE id = $5
            """, str(new_value), update.description, update.tags, 
                update.updated_by, current_config['id'])
        
        # Clear cache
        await self._clear_cache(key, scope, tenant_id, service_name, environment)
        
        logger.info("Updated configuration: $1", key)
        return True

    async def delete_configuration(self, key: str, scope: ConfigScope,
                                  tenant_id: Optional[str] = None,
                                  service_name: Optional[str] = None,
                                  environment: str = "production") -> bool:
        """Delete configuration (mark as inactive)"""
        async with db_manager.pool.acquire() as conn:
            result = await conn.execute("""
                UPDATE configurations 
                SET status = 'inactive', updated_at = NOW()
                WHERE key = $1 AND scope = $2 AND 
                      COALESCE(tenant_id, '') = COALESCE($3, '') AND
                      COALESCE(service_name, '') = COALESCE($4, '') AND
                      environment = $5 AND status = 'active'
            """, key, scope.value, tenant_id or '', service_name or '', environment)
        
        # Clear cache
        await self._clear_cache(key, scope, tenant_id, service_name, environment)
        
        return result != "UPDATE 0"

    async def list_configurations(self, scope: Optional[ConfigScope] = None,
                                 tenant_id: Optional[str] = None,
                                 service_name: Optional[str] = None,
                                 environment: Optional[str] = None,
                                 tags: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        """List configurations with filters"""
        query = "SELECT * FROM configurations WHERE status = 'active'"
        params = []
        param_count = 0
        
        if scope:
            param_count += 1
            query += f" AND scope = ${param_count}"
            params.append(scope.value)
        
        if tenant_id:
            param_count += 1
            query += f" AND tenant_id = ${param_count}"
            params.append(tenant_id)
        
        if service_name:
            param_count += 1
            query += f" AND service_name = ${param_count}"
            params.append(service_name)
        
        if environment:
            param_count += 1
            query += f" AND environment = ${param_count}"
            params.append(environment)
        
        if tags:
            param_count += 1
            query += f" AND tags && ${param_count}"
            params.append(tags)
        
        query += " ORDER BY key"
        
        async with db_manager.pool.acquire() as conn:
            rows = await conn.fetch(query, *params)
            
            configurations = []
            for row in rows:
                config_data = dict(row)
                # Don't expose sensitive values in list
                if config_data['is_sensitive']:
                    config_data['value'] = '[REDACTED]'
                configurations.append(config_data)
            
            return configurations

    async def export_configurations(self, export_request: ConfigurationExport) -> str:
        """Export configurations in specified format"""
        configurations = await self.list_configurations(
            scope=export_request.scope,
            tenant_id=export_request.tenant_id,
            service_name=export_request.service_name,
            environment=export_request.environment
        )
        
        # Process configurations for export
        export_data = {}
        for config in configurations:
            key = config['key']
            
            if config['is_sensitive'] and not export_request.include_sensitive:
                continue
            
            # Get processed value
            processed_config = self._process_configuration_value(config)
            export_data[key] = processed_config['processed_value']
        
        # Format output
        if export_request.format == 'json':
            return json.dumps(export_data, indent=2, default=str)
        elif export_request.format == 'yaml':
            return yaml.dump(export_data, default_flow_style=False)
        elif export_request.format == 'env':
            env_lines = []
            for key, value in export_data.items():
                env_key = key.upper().replace('.', '_').replace('-', '_')
                env_lines.append(f"{env_key}={value}")
            return '\n'.join(env_lines)
        
        return json.dumps(export_data, indent=2, default=str)

    async def _validate_configuration(self, config: ConfigurationItem):
        """Validate configuration item"""
        # Type validation
        if config.config_type == ConfigType.INTEGER:
            try:
                int(config.value)
            except (ValueError, TypeError):
                raise ValueError("Value must be an integer")
        elif config.config_type == ConfigType.FLOAT:
            try:
                float(config.value)
            except (ValueError, TypeError):
                raise ValueError("Value must be a float")
        elif config.config_type == ConfigType.BOOLEAN:
            if not isinstance(config.value, bool) and str(config.value).lower() not in ('true', 'false', '1', '0', 'yes', 'no'):
                raise ValueError("Value must be a boolean")
        elif config.config_type == ConfigType.JSON:
            try:
                json.loads(str(config.value))
            except json.JSONDecodeError:
                raise ValueError("Value must be valid JSON")
        elif config.config_type == ConfigType.EMAIL:
            import re
            email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
            if not re.match(email_pattern, str(config.value)):
                raise ValueError("Value must be a valid email address")
        elif config.config_type == ConfigType.URL:
            import re
            url_pattern = r'^https?://[^\s/$.?#].[^\s]*$'
            if not re.match(url_pattern, str(config.value)):
                raise ValueError("Value must be a valid URL")
        
        # Custom validation rules
        if config.validation_rules:
            await self._apply_validation_rules(config.value, config.validation_rules)

    async def _apply_validation_rules(self, value: Any, rules: Dict[str, Any]):
        """Apply custom validation rules"""
        if 'min_length' in rules:
            if len(str(value)) < rules['min_length']:
                raise ValueError(f"Value must be at least {rules['min_length']} characters")
        
        if 'max_length' in rules:
            if len(str(value)) > rules['max_length']:
                raise ValueError(f"Value must be at most {rules['max_length']} characters")
        
        if 'min_value' in rules:
            if float(value) < rules['min_value']:
                raise ValueError(f"Value must be at least {rules['min_value']}")
        
        if 'max_value' in rules:
            if float(value) > rules['max_value']:
                raise ValueError(f"Value must be at most {rules['max_value']}")
        
        if 'allowed_values' in rules:
            if value not in rules['allowed_values']:
                raise ValueError(f"Value must be one of: {', '.join(rules['allowed_values'])}")
        
        if 'regex' in rules:
            import re
            if not re.match(rules['regex'], str(value)):
                raise ValueError(f"Value must match pattern: {rules['regex']}")

    def _build_cache_key(self, key: str, scope: ConfigScope, 
                        tenant_id: Optional[str], service_name: Optional[str], 
                        environment: str) -> str:
        """Build cache key for configuration"""
        parts = [key, scope.value, tenant_id or '', service_name or '', environment]
        return f"config:{':'.join(parts)}"

    async def _clear_cache(self, key: str, scope: ConfigScope,
                          tenant_id: Optional[str], service_name: Optional[str],
                          environment: str):
        """Clear configuration cache"""
        cache_key = self._build_cache_key(key, scope, tenant_id, service_name, environment)
        redis_client = await self._get_redis_client()
        await redis_client.delete(cache_key)

config_manager = ConfigurationManager()

# Security
security = HTTPBearer()

async def verify_token(credentials: HTTPAuthorizationCredentials = Security(security)):
    """Verify JWT token (simplified)"""
    # In production, implement proper JWT verification
    return {"user_id": "admin", "tenant_id": "default"}

# Lifespan manager
@asynccontextmanager
async def lifespan(app: FastAPI):
    await db_manager.connect()
    yield
    await db_manager.disconnect()

setup_telemetry(service_name="configuration-service", service_version="1.0.0")
app = FastAPI(
instrument_fastapi(app)

app.middleware("http")(security_headers_middleware)
    title="Healthcare Claims Platform - Configuration Service",
    description="Centralized configuration management with versioning and encryption",
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
@app.post("/configurations", status_code=status.HTTP_201_CREATED)
async def create_configuration(config: ConfigurationItem, user: dict = Depends(verify_token),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Create a new configuration item"""
    config.created_by = user["user_id"]
    config_id = await config_manager.create_configuration(config)
    return {"configuration_id": config_id}

@app.get("/configurations/{key}")
async def get_configuration(key: str, scope: ConfigScope, 
                           tenant_id: Optional[str] = None,
                           service_name: Optional[str] = None,
                           environment: str = "production",
                           user: dict = Depends(verify_token),
                               current_user: TokenPayload = Depends(get_current_user),
                           ):
    """Get configuration value"""
    config = await config_manager.get_configuration(key, scope, tenant_id, service_name, environment)
    if not config:
        raise HTTPException(status_code=404, detail="Configuration not found")
    return config

@app.put("/configurations/{key}")
async def update_configuration(key: str, scope: ConfigScope, update: ConfigurationUpdate,
                              tenant_id: Optional[str] = None,
                              service_name: Optional[str] = None,
                              environment: str = "production",
                              user: dict = Depends(verify_token),
                                  current_user: TokenPayload = Depends(get_current_user),
                              ):
    """Update configuration value"""
    update.updated_by = user["user_id"]
    success = await config_manager.update_configuration(key, scope, update, tenant_id, service_name, environment)
    if not success:
        raise HTTPException(status_code=404, detail="Configuration not found")
    return {"message": "Configuration updated successfully"}

@app.delete("/configurations/{key}")
async def delete_configuration(key: str, scope: ConfigScope,
                              tenant_id: Optional[str] = None,
                              service_name: Optional[str] = None,
                              environment: str = "production",
                              user: dict = Depends(verify_token),
                                  current_user: TokenPayload = Depends(get_current_user),
                              ):
    """Delete configuration"""
    success = await config_manager.delete_configuration(key, scope, tenant_id, service_name, environment)
    if not success:
        raise HTTPException(status_code=404, detail="Configuration not found")
    return {"message": "Configuration deleted successfully"}

@app.get("/configurations")
async def list_configurations(scope: Optional[ConfigScope] = None,
                             tenant_id: Optional[str] = None,
                             service_name: Optional[str] = None,
                             environment: Optional[str] = None,
                             tags: Optional[str] = None,
                             user: dict = Depends(verify_token),
                                 current_user: TokenPayload = Depends(get_current_user),
                             ):
    """List configurations with filters"""
    tag_list = tags.split(',') if tags else None
    configurations = await config_manager.list_configurations(scope, tenant_id, service_name, environment, tag_list)
    return {"configurations": configurations}

@app.post("/configurations/batch")
async def create_configurations_batch(batch: ConfigurationBatch, user: dict = Depends(verify_token),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Create multiple configurations in batch"""
    results = []
    for config in batch.configurations:
        config.created_by = user["user_id"]
        try:
            config_id = await config_manager.create_configuration(config)
            results.append({"key": config.key, "status": "success", "id": config_id})
        except Exception as e:
            results.append({"key": config.key, "status": "error", "error": str(e)})
    
    return {"results": results}

@app.post("/configurations/export")
async def export_configurations(export_request: ConfigurationExport, user: dict = Depends(verify_token),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Export configurations in specified format"""
    export_data = await config_manager.export_configurations(export_request)
    return {"data": export_data, "format": export_request.format}

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "configuration"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8012)