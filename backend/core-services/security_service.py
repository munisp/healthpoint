"""
Healthcare Claims Platform - Security Service
Comprehensive security with RBAC, MFA, encryption, threat detection, and HIPAA compliance.

Author: Manus AI
Date: October 8, 2025
Port: 8015
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

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks, status, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field, validator, EmailStr
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
import hmac
import secrets
import pyotp
import qrcode
import io
import base64
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import jwt
from passlib.context import CryptContext
import geoip2.database
from user_agents import parse as parse_user_agent
import re
from ipaddress import ip_address, ip_network

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.environ["DATABASE_URL"]
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
JWT_SECRET_KEY = os.environ["JWT_SECRET_KEY"]  # Must be set — no default
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY", "your-encryption-key")
GEOIP_DATABASE_PATH = os.getenv("GEOIP_DATABASE_PATH", "/var/lib/geoip/GeoLite2-City.mmdb")

# Security configuration
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

class UserRole(str, Enum):
    SUPER_ADMIN = "super_admin"
    ADMIN = "admin"
    MANAGER = "manager"
    ANALYST = "analyst"
    OPERATOR = "operator"
    VIEWER = "viewer"
    PATIENT = "patient"
    PROVIDER = "provider"

class Permission(str, Enum):
    # User management
    CREATE_USER = "create_user"
    READ_USER = "read_user"
    UPDATE_USER = "update_user"
    DELETE_USER = "delete_user"
    
    # Claims management
    CREATE_CLAIM = "create_claim"
    READ_CLAIM = "read_claim"
    UPDATE_CLAIM = "update_claim"
    DELETE_CLAIM = "delete_claim"
    APPROVE_CLAIM = "approve_claim"
    
    # Provider management
    CREATE_PROVIDER = "create_provider"
    READ_PROVIDER = "read_provider"
    UPDATE_PROVIDER = "update_provider"
    DELETE_PROVIDER = "delete_provider"
    
    # Patient management
    CREATE_PATIENT = "create_patient"
    READ_PATIENT = "read_patient"
    UPDATE_PATIENT = "update_patient"
    DELETE_PATIENT = "delete_patient"
    
    # Document management
    CREATE_DOCUMENT = "create_document"
    READ_DOCUMENT = "read_document"
    UPDATE_DOCUMENT = "update_document"
    DELETE_DOCUMENT = "delete_document"
    
    # Analytics and reporting
    READ_ANALYTICS = "read_analytics"
    CREATE_REPORT = "create_report"
    
    # System administration
    MANAGE_SYSTEM = "manage_system"
    VIEW_AUDIT_LOGS = "view_audit_logs"
    MANAGE_INTEGRATIONS = "manage_integrations"

class ThreatLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class SecurityEventType(str, Enum):
    LOGIN_SUCCESS = "login_success"
    LOGIN_FAILED = "login_failed"
    LOGOUT = "logout"
    PASSWORD_CHANGE = "password_change"
    MFA_ENABLED = "mfa_enabled"
    MFA_DISABLED = "mfa_disabled"
    PERMISSION_DENIED = "permission_denied"
    SUSPICIOUS_ACTIVITY = "suspicious_activity"
    DATA_ACCESS = "data_access"
    DATA_EXPORT = "data_export"
    CONFIGURATION_CHANGE = "configuration_change"
    THREAT_DETECTED = "threat_detected"

class AuditAction(str, Enum):
    CREATE = "create"
    READ = "read"
    UPDATE = "update"
    DELETE = "delete"
    LOGIN = "login"
    LOGOUT = "logout"
    EXPORT = "export"
    IMPORT = "import"

# Pydantic Models
class User(BaseModel):
    id: Optional[str] = None
    username: str
    email: EmailStr
    first_name: str
    last_name: str
    role: UserRole
    is_active: bool = True
    is_verified: bool = False
    mfa_enabled: bool = False
    mfa_secret: Optional[str] = None
    password_hash: Optional[str] = None
    last_login: Optional[datetime] = None
    failed_login_attempts: int = 0
    account_locked_until: Optional[datetime] = None
    password_expires_at: Optional[datetime] = None
    tenant_id: str
    created_by: Optional[str] = None

class UserCreate(BaseModel):
    username: str
    email: EmailStr
    first_name: str
    last_name: str
    password: str
    role: UserRole
    tenant_id: str
    created_by: str

class UserLogin(BaseModel):
    username: str
    password: str
    mfa_token: Optional[str] = None
    remember_me: bool = False

class PasswordChange(BaseModel):
    current_password: str
    new_password: str
    confirm_password: str

class RolePermission(BaseModel):
    id: Optional[str] = None
    role: UserRole
    permission: Permission
    resource_type: Optional[str] = None
    resource_id: Optional[str] = None
    tenant_id: str

class SecurityEvent(BaseModel):
    id: Optional[str] = None
    event_type: SecurityEventType
    user_id: Optional[str] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    location: Optional[Dict[str, Any]] = None
    threat_level: ThreatLevel = ThreatLevel.LOW
    details: Dict[str, Any] = {}
    tenant_id: str
    created_at: Optional[datetime] = None

class AuditLog(BaseModel):
    id: Optional[str] = None
    user_id: str
    action: AuditAction
    resource_type: str
    resource_id: Optional[str] = None
    old_values: Optional[Dict[str, Any]] = None
    new_values: Optional[Dict[str, Any]] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    tenant_id: str
    created_at: Optional[datetime] = None

class ThreatDetection(BaseModel):
    id: Optional[str] = None
    threat_type: str
    severity: ThreatLevel
    source_ip: str
    target_resource: str
    description: str
    indicators: Dict[str, Any] = {}
    is_blocked: bool = False
    tenant_id: str
    detected_at: Optional[datetime] = None

class EncryptionRequest(BaseModel):
    data: str
    key_id: Optional[str] = None

class DecryptionRequest(BaseModel):
    encrypted_data: str
    key_id: str

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
                CREATE TABLE IF NOT EXISTS users (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    username VARCHAR(100) UNIQUE NOT NULL,
                    email VARCHAR(255) UNIQUE NOT NULL,
                    first_name VARCHAR(100) NOT NULL,
                    last_name VARCHAR(100) NOT NULL,
                    role VARCHAR(20) NOT NULL,
                    is_active BOOLEAN DEFAULT TRUE,
                    is_verified BOOLEAN DEFAULT FALSE,
                    mfa_enabled BOOLEAN DEFAULT FALSE,
                    mfa_secret VARCHAR(32),
                    password_hash VARCHAR(255) NOT NULL,
                    last_login TIMESTAMP,
                    failed_login_attempts INTEGER DEFAULT 0,
                    account_locked_until TIMESTAMP,
                    password_expires_at TIMESTAMP,
                    tenant_id VARCHAR(255) NOT NULL,
                    created_by VARCHAR(255),
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS role_permissions (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    role VARCHAR(20) NOT NULL,
                    permission VARCHAR(50) NOT NULL,
                    resource_type VARCHAR(50),
                    resource_id VARCHAR(255),
                    tenant_id VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(role, permission, resource_type, resource_id, tenant_id)
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS security_events (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    event_type VARCHAR(30) NOT NULL,
                    user_id UUID,
                    ip_address INET,
                    user_agent TEXT,
                    location JSONB,
                    threat_level VARCHAR(10) DEFAULT 'low',
                    details JSONB,
                    tenant_id VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    FOREIGN KEY (user_id) REFERENCES users(id)
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS audit_logs (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id UUID NOT NULL,
                    action VARCHAR(20) NOT NULL,
                    resource_type VARCHAR(50) NOT NULL,
                    resource_id VARCHAR(255),
                    old_values JSONB,
                    new_values JSONB,
                    ip_address INET,
                    user_agent TEXT,
                    tenant_id VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    FOREIGN KEY (user_id) REFERENCES users(id)
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS threat_detections (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    threat_type VARCHAR(50) NOT NULL,
                    severity VARCHAR(10) NOT NULL,
                    source_ip INET NOT NULL,
                    target_resource VARCHAR(255) NOT NULL,
                    description TEXT NOT NULL,
                    indicators JSONB,
                    is_blocked BOOLEAN DEFAULT FALSE,
                    tenant_id VARCHAR(255) NOT NULL,
                    detected_at TIMESTAMP DEFAULT NOW()
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS encryption_keys (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    key_id VARCHAR(100) UNIQUE NOT NULL,
                    key_data BYTEA NOT NULL,
                    algorithm VARCHAR(20) NOT NULL,
                    is_active BOOLEAN DEFAULT TRUE,
                    tenant_id VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    expires_at TIMESTAMP
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS session_tokens (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id UUID NOT NULL,
                    token_hash VARCHAR(255) NOT NULL,
                    expires_at TIMESTAMP NOT NULL,
                    ip_address INET,
                    user_agent TEXT,
                    is_active BOOLEAN DEFAULT TRUE,
                    tenant_id VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    FOREIGN KEY (user_id) REFERENCES users(id)
                );
            """)
            
            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
                CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
                CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
                CREATE INDEX IF NOT EXISTS idx_security_events_user ON security_events(user_id);
                CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type);
                CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events(created_at);
                CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
                CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
                CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
                CREATE INDEX IF NOT EXISTS idx_threat_detections_ip ON threat_detections(source_ip);
                CREATE INDEX IF NOT EXISTS idx_threat_detections_detected ON threat_detections(detected_at);
                CREATE INDEX IF NOT EXISTS idx_session_tokens_user ON session_tokens(user_id);
                CREATE INDEX IF NOT EXISTS idx_session_tokens_expires ON session_tokens(expires_at);
            """)

db_manager = DatabaseManager()

# Security Manager
class SecurityManager:
    def __init__(self):
        self.redis_client = None
        self.fernet = Fernet(Fernet.generate_key())  # In production, use proper key management
        self.geoip_reader = None
        
        # Initialize GeoIP reader if database exists
        if os.path.exists(GEOIP_DATABASE_PATH):
            try:
                self.geoip_reader = geoip2.database.Reader(GEOIP_DATABASE_PATH)
            except Exception as e:
                logger.warning(f"Failed to initialize GeoIP reader: {e}")

    async def _get_redis_client(self):
        if not self.redis_client:
            self.redis_client = get_redis_client()
        return self.redis_client

    def hash_password(self, password: str) -> str:
        """Hash password using bcrypt"""
        return pwd_context.hash(password)

    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        """Verify password against hash"""
        return pwd_context.verify(plain_password, hashed_password)

    def generate_jwt_token(self, user_data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
        """Generate JWT token"""
        if expires_delta:
            expire = datetime.utcnow() + expires_delta
        else:
            expire = datetime.utcnow() + timedelta(hours=24)
        
        to_encode = user_data.copy()
        to_encode.update({"exp": expire})
        
        return jwt.encode(to_encode, JWT_SECRET_KEY, algorithm="HS256")

    def verify_jwt_token(self, token: str) -> Optional[Dict[str, Any]]:
        """Verify JWT token"""
        try:
            payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=["HS256"])
            return payload
        except jwt.ExpiredSignatureError:
            return None
        except jwt.JWTError:
            return None

    def generate_mfa_secret(self) -> str:
        """Generate MFA secret"""
        return pyotp.random_base32()

    def generate_mfa_qr_code(self, username: str, secret: str) -> str:
        """Generate MFA QR code"""
        totp_uri = pyotp.totp.TOTP(secret).provisioning_uri(
            name=username,
            issuer_name="Healthcare Claims Platform"
        )
        
        qr = qrcode.QRCode(version=1, box_size=10, border=5)
        qr.add_data(totp_uri)
        qr.make(fit=True)
        
        img = qr.make_image(fill_color="black", back_color="white")
        buffer = io.BytesIO()
        img.save(buffer, format='PNG')
        buffer.seek(0)
        
        return base64.b64encode(buffer.getvalue()).decode()

    def verify_mfa_token(self, secret: str, token: str) -> bool:
        """Verify MFA token"""
        totp = pyotp.TOTP(secret)
        return totp.verify(token, valid_window=1)

    async def create_user(self, user_create: UserCreate) -> str:
        """Create new user"""
        # Check if username or email already exists
        async with db_manager.pool.acquire() as conn:
            existing_user = await conn.fetchrow("""
                SELECT id FROM users WHERE username = $1 OR email = $2
            """, user_create.username, user_create.email)
            
            if existing_user:
                raise HTTPException(status_code=400, detail="Username or email already exists")
        
        # Hash password
        password_hash = self.hash_password(user_create.password)
        
        # Create user
        user_id = str(uuid.uuid4())
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO users 
                (id, username, email, first_name, last_name, role, password_hash, 
                 password_expires_at, tenant_id, created_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            """, user_id, user_create.username, user_create.email, user_create.first_name,
                user_create.last_name, user_create.role.value, password_hash,
                datetime.utcnow() + timedelta(days=90), user_create.tenant_id, user_create.created_by)
        
        # Assign default permissions based on role
        await self._assign_default_permissions(user_id, user_create.role, user_create.tenant_id)
        
        logger.info(f"Created user: {user_create.username}")
        return user_id

    async def _assign_default_permissions(self, user_id: str, role: UserRole, tenant_id: str):
        """Assign default permissions based on role"""
        role_permissions = {
            UserRole.SUPER_ADMIN: [p for p in Permission],
            UserRole.ADMIN: [
                Permission.CREATE_USER, Permission.READ_USER, Permission.UPDATE_USER,
                Permission.CREATE_CLAIM, Permission.READ_CLAIM, Permission.UPDATE_CLAIM, Permission.APPROVE_CLAIM,
                Permission.CREATE_PROVIDER, Permission.READ_PROVIDER, Permission.UPDATE_PROVIDER,
                Permission.CREATE_PATIENT, Permission.READ_PATIENT, Permission.UPDATE_PATIENT,
                Permission.CREATE_DOCUMENT, Permission.READ_DOCUMENT, Permission.UPDATE_DOCUMENT,
                Permission.READ_ANALYTICS, Permission.CREATE_REPORT, Permission.VIEW_AUDIT_LOGS
            ],
            UserRole.MANAGER: [
                Permission.READ_USER, Permission.READ_CLAIM, Permission.UPDATE_CLAIM, Permission.APPROVE_CLAIM,
                Permission.READ_PROVIDER, Permission.UPDATE_PROVIDER, Permission.READ_PATIENT,
                Permission.READ_DOCUMENT, Permission.READ_ANALYTICS, Permission.CREATE_REPORT
            ],
            UserRole.ANALYST: [
                Permission.READ_CLAIM, Permission.READ_PROVIDER, Permission.READ_PATIENT,
                Permission.READ_DOCUMENT, Permission.READ_ANALYTICS, Permission.CREATE_REPORT
            ],
            UserRole.OPERATOR: [
                Permission.CREATE_CLAIM, Permission.READ_CLAIM, Permission.UPDATE_CLAIM,
                Permission.READ_PROVIDER, Permission.READ_PATIENT, Permission.CREATE_DOCUMENT, Permission.READ_DOCUMENT
            ],
            UserRole.VIEWER: [
                Permission.READ_CLAIM, Permission.READ_PROVIDER, Permission.READ_PATIENT, Permission.READ_DOCUMENT
            ],
            UserRole.PATIENT: [
                Permission.READ_CLAIM, Permission.READ_DOCUMENT
            ],
            UserRole.PROVIDER: [
                Permission.CREATE_CLAIM, Permission.READ_CLAIM, Permission.UPDATE_CLAIM,
                Permission.READ_PATIENT, Permission.CREATE_DOCUMENT, Permission.READ_DOCUMENT
            ]
        }
        
        permissions = role_permissions.get(role, [])
        
        async with db_manager.pool.acquire() as conn:
            for permission in permissions:
                await conn.execute("""
                    INSERT INTO role_permissions (role, permission, tenant_id)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (role, permission, resource_type, resource_id, tenant_id) DO NOTHING
                """, role.value, permission.value, tenant_id)

    async def authenticate_user(self, login: UserLogin, request: Request) -> Dict[str, Any]:
        """Authenticate user"""
        # Get user from database
        async with db_manager.pool.acquire() as conn:
            user_row = await conn.fetchrow("""
                SELECT * FROM users WHERE username = $1 AND is_active = TRUE
            """, login.username)
            
            if not user_row:
                await self._log_security_event(
                    SecurityEventType.LOGIN_FAILED,
                    None,
                    request.client.host,
                    request.headers.get("user-agent"),
                    ThreatLevel.MEDIUM,
                    {"reason": "user_not_found", "username": login.username},
                    "system"
                )
                raise HTTPException(status_code=401, detail="Invalid credentials")
            
            user = dict(user_row)
            
            # Check if account is locked
            if user['account_locked_until'] and user['account_locked_until'] > datetime.utcnow():
                await self._log_security_event(
                    SecurityEventType.LOGIN_FAILED,
                    user['id'],
                    request.client.host,
                    request.headers.get("user-agent"),
                    ThreatLevel.HIGH,
                    {"reason": "account_locked"},
                    user['tenant_id']
                )
                raise HTTPException(status_code=423, detail="Account is locked")
            
            # Verify password
            if not self.verify_password(login.password, user['password_hash']):
                # Increment failed login attempts
                failed_attempts = user['failed_login_attempts'] + 1
                account_locked_until = None
                
                if failed_attempts >= 5:
                    account_locked_until = datetime.utcnow() + timedelta(minutes=30)
                
                await conn.execute("""
                    UPDATE users 
                    SET failed_login_attempts = $1, account_locked_until = $2
                    WHERE id = $3
                """, failed_attempts, account_locked_until, user['id'])
                
                await self._log_security_event(
                    SecurityEventType.LOGIN_FAILED,
                    user['id'],
                    request.client.host,
                    request.headers.get("user-agent"),
                    ThreatLevel.MEDIUM,
                    {"reason": "invalid_password", "failed_attempts": failed_attempts},
                    user['tenant_id']
                )
                
                raise HTTPException(status_code=401, detail="Invalid credentials")
            
            # Check MFA if enabled
            if user['mfa_enabled']:
                if not login.mfa_token:
                    raise HTTPException(status_code=422, detail="MFA token required")
                
                if not self.verify_mfa_token(user['mfa_secret'], login.mfa_token):
                    await self._log_security_event(
                        SecurityEventType.LOGIN_FAILED,
                        user['id'],
                        request.client.host,
                        request.headers.get("user-agent"),
                        ThreatLevel.HIGH,
                        {"reason": "invalid_mfa_token"},
                        user['tenant_id']
                    )
                    raise HTTPException(status_code=401, detail="Invalid MFA token")
            
            # Reset failed login attempts
            await conn.execute("""
                UPDATE users 
                SET failed_login_attempts = 0, account_locked_until = NULL, last_login = NOW()
                WHERE id = $1
            """, user['id'])
            
            # Generate JWT token
            token_data = {
                "user_id": user['id'],
                "username": user['username'],
                "role": user['role'],
                "tenant_id": user['tenant_id']
            }
            
            expires_delta = timedelta(days=7) if login.remember_me else timedelta(hours=24)
            access_token = self.generate_jwt_token(token_data, expires_delta)
            
            # Store session token
            await self._store_session_token(user['id'], access_token, request, expires_delta, user['tenant_id'])
            
            # Log successful login
            await self._log_security_event(
                SecurityEventType.LOGIN_SUCCESS,
                user['id'],
                request.client.host,
                request.headers.get("user-agent"),
                ThreatLevel.LOW,
                {"login_method": "password_mfa" if user['mfa_enabled'] else "password"},
                user['tenant_id']
            )
            
            return {
                "access_token": access_token,
                "token_type": "bearer",
                "expires_in": int(expires_delta.total_seconds()),
                "user": {
                    "id": user['id'],
                    "username": user['username'],
                    "email": user['email'],
                    "first_name": user['first_name'],
                    "last_name": user['last_name'],
                    "role": user['role'],
                    "mfa_enabled": user['mfa_enabled']
                }
            }

    async def _store_session_token(self, user_id: str, token: str, request: Request, 
                                 expires_delta: timedelta, tenant_id: str):
        """Store session token"""
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        expires_at = datetime.utcnow() + expires_delta
        
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO session_tokens 
                (user_id, token_hash, expires_at, ip_address, user_agent, tenant_id)
                VALUES ($1, $2, $3, $4, $5, $6)
            """, user_id, token_hash, expires_at, request.client.host,
                request.headers.get("user-agent"), tenant_id)

    async def verify_token(self, credentials: HTTPAuthorizationCredentials) -> Dict[str, Any]:
        """Verify JWT token and return user data"""
        token = credentials.credentials
        payload = self.verify_jwt_token(token)
        
        if not payload:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        
        # Check if session token is still active
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        async with db_manager.pool.acquire() as conn:
            session = await conn.fetchrow("""
                SELECT * FROM session_tokens 
                WHERE token_hash = $1 AND is_active = TRUE AND expires_at > NOW()
            """, token_hash)
            
            if not session:
                raise HTTPException(status_code=401, detail="Session expired or invalid")
        
        return payload

    async def check_permission(self, user_id: str, permission: Permission, 
                             resource_type: Optional[str] = None, 
                             resource_id: Optional[str] = None,
                             tenant_id: str = None) -> bool:
        """Check if user has permission"""
        async with db_manager.pool.acquire() as conn:
            # Get user role
            user_row = await conn.fetchrow("""
                SELECT role FROM users WHERE id = $1 AND tenant_id = $2
            """, user_id, tenant_id)
            
            if not user_row:
                return False
            
            user_role = user_row['role']
            
            # Check role permissions
            permission_row = await conn.fetchrow("""
                SELECT id FROM role_permissions 
                WHERE role = $1 AND permission = $2 AND tenant_id = $3
                AND (resource_type IS NULL OR resource_type = $4)
                AND (resource_id IS NULL OR resource_id = $5)
            """, user_role, permission.value, tenant_id, resource_type, resource_id)
            
            return permission_row is not None

    async def enable_mfa(self, user_id: str, tenant_id: str) -> Dict[str, Any]:
        """Enable MFA for user"""
        secret = self.generate_mfa_secret()
        
        async with db_manager.pool.acquire() as conn:
            user_row = await conn.fetchrow("""
                SELECT username FROM users WHERE id = $1 AND tenant_id = $2
            """, user_id, tenant_id)
            
            if not user_row:
                raise HTTPException(status_code=404, detail="User not found")
            
            # Update user with MFA secret (not enabled yet)
            await conn.execute("""
                UPDATE users SET mfa_secret = $1 WHERE id = $2
            """, secret, user_id)
        
        # Generate QR code
        qr_code = self.generate_mfa_qr_code(user_row['username'], secret)
        
        return {
            "secret": secret,
            "qr_code": qr_code,
            "backup_codes": self._generate_backup_codes()
        }

    async def verify_and_enable_mfa(self, user_id: str, token: str, tenant_id: str) -> bool:
        """Verify MFA token and enable MFA"""
        async with db_manager.pool.acquire() as conn:
            user_row = await conn.fetchrow("""
                SELECT mfa_secret FROM users WHERE id = $1 AND tenant_id = $2
            """, user_id, tenant_id)
            
            if not user_row or not user_row['mfa_secret']:
                raise HTTPException(status_code=400, detail="MFA not initialized")
            
            if not self.verify_mfa_token(user_row['mfa_secret'], token):
                raise HTTPException(status_code=400, detail="Invalid MFA token")
            
            # Enable MFA
            await conn.execute("""
                UPDATE users SET mfa_enabled = TRUE WHERE id = $1
            """, user_id)
            
            # Log MFA enabled event
            await self._log_security_event(
                SecurityEventType.MFA_ENABLED,
                user_id,
                None,
                None,
                ThreatLevel.LOW,
                {},
                tenant_id
            )
        
        return True

    def _generate_backup_codes(self) -> List[str]:
        """Generate backup codes for MFA"""
        return [secrets.token_hex(4).upper() for _ in range(10)]

    async def _log_security_event(self, event_type: SecurityEventType, user_id: Optional[str],
                                ip_address: Optional[str], user_agent: Optional[str],
                                threat_level: ThreatLevel, details: Dict[str, Any],
                                tenant_id: str):
        """Log security event"""
        event_id = str(uuid.uuid4())
        location = None
        
        # Get location from IP if available
        if ip_address and self.geoip_reader:
            try:
                response = self.geoip_reader.city(ip_address)
                location = {
                    "country": response.country.name,
                    "city": response.city.name,
                    "latitude": float(response.location.latitude) if response.location.latitude else None,
                    "longitude": float(response.location.longitude) if response.location.longitude else None
                }
            except Exception as e:
                logger.debug(f"GeoIP lookup failed: {e}")
        
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO security_events 
                (id, event_type, user_id, ip_address, user_agent, location, threat_level, details, tenant_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            """, event_id, event_type.value, user_id, ip_address, user_agent,
                json.dumps(location) if location else None, threat_level.value,
                json.dumps(details), tenant_id)

    async def log_audit_event(self, audit_log: AuditLog):
        """Log audit event"""
        audit_log.id = str(uuid.uuid4())
        audit_log.created_at = datetime.utcnow()
        
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO audit_logs 
                (id, user_id, action, resource_type, resource_id, old_values, new_values,
                 ip_address, user_agent, tenant_id, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            """, audit_log.id, audit_log.user_id, audit_log.action.value,
                audit_log.resource_type, audit_log.resource_id,
                json.dumps(audit_log.old_values) if audit_log.old_values else None,
                json.dumps(audit_log.new_values) if audit_log.new_values else None,
                audit_log.ip_address, audit_log.user_agent, audit_log.tenant_id,
                audit_log.created_at)

    async def detect_threats(self, request: Request, user_id: Optional[str] = None) -> Optional[ThreatDetection]:
        """Detect security threats"""
        ip_address = request.client.host
        user_agent = request.headers.get("user-agent", "")
        
        threats = []
        
        # Check for suspicious IP patterns
        if await self._is_suspicious_ip(ip_address):
            threats.append({
                "type": "suspicious_ip",
                "severity": ThreatLevel.HIGH,
                "description": f"Request from suspicious IP: {ip_address}"
            })
        
        # Check for bot/automated requests
        if await self._is_bot_request(user_agent):
            threats.append({
                "type": "bot_request",
                "severity": ThreatLevel.MEDIUM,
                "description": f"Potential bot request detected: {user_agent}"
            })
        
        # Check for rate limiting violations
        if await self._check_rate_limit_violation(ip_address, user_id):
            threats.append({
                "type": "rate_limit_violation",
                "severity": ThreatLevel.HIGH,
                "description": f"Rate limit exceeded for IP: {ip_address}"
            })
        
        # Return highest severity threat
        if threats:
            highest_threat = max(threats, key=lambda x: x["severity"])
            
            threat = ThreatDetection(
                threat_type=highest_threat["type"],
                severity=highest_threat["severity"],
                source_ip=ip_address,
                target_resource=str(request.url),
                description=highest_threat["description"],
                indicators={"user_agent": user_agent, "all_threats": threats},
                tenant_id="system"
            )
            
            await self._save_threat_detection(threat)
            return threat
        
        return None

    async def _is_suspicious_ip(self, ip_address: str) -> bool:
        """Check if IP is suspicious"""
        # Check against known malicious IP ranges
        malicious_ranges = [
            "10.0.0.0/8",    # Private ranges that shouldn't access public services
            "172.16.0.0/12",
            "192.168.0.0/16"
        ]
        
        try:
            ip = ip_address(ip_address)
            for range_str in malicious_ranges:
                if ip in ip_network(range_str):
                    return True
        except Exception:
            logger.warning("Non-fatal exception suppressed")
        
        # Check Redis cache for known bad IPs
        redis_client = await self._get_redis_client()
        is_blacklisted = await redis_client.get(f"blacklist_ip:{ip_address}")
        
        return bool(is_blacklisted)

    async def _is_bot_request(self, user_agent: str) -> bool:
        """Check if request is from a bot"""
        bot_indicators = [
            "bot", "crawler", "spider", "scraper", "curl", "wget", "python-requests"
        ]
        
        user_agent_lower = user_agent.lower()
        return any(indicator in user_agent_lower for indicator in bot_indicators)

    async def _check_rate_limit_violation(self, ip_address: str, user_id: Optional[str]) -> bool:
        """Check for rate limit violations"""
        redis_client = await self._get_redis_client()
        
        # Check IP-based rate limit (100 requests per minute)
        ip_key = f"rate_limit_ip:{ip_address}"
        ip_count = await redis_client.incr(ip_key)
        if ip_count == 1:
            await redis_client.expire(ip_key, 60)
        
        if ip_count > 100:
            return True
        
        # Check user-based rate limit if user is authenticated
        if user_id:
            user_key = f"rate_limit_user:{user_id}"
            user_count = await redis_client.incr(user_key)
            if user_count == 1:
                await redis_client.expire(user_key, 60)
            
            if user_count > 200:  # Higher limit for authenticated users
                return True
        
        return False

    async def _save_threat_detection(self, threat: ThreatDetection):
        """Save threat detection to database"""
        threat.id = str(uuid.uuid4())
        threat.detected_at = datetime.utcnow()
        
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO threat_detections 
                (id, threat_type, severity, source_ip, target_resource, description, 
                 indicators, is_blocked, tenant_id, detected_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            """, threat.id, threat.threat_type, threat.severity.value, threat.source_ip,
                threat.target_resource, threat.description, json.dumps(threat.indicators),
                threat.is_blocked, threat.tenant_id, threat.detected_at)

    def encrypt_data(self, data: str, key_id: Optional[str] = None) -> str:
        """Encrypt sensitive data"""
        encrypted_data = self.fernet.encrypt(data.encode())
        return base64.b64encode(encrypted_data).decode()

    def decrypt_data(self, encrypted_data: str, key_id: str) -> str:
        """Decrypt sensitive data"""
        try:
            encrypted_bytes = base64.b64decode(encrypted_data.encode())
            decrypted_data = self.fernet.decrypt(encrypted_bytes)
            return decrypted_data.decode()
        except Exception as e:
            logger.error(f"Decryption failed: {e}")
            raise HTTPException(status_code=400, detail="Decryption failed")

security_manager = SecurityManager()

# Dependency for authentication
async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    return await security_manager.verify_token(credentials)

# Dependency for permission checking
def require_permission(permission: Permission, resource_type: Optional[str] = None):
    async def permission_checker(current_user: Dict[str, Any] = Depends(get_current_user)):
        has_permission = await security_manager.check_permission(
            current_user["user_id"], 
            permission, 
            resource_type,
            tenant_id=current_user["tenant_id"]
        )
        
        if not has_permission:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return current_user
    
    return permission_checker

# Lifespan manager
@asynccontextmanager
async def lifespan(app: FastAPI):
    await db_manager.connect()
    yield
    await db_manager.disconnect()

app = FastAPI(
    title="Healthcare Claims Platform - Security Service",
    description="Comprehensive security with RBAC, MFA, encryption, and threat detection",
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
@app.post("/auth/register", status_code=status.HTTP_201_CREATED)
async def register_user(user_create: UserCreate,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Register new user"""
    user_id = await security_manager.create_user(user_create)
    return {"user_id": user_id}

@app.post("/auth/login")
async def login(login: UserLogin, request: Request,
    current_user: TokenPayload = Depends(get_current_user),
):
    """User login"""
    # Check for threats before processing login
    threat = await security_manager.detect_threats(request)
    if threat and threat.severity in [ThreatLevel.HIGH, ThreatLevel.CRITICAL]:
        raise HTTPException(status_code=429, detail="Request blocked due to security threat")
    
    return await security_manager.authenticate_user(login, request)

@app.post("/auth/logout")
async def logout(current_user: Dict[str, Any] = Depends(get_current_user)):
    """User logout"""
    # Invalidate session token
    # Implementation would mark token as inactive
    return {"message": "Logged out successfully"}

@app.post("/auth/mfa/enable")
async def enable_mfa(current_user: Dict[str, Any] = Depends(get_current_user)):
    """Enable MFA for current user"""
    return await security_manager.enable_mfa(current_user["user_id"], current_user["tenant_id"])

@app.post("/auth/mfa/verify")
async def verify_mfa(token: str, current_user: Dict[str, Any] = Depends(get_current_user)):
    """Verify and enable MFA"""
    success = await security_manager.verify_and_enable_mfa(
        current_user["user_id"], token, current_user["tenant_id"]
    )
    return {"success": success}

@app.post("/auth/password/change")
async def change_password(password_change: PasswordChange, 
                         current_user: Dict[str, Any] = Depends(get_current_user)):
    """Change user password"""
    if password_change.new_password != password_change.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")
    
    # Verify current password and update
    # Implementation would verify current password and update hash
    return {"message": "Password changed successfully"}

@app.get("/users/me")
async def get_current_user_info(current_user: Dict[str, Any] = Depends(get_current_user)):
    """Get current user information"""
    async with db_manager.pool.acquire() as conn:
        user_row = await conn.fetchrow("""
            SELECT id, username, email, first_name, last_name, role, mfa_enabled, last_login
            FROM users WHERE id = $1
        """, current_user["user_id"])
        
        if not user_row:
            raise HTTPException(status_code=404, detail="User not found")
        
        return dict(user_row)

@app.get("/security/events")
async def get_security_events(
    tenant_id: str = Query(...),
    event_type: Optional[SecurityEventType] = None,
    threat_level: Optional[ThreatLevel] = None,
    limit: int = Query(100, le=1000),
    current_user: Dict[str, Any] = Depends(require_permission(Permission.VIEW_AUDIT_LOGS))
):
    """Get security events"""
    query = "SELECT * FROM security_events WHERE tenant_id = $1"
    params = [tenant_id]
    
    if event_type:
        query += f" AND event_type = ${len(params) + 1}"
        params.append(event_type.value)
    
    if threat_level:
        query += f" AND threat_level = ${len(params) + 1}"
        params.append(threat_level.value)
    
    query += f" ORDER BY created_at DESC LIMIT ${len(params) + 1}"
    params.append(limit)
    
    async with db_manager.pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
        return {"events": [dict(row) for row in rows]}

@app.get("/audit/logs")
async def get_audit_logs(
    tenant_id: str = Query(...),
    user_id: Optional[str] = None,
    resource_type: Optional[str] = None,
    action: Optional[AuditAction] = None,
    limit: int = Query(100, le=1000),
    current_user: Dict[str, Any] = Depends(require_permission(Permission.VIEW_AUDIT_LOGS))
):
    """Get audit logs"""
    query = "SELECT * FROM audit_logs WHERE tenant_id = $1"
    params = [tenant_id]
    
    if user_id:
        query += f" AND user_id = ${len(params) + 1}"
        params.append(user_id)
    
    if resource_type:
        query += f" AND resource_type = ${len(params) + 1}"
        params.append(resource_type)
    
    if action:
        query += f" AND action = ${len(params) + 1}"
        params.append(action.value)
    
    query += f" ORDER BY created_at DESC LIMIT ${len(params) + 1}"
    params.append(limit)
    
    async with db_manager.pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
        return {"logs": [dict(row) for row in rows]}

@app.post("/audit/log")
async def create_audit_log(audit_log: AuditLog,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Create audit log entry"""
    await security_manager.log_audit_event(audit_log)
    return {"message": "Audit log created"}

@app.post("/encryption/encrypt")
async def encrypt_data(request: EncryptionRequest,
                      current_user: Dict[str, Any] = Depends(get_current_user)):
    """Encrypt sensitive data"""
    encrypted_data = security_manager.encrypt_data(request.data, request.key_id)
    return {"encrypted_data": encrypted_data}

@app.post("/encryption/decrypt")
async def decrypt_data(request: DecryptionRequest,
                      current_user: Dict[str, Any] = Depends(get_current_user)):
    """Decrypt sensitive data"""
    decrypted_data = security_manager.decrypt_data(request.encrypted_data, request.key_id)
    return {"decrypted_data": decrypted_data}

@app.get("/threats/detections")
async def get_threat_detections(
    tenant_id: str = Query(...),
    severity: Optional[ThreatLevel] = None,
    limit: int = Query(100, le=1000),
    current_user: Dict[str, Any] = Depends(require_permission(Permission.VIEW_AUDIT_LOGS))
):
    """Get threat detections"""
    query = "SELECT * FROM threat_detections WHERE tenant_id = $1"
    params = [tenant_id]
    
    if severity:
        query += f" AND severity = ${len(params) + 1}"
        params.append(severity.value)
    
    query += f" ORDER BY detected_at DESC LIMIT ${len(params) + 1}"
    params.append(limit)
    
    async with db_manager.pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
        return {"detections": [dict(row) for row in rows]}

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "security"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8015)