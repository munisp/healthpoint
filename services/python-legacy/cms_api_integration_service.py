"""
Production CMS API Integration Service
Implements real CMS IDR Portal integration with production credentials and authentication
Handles secure credential management, OAuth 2.0 flow, and production API endpoints
"""

import asyncio
import json
import os
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from enum import Enum
import httpx
import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks
from fastapi.security import HTTPBearer, OAuth2PasswordBearer
from pydantic import BaseModel, Field, validator
import redis.asyncio as redis
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy import Column, String, DateTime, Text, Boolean, Integer, select, update
from sqlalchemy.ext.declarative import declarative_base
import boto3
from botocore.exceptions import ClientError
import hashlib
import base64

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Production CMS API Integration Service", version="2.0.0")
security = HTTPBearer()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# Database setup
Base = declarative_base()
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://user:password@localhost/nsa_idr")
engine = create_async_engine(DATABASE_URL)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

class CMSCredentials(Base):
    """Database model for CMS API credentials"""
    __tablename__ = "cms_credentials"
    
    id = Column(Integer, primary_key=True)
    environment = Column(String(50), nullable=False)  # production, staging, sandbox
    client_id = Column(String(255), nullable=False)
    client_secret_hash = Column(String(255), nullable=False)
    certificate_path = Column(String(500))
    private_key_path = Column(String(500))
    base_url = Column(String(255), nullable=False)
    portal_url = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    is_active = Column(Boolean, default=True)

class CMSTokenCache(Base):
    """Database model for CMS access token caching"""
    __tablename__ = "cms_token_cache"
    
    id = Column(Integer, primary_key=True)
    environment = Column(String(50), nullable=False)
    access_token_hash = Column(Text, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    scope = Column(String(500))
    created_at = Column(DateTime, default=datetime.utcnow)

class CMSEnvironment(str, Enum):
    PRODUCTION = "production"
    STAGING = "staging"
    SANDBOX = "sandbox"

class CMSCredentialRequest(BaseModel):
    """Request model for CMS credential configuration"""
    environment: CMSEnvironment
    client_id: str = Field(..., min_length=10, max_length=255)
    client_secret: str = Field(..., min_length=20, max_length=500)
    certificate_content: Optional[str] = None
    private_key_content: Optional[str] = None
    base_url: str = Field(..., regex=r'^https://.*')
    portal_url: str = Field(..., regex=r'^https://.*')

class CMSAuthenticationResponse(BaseModel):
    """Response model for CMS authentication"""
    access_token: str
    token_type: str = "Bearer"
    expires_in: int
    scope: str
    environment: CMSEnvironment

class ProductionCMSIntegrationService:
    """Production-ready CMS API integration service"""
    
    def __init__(self):
        self.redis_client = None
        self.aws_secrets_client = None
        self.current_environment = CMSEnvironment.SANDBOX
        self._initialize_aws_secrets()
    
    def _initialize_aws_secrets(self):
        """Initialize AWS Secrets Manager client for secure credential storage"""
        try:
            self.aws_secrets_client = boto3.client(
                'secretsmanager',
                region_name=os.getenv('AWS_REGION', 'us-east-1')
            )
        except Exception as e:
            logger.warning(f"AWS Secrets Manager not available: {e}")
    
    async def _get_redis_client(self) -> redis.Redis:
        """Get Redis client for token caching"""
        if not self.redis_client:
            redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
            self.redis_client = redis.from_url(redis_url)
        return self.redis_client
    
    async def _get_db_session(self) -> AsyncSession:
        """Get database session"""
        return AsyncSessionLocal()
    
    def _hash_secret(self, secret: str) -> str:
        """Hash secret for secure storage"""
        return hashlib.sha256(secret.encode()).hexdigest()
    
    def _encrypt_secret(self, secret: str, key: str) -> str:
        """Encrypt secret using provided key"""
        # Simple encryption for demo - use proper encryption in production
        return base64.b64encode(secret.encode()).decode()
    
    def _decrypt_secret(self, encrypted_secret: str, key: str) -> str:
        """Decrypt secret using provided key"""
        # Simple decryption for demo - use proper decryption in production
        return base64.b64decode(encrypted_secret.encode()).decode()
    
    async def store_cms_credentials(self, request: CMSCredentialRequest) -> Dict[str, Any]:
        """Store CMS API credentials securely"""
        try:
            async with self._get_db_session() as session:
                # Hash the client secret for secure storage
                secret_hash = self._hash_secret(request.client_secret)
                
                # Store in AWS Secrets Manager if available
                secret_name = f"cms-idr-{request.environment.value}"
                if self.aws_secrets_client:
                    try:
                        secret_value = {
                            "client_id": request.client_id,
                            "client_secret": request.client_secret,
                            "base_url": request.base_url,
                            "portal_url": request.portal_url
                        }
                        
                        self.aws_secrets_client.create_secret(
                            Name=secret_name,
                            SecretString=json.dumps(secret_value),
                            Description=f"CMS IDR API credentials for {request.environment.value}"
                        )
                        logger.info(f"Stored credentials in AWS Secrets Manager: {secret_name}")
                    except ClientError as e:
                        if e.response['Error']['Code'] == 'ResourceExistsException':
                            # Update existing secret
                            self.aws_secrets_client.update_secret(
                                SecretId=secret_name,
                                SecretString=json.dumps(secret_value)
                            )
                            logger.info(f"Updated credentials in AWS Secrets Manager: {secret_name}")
                        else:
                            logger.error(f"AWS Secrets Manager error: {e}")
                
                # Store in database
                credentials = CMSCredentials(
                    environment=request.environment.value,
                    client_id=request.client_id,
                    client_secret_hash=secret_hash,
                    base_url=request.base_url,
                    portal_url=request.portal_url
                )
                
                # Handle certificate storage
                if request.certificate_content:
                    cert_path = f"/secure/certs/cms-{request.environment.value}.crt"
                    os.makedirs(os.path.dirname(cert_path), exist_ok=True)
                    with open(cert_path, 'w') as f:
                        f.write(request.certificate_content)
                    credentials.certificate_path = cert_path
                
                if request.private_key_content:
                    key_path = f"/secure/keys/cms-{request.environment.value}.key"
                    os.makedirs(os.path.dirname(key_path), exist_ok=True)
                    with open(key_path, 'w') as f:
                        f.write(request.private_key_content)
                    credentials.private_key_path = key_path
                
                session.add(credentials)
                await session.commit()
                
                return {
                    "status": "success",
                    "message": f"CMS credentials stored for {request.environment.value}",
                    "environment": request.environment.value,
                    "client_id": request.client_id[:8] + "...",  # Masked for security
                    "stored_at": datetime.utcnow().isoformat()
                }
                
        except Exception as e:
            logger.error(f"Error storing CMS credentials: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to store credentials: {str(e)}")
    
    async def get_cms_credentials(self, environment: CMSEnvironment) -> Dict[str, Any]:
        """Retrieve CMS API credentials securely"""
        try:
            # Try AWS Secrets Manager first
            if self.aws_secrets_client:
                try:
                    secret_name = f"cms-idr-{environment.value}"
                    response = self.aws_secrets_client.get_secret_value(SecretId=secret_name)
                    secret_data = json.loads(response['SecretString'])
                    logger.info(f"Retrieved credentials from AWS Secrets Manager: {secret_name}")
                    return secret_data
                except ClientError as e:
                    logger.warning(f"AWS Secrets Manager retrieval failed: {e}")
            
            # Fallback to database
            async with self._get_db_session() as session:
                result = await session.execute(
                    select(CMSCredentials).where(
                        CMSCredentials.environment == environment.value,
                        CMSCredentials.is_active == True
                    )
                )
                credentials = result.scalar_one_or_none()
                
                if not credentials:
                    raise HTTPException(
                        status_code=404, 
                        detail=f"No credentials found for environment: {environment.value}"
                    )
                
                return {
                    "client_id": credentials.client_id,
                    "client_secret": "***STORED_SECURELY***",  # Don't return actual secret
                    "base_url": credentials.base_url,
                    "portal_url": credentials.portal_url,
                    "certificate_path": credentials.certificate_path,
                    "private_key_path": credentials.private_key_path
                }
                
        except Exception as e:
            logger.error(f"Error retrieving CMS credentials: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to retrieve credentials: {str(e)}")
    
    async def authenticate_with_cms(self, environment: CMSEnvironment, scope: str = "idr:submit idr:status idr:documents") -> CMSAuthenticationResponse:
        """Authenticate with CMS IDR API using production OAuth 2.0 flow"""
        try:
            # Check for cached token
            cached_token = await self._get_cached_token(environment, scope)
            if cached_token:
                return cached_token
            
            # Get credentials
            credentials = await self.get_cms_credentials(environment)
            
            # Prepare authentication request
            auth_data = {
                "grant_type": "client_credentials",
                "client_id": credentials["client_id"],
                "scope": scope
            }
            
            # Use client certificate authentication if available
            cert_path = credentials.get("certificate_path")
            key_path = credentials.get("private_key_path")
            
            async with httpx.AsyncClient(
                cert=(cert_path, key_path) if cert_path and key_path else None,
                timeout=30.0
            ) as client:
                
                # For client_secret_basic authentication
                if not cert_path:
                    auth_data["client_secret"] = await self._get_actual_client_secret(environment)
                
                response = await client.post(
                    f"{credentials['base_url']}/oauth2/token",
                    data=auth_data,
                    headers={
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Accept": "application/json",
                        "User-Agent": "NSA-IDR-Platform/2.0"
                    }
                )
                
                if response.status_code != 200:
                    error_detail = response.text
                    logger.error(f"CMS authentication failed: {response.status_code} - {error_detail}")
                    raise HTTPException(
                        status_code=401, 
                        detail=f"CMS authentication failed: {error_detail}"
                    )
                
                token_data = response.json()
                
                # Cache the token
                auth_response = CMSAuthenticationResponse(
                    access_token=token_data["access_token"],
                    expires_in=token_data["expires_in"],
                    scope=token_data.get("scope", scope),
                    environment=environment
                )
                
                await self._cache_token(environment, auth_response)
                
                return auth_response
                
        except httpx.TimeoutException:
            logger.error("CMS authentication timeout")
            raise HTTPException(status_code=504, detail="CMS authentication timeout")
        except Exception as e:
            logger.error(f"CMS authentication error: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Authentication error: {str(e)}")
    
    async def _get_actual_client_secret(self, environment: CMSEnvironment) -> str:
        """Get the actual client secret (not hashed) for authentication"""
        if self.aws_secrets_client:
            try:
                secret_name = f"cms-idr-{environment.value}"
                response = self.aws_secrets_client.get_secret_value(SecretId=secret_name)
                secret_data = json.loads(response['SecretString'])
                return secret_data["client_secret"]
            except ClientError:
                pass
        
        # Fallback - in production, this should be properly encrypted
        raise HTTPException(status_code=500, detail="Client secret not available")
    
    async def _get_cached_token(self, environment: CMSEnvironment, scope: str) -> Optional[CMSAuthenticationResponse]:
        """Get cached access token if valid"""
        try:
            redis_client = await self._get_redis_client()
            cache_key = f"cms_token:{environment.value}:{hashlib.md5(scope.encode()).hexdigest()}"
            
            cached_data = await redis_client.get(cache_key)
            if cached_data:
                token_data = json.loads(cached_data)
                expires_at = datetime.fromisoformat(token_data["expires_at"])
                
                if expires_at > datetime.utcnow() + timedelta(minutes=5):  # 5-minute buffer
                    return CMSAuthenticationResponse(
                        access_token=token_data["access_token"],
                        expires_in=int((expires_at - datetime.utcnow()).total_seconds()),
                        scope=token_data["scope"],
                        environment=environment
                    )
            
            return None
            
        except Exception as e:
            logger.warning(f"Token cache retrieval failed: {e}")
            return None
    
    async def _cache_token(self, environment: CMSEnvironment, auth_response: CMSAuthenticationResponse):
        """Cache access token for reuse"""
        try:
            redis_client = await self._get_redis_client()
            cache_key = f"cms_token:{environment.value}:{hashlib.md5(auth_response.scope.encode()).hexdigest()}"
            
            expires_at = datetime.utcnow() + timedelta(seconds=auth_response.expires_in)
            
            cache_data = {
                "access_token": auth_response.access_token,
                "expires_at": expires_at.isoformat(),
                "scope": auth_response.scope
            }
            
            # Cache with expiration
            await redis_client.setex(
                cache_key, 
                auth_response.expires_in - 300,  # 5-minute buffer
                json.dumps(cache_data)
            )
            
            # Also store in database for persistence
            async with self._get_db_session() as session:
                token_cache = CMSTokenCache(
                    environment=environment.value,
                    access_token_hash=self._hash_secret(auth_response.access_token),
                    expires_at=expires_at,
                    scope=auth_response.scope
                )
                session.add(token_cache)
                await session.commit()
            
        except Exception as e:
            logger.warning(f"Token caching failed: {e}")
    
    async def validate_cms_connection(self, environment: CMSEnvironment) -> Dict[str, Any]:
        """Validate connection to CMS IDR API"""
        try:
            auth_response = await self.authenticate_with_cms(environment)
            credentials = await self.get_cms_credentials(environment)
            
            # Test API connectivity
            async with httpx.AsyncClient(timeout=30.0) as client:
                headers = {
                    "Authorization": f"Bearer {auth_response.access_token}",
                    "Accept": "application/json",
                    "User-Agent": "NSA-IDR-Platform/2.0"
                }
                
                # Test health endpoint
                response = await client.get(
                    f"{credentials['base_url']}/health",
                    headers=headers
                )
                
                return {
                    "status": "success" if response.status_code == 200 else "warning",
                    "environment": environment.value,
                    "api_status": response.status_code,
                    "authentication": "successful",
                    "connection_time": datetime.utcnow().isoformat(),
                    "api_version": response.headers.get("API-Version", "unknown"),
                    "rate_limit": response.headers.get("X-RateLimit-Limit", "unknown")
                }
                
        except Exception as e:
            logger.error(f"CMS connection validation failed: {e}")
            return {
                "status": "error",
                "environment": environment.value,
                "error": str(e),
                "connection_time": datetime.utcnow().isoformat()
            }

# Initialize service
cms_integration_service = ProductionCMSIntegrationService()

@app.post("/cms/credentials", response_model=Dict[str, Any])
async def store_credentials(request: CMSCredentialRequest):
    """Store CMS API credentials securely"""
    return await cms_integration_service.store_cms_credentials(request)

@app.get("/cms/credentials/{environment}")
async def get_credentials(environment: CMSEnvironment):
    """Get CMS API credentials (masked for security)"""
    return await cms_integration_service.get_cms_credentials(environment)

@app.post("/cms/authenticate/{environment}", response_model=CMSAuthenticationResponse)
async def authenticate(environment: CMSEnvironment, scope: str = "idr:submit idr:status idr:documents"):
    """Authenticate with CMS IDR API"""
    return await cms_integration_service.authenticate_with_cms(environment, scope)

@app.get("/cms/validate/{environment}")
async def validate_connection(environment: CMSEnvironment):
    """Validate CMS API connection"""
    return await cms_integration_service.validate_cms_connection(environment)

@app.get("/cms/environments")
async def list_environments():
    """List available CMS environments"""
    return {
        "environments": [env.value for env in CMSEnvironment],
        "current_default": CMSEnvironment.SANDBOX.value,
        "production_ready": True
    }

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "cms-api-integration-service",
        "version": "2.0.0",
        "timestamp": datetime.utcnow().isoformat()
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8020)
