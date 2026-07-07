#!/usr/bin/env python3
"""
Healthcare Claims Platform - Enhanced User Management Service
Advanced RBAC, audit logging, compliance features, and comprehensive user lifecycle management.

Author: Manus AI
Date: October 5, 2025
"""

from fastapi import FastAPI, HTTPException, Depends, status, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
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
import bcrypt
import jwt
from passlib.context import CryptContext
import pyotp
import qrcode
import io
import base64
from PIL import Image
import httpx
import re
from collections import defaultdict

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost/healthcare_platform")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
JWT_SECRET = os.getenv("JWT_SECRET", "your-secret-key")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

class UserRole(str, Enum):
    SUPER_ADMIN = "super_admin"
    TENANT_ADMIN = "tenant_admin"
    PROVIDER_ADMIN = "provider_admin"
    PROVIDER_USER = "provider_user"
    CLAIMS_PROCESSOR = "claims_processor"
    AUDITOR = "auditor"
    READONLY_USER = "readonly_user"

class UserStatus(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    SUSPENDED = "suspended"
    PENDING_VERIFICATION = "pending_verification"
    LOCKED = "locked"
    EXPIRED = "expired"

class AuditAction(str, Enum):
    LOGIN = "login"
    LOGOUT = "logout"
    LOGIN_FAILED = "login_failed"
    PASSWORD_CHANGE = "password_change"
    PROFILE_UPDATE = "profile_update"
    ROLE_CHANGE = "role_change"
    PERMISSION_CHANGE = "permission_change"
    ACCOUNT_LOCKED = "account_locked"
    ACCOUNT_UNLOCKED = "account_unlocked"
    MFA_ENABLED = "mfa_enabled"
    MFA_DISABLED = "mfa_disabled"
    DATA_ACCESS = "data_access"
    DATA_EXPORT = "data_export"
    SYSTEM_ACCESS = "system_access"

class ComplianceFramework(str, Enum):
    HIPAA = "hipaa"
    SOX = "sox"
    PCI_DSS = "pci_dss"
    GDPR = "gdpr"
    SOC2 = "soc2"

# Pydantic Models
class Permission(BaseModel):
    id: str
    name: str
    description: str
    resource: str
    action: str
    conditions: Dict[str, Any] = {}

class Role(BaseModel):
    id: str
    name: str
    description: str
    permissions: List[str]  # Permission IDs
    tenant_id: Optional[str] = None
    is_system_role: bool = False
    created_at: datetime
    updated_at: datetime

class UserProfile(BaseModel):
    first_name: str
    last_name: str
    phone: Optional[str] = None
    department: Optional[str] = None
    job_title: Optional[str] = None
    manager_id: Optional[str] = None
    location: Optional[str] = None
    timezone: str = "UTC"
    language: str = "en"
    avatar_url: Optional[str] = None
    bio: Optional[str] = None

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    profile: UserProfile
    role_ids: List[str]
    tenant_id: Optional[str] = None
    expires_at: Optional[datetime] = None
    force_password_change: bool = True
    
    @validator('password')
    def validate_password(cls, v):
        if len(v) < 8:
            raise ValueError('Password must be at least 8 characters long')
        if not re.search(r'[A-Z]', v):
            raise ValueError('Password must contain at least one uppercase letter')
        if not re.search(r'[a-z]', v):
            raise ValueError('Password must contain at least one lowercase letter')
        if not re.search(r'\d', v):
            raise ValueError('Password must contain at least one digit')
        if not re.search(r'[!@#$%^&*(),.?":{}|<>]', v):
            raise ValueError('Password must contain at least one special character')
        return v

class UserUpdate(BaseModel):
    profile: Optional[UserProfile] = None
    role_ids: Optional[List[str]] = None
    status: Optional[UserStatus] = None
    expires_at: Optional[datetime] = None
    force_password_change: Optional[bool] = None

class UserResponse(BaseModel):
    id: str
    email: str
    profile: UserProfile
    roles: List[Role]
    status: UserStatus
    tenant_id: Optional[str] = None
    last_login: Optional[datetime] = None
    login_count: int = 0
    failed_login_attempts: int = 0
    mfa_enabled: bool = False
    expires_at: Optional[datetime] = None
    force_password_change: bool = False
    created_at: datetime
    updated_at: datetime

class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    mfa_code: Optional[str] = None
    remember_me: bool = False

class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    user: UserResponse
    expires_in: int
    requires_mfa: bool = False
    requires_password_change: bool = False

class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str
    
    @validator('new_password')
    def validate_new_password(cls, v):
        if len(v) < 8:
            raise ValueError('Password must be at least 8 characters long')
        if not re.search(r'[A-Z]', v):
            raise ValueError('Password must contain at least one uppercase letter')
        if not re.search(r'[a-z]', v):
            raise ValueError('Password must contain at least one lowercase letter')
        if not re.search(r'\d', v):
            raise ValueError('Password must contain at least one digit')
        if not re.search(r'[!@#$%^&*(),.?":{}|<>]', v):
            raise ValueError('Password must contain at least one special character')
        return v

class MFASetupResponse(BaseModel):
    secret: str
    qr_code: str  # Base64 encoded QR code image
    backup_codes: List[str]

class AuditLogEntry(BaseModel):
    id: str
    user_id: str
    action: AuditAction
    resource: Optional[str] = None
    resource_id: Optional[str] = None
    details: Dict[str, Any] = {}
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    tenant_id: Optional[str] = None
    timestamp: datetime
    compliance_frameworks: List[ComplianceFramework] = []

class ComplianceReport(BaseModel):
    framework: ComplianceFramework
    period_start: datetime
    period_end: datetime
    total_events: int
    critical_events: int
    violations: List[Dict[str, Any]] = []
    recommendations: List[str] = []
    generated_at: datetime

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
            logger.info("Enhanced user management database connections established")
        except Exception as e:
            logger.error(f"Failed to connect to database: {e}")
            raise
    
    async def disconnect(self):
        """Close database connections"""
        if self.pool:
            await self.pool.close()
        if self.redis:
            await self.redis.close()
        logger.info("Enhanced user management database connections closed")

db_manager = DatabaseManager()

# Password and security utilities
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

def hash_password(password: str) -> str:
    """Hash password using bcrypt"""
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password against hash"""
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create JWT access token"""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return encoded_jwt

def verify_token(token: str) -> Dict[str, Any]:
    """Verify and decode JWT token"""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

# Enhanced User Management Service
class EnhancedUserManagementService:
    def __init__(self):
        self.max_failed_attempts = 5
        self.lockout_duration = timedelta(minutes=30)
        self.password_history_count = 5
        self.session_timeout = timedelta(hours=8)
    
    async def create_user(self, user_data: UserCreate, created_by: str) -> UserResponse:
        """Create new user with comprehensive validation"""
        user_id = str(uuid.uuid4())
        
        async with db_manager.pool.acquire() as conn:
            # Check if email already exists
            existing = await conn.fetchrow("""
                SELECT id FROM users WHERE email = $1
            """, user_data.email)
            
            if existing:
                raise HTTPException(status_code=400, detail="Email already registered")
            
            # Validate roles exist and user has permission to assign them
            role_check = await conn.fetch("""
                SELECT id, name FROM roles WHERE id = ANY($1)
            """, user_data.role_ids)
            
            if len(role_check) != len(user_data.role_ids):
                raise HTTPException(status_code=400, detail="One or more roles not found")
            
            # Hash password
            hashed_password = hash_password(user_data.password)
            
            # Create user
            await conn.execute("""
                INSERT INTO users (
                    id, email, password_hash, profile, status, tenant_id,
                    expires_at, force_password_change, created_at, updated_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
            """, 
                user_id, user_data.email, hashed_password, 
                json.dumps(user_data.profile.dict()), UserStatus.PENDING_VERIFICATION.value,
                user_data.tenant_id, user_data.expires_at, user_data.force_password_change,
                datetime.utcnow()
            )
            
            # Assign roles
            for role_id in user_data.role_ids:
                await conn.execute("""
                    INSERT INTO user_roles (user_id, role_id, assigned_by, assigned_at)
                    VALUES ($1, $2, $3, $4)
                """, user_id, role_id, created_by, datetime.utcnow())
            
            # Log audit event
            await self._log_audit_event(
                user_id=created_by,
                action=AuditAction.SYSTEM_ACCESS,
                resource="user",
                resource_id=user_id,
                details={"action": "user_created", "email": user_data.email},
                tenant_id=user_data.tenant_id
            )
        
        # Return created user
        return await self.get_user(user_id)
    
    async def authenticate_user(self, login_data: LoginRequest, request: Request) -> LoginResponse:
        """Authenticate user with comprehensive security checks"""
        async with db_manager.pool.acquire() as conn:
            # Get user
            user = await conn.fetchrow("""
                SELECT * FROM users WHERE email = $1
            """, login_data.email)
            
            if not user:
                await self._log_audit_event(
                    user_id=None,
                    action=AuditAction.LOGIN_FAILED,
                    details={"reason": "user_not_found", "email": login_data.email},
                    ip_address=request.client.host,
                    user_agent=request.headers.get("user-agent")
                )
                raise HTTPException(status_code=401, detail="Invalid credentials")
            
            # Check account status
            if user["status"] == UserStatus.LOCKED.value:
                raise HTTPException(status_code=423, detail="Account is locked")
            elif user["status"] == UserStatus.SUSPENDED.value:
                raise HTTPException(status_code=423, detail="Account is suspended")
            elif user["status"] == UserStatus.INACTIVE.value:
                raise HTTPException(status_code=423, detail="Account is inactive")
            
            # Check account expiration
            if user["expires_at"] and user["expires_at"] < datetime.utcnow():
                await conn.execute("""
                    UPDATE users SET status = $1 WHERE id = $2
                """, UserStatus.EXPIRED.value, user["id"])
                raise HTTPException(status_code=423, detail="Account has expired")
            
            # Verify password
            if not verify_password(login_data.password, user["password_hash"]):
                # Increment failed attempts
                failed_attempts = user["failed_login_attempts"] + 1
                await conn.execute("""
                    UPDATE users SET failed_login_attempts = $1 WHERE id = $2
                """, failed_attempts, user["id"])
                
                # Lock account if too many failed attempts
                if failed_attempts >= self.max_failed_attempts:
                    await conn.execute("""
                        UPDATE users SET status = $1, locked_at = $2 WHERE id = $3
                    """, UserStatus.LOCKED.value, datetime.utcnow(), user["id"])
                    
                    await self._log_audit_event(
                        user_id=user["id"],
                        action=AuditAction.ACCOUNT_LOCKED,
                        details={"reason": "too_many_failed_attempts"},
                        ip_address=request.client.host,
                        user_agent=request.headers.get("user-agent"),
                        tenant_id=user["tenant_id"]
                    )
                
                await self._log_audit_event(
                    user_id=user["id"],
                    action=AuditAction.LOGIN_FAILED,
                    details={"reason": "invalid_password", "failed_attempts": failed_attempts},
                    ip_address=request.client.host,
                    user_agent=request.headers.get("user-agent"),
                    tenant_id=user["tenant_id"]
                )
                
                raise HTTPException(status_code=401, detail="Invalid credentials")
            
            # Check MFA if enabled
            if user["mfa_enabled"]:
                if not login_data.mfa_code:
                    return LoginResponse(
                        access_token="",
                        refresh_token="",
                        user=await self._build_user_response(user),
                        expires_in=0,
                        requires_mfa=True
                    )
                
                # Verify MFA code
                if not await self._verify_mfa_code(user["id"], login_data.mfa_code):
                    await self._log_audit_event(
                        user_id=user["id"],
                        action=AuditAction.LOGIN_FAILED,
                        details={"reason": "invalid_mfa_code"},
                        ip_address=request.client.host,
                        user_agent=request.headers.get("user-agent"),
                        tenant_id=user["tenant_id"]
                    )
                    raise HTTPException(status_code=401, detail="Invalid MFA code")
            
            # Reset failed attempts on successful login
            await conn.execute("""
                UPDATE users SET 
                    failed_login_attempts = 0,
                    last_login = $1,
                    login_count = login_count + 1
                WHERE id = $2
            """, datetime.utcnow(), user["id"])
            
            # Create session
            session_id = str(uuid.uuid4())
            expires_at = datetime.utcnow() + self.session_timeout
            
            await conn.execute("""
                INSERT INTO user_sessions (
                    id, user_id, ip_address, user_agent, expires_at, created_at
                )
                VALUES ($1, $2, $3, $4, $5, $6)
            """, 
                session_id, user["id"], request.client.host,
                request.headers.get("user-agent"), expires_at, datetime.utcnow()
            )
            
            # Generate tokens
            token_data = {
                "sub": user["id"],
                "email": user["email"],
                "session_id": session_id,
                "tenant_id": user["tenant_id"]
            }
            
            access_token = create_access_token(token_data)
            refresh_token = create_access_token(
                {**token_data, "type": "refresh"}, 
                expires_delta=timedelta(days=30)
            )
            
            # Store refresh token
            await db_manager.redis.setex(
                f"refresh_token:{user['id']}:{session_id}",
                timedelta(days=30).total_seconds(),
                refresh_token
            )
            
            # Log successful login
            await self._log_audit_event(
                user_id=user["id"],
                action=AuditAction.LOGIN,
                details={"session_id": session_id},
                ip_address=request.client.host,
                user_agent=request.headers.get("user-agent"),
                tenant_id=user["tenant_id"]
            )
            
            user_response = await self._build_user_response(user)
            
            return LoginResponse(
                access_token=access_token,
                refresh_token=refresh_token,
                user=user_response,
                expires_in=int(self.session_timeout.total_seconds()),
                requires_password_change=user["force_password_change"]
            )
    
    async def get_user(self, user_id: str) -> UserResponse:
        """Get user by ID with roles and permissions"""
        async with db_manager.pool.acquire() as conn:
            user = await conn.fetchrow("""
                SELECT * FROM users WHERE id = $1
            """, user_id)
            
            if not user:
                raise HTTPException(status_code=404, detail="User not found")
            
            return await self._build_user_response(user)
    
    async def update_user(self, user_id: str, update_data: UserUpdate, updated_by: str) -> UserResponse:
        """Update user with audit logging"""
        async with db_manager.pool.acquire() as conn:
            # Get current user
            current_user = await conn.fetchrow("""
                SELECT * FROM users WHERE id = $1
            """, user_id)
            
            if not current_user:
                raise HTTPException(status_code=404, detail="User not found")
            
            # Build update query
            updates = []
            params = []
            param_count = 0
            
            if update_data.profile:
                param_count += 1
                updates.append(f"profile = ${param_count}")
                params.append(json.dumps(update_data.profile.dict()))
            
            if update_data.status:
                param_count += 1
                updates.append(f"status = ${param_count}")
                params.append(update_data.status.value)
            
            if update_data.expires_at is not None:
                param_count += 1
                updates.append(f"expires_at = ${param_count}")
                params.append(update_data.expires_at)
            
            if update_data.force_password_change is not None:
                param_count += 1
                updates.append(f"force_password_change = ${param_count}")
                params.append(update_data.force_password_change)
            
            if updates:
                param_count += 1
                updates.append(f"updated_at = ${param_count}")
                params.append(datetime.utcnow())
                
                param_count += 1
                params.append(user_id)
                
                query = f"UPDATE users SET {', '.join(updates)} WHERE id = ${param_count}"
                await conn.execute(query, *params)
            
            # Update roles if specified
            if update_data.role_ids is not None:
                # Remove existing roles
                await conn.execute("""
                    DELETE FROM user_roles WHERE user_id = $1
                """, user_id)
                
                # Add new roles
                for role_id in update_data.role_ids:
                    await conn.execute("""
                        INSERT INTO user_roles (user_id, role_id, assigned_by, assigned_at)
                        VALUES ($1, $2, $3, $4)
                    """, user_id, role_id, updated_by, datetime.utcnow())
            
            # Log audit event
            await self._log_audit_event(
                user_id=updated_by,
                action=AuditAction.PROFILE_UPDATE,
                resource="user",
                resource_id=user_id,
                details={"updated_fields": list(update_data.dict(exclude_unset=True).keys())},
                tenant_id=current_user["tenant_id"]
            )
        
        return await self.get_user(user_id)
    
    async def change_password(self, user_id: str, password_data: PasswordChangeRequest) -> Dict[str, str]:
        """Change user password with validation"""
        async with db_manager.pool.acquire() as conn:
            user = await conn.fetchrow("""
                SELECT password_hash, tenant_id FROM users WHERE id = $1
            """, user_id)
            
            if not user:
                raise HTTPException(status_code=404, detail="User not found")
            
            # Verify current password
            if not verify_password(password_data.current_password, user["password_hash"]):
                raise HTTPException(status_code=400, detail="Current password is incorrect")
            
            # Check password history
            password_history = await conn.fetch("""
                SELECT password_hash FROM password_history 
                WHERE user_id = $1 
                ORDER BY created_at DESC 
                LIMIT $2
            """, user_id, self.password_history_count)
            
            new_password_hash = hash_password(password_data.new_password)
            
            for old_password in password_history:
                if verify_password(password_data.new_password, old_password["password_hash"]):
                    raise HTTPException(
                        status_code=400, 
                        detail=f"Password cannot be one of the last {self.password_history_count} passwords"
                    )
            
            # Update password
            await conn.execute("""
                UPDATE users SET 
                    password_hash = $1, 
                    force_password_change = false,
                    password_changed_at = $2,
                    updated_at = $2
                WHERE id = $3
            """, new_password_hash, datetime.utcnow(), user_id)
            
            # Add to password history
            await conn.execute("""
                INSERT INTO password_history (user_id, password_hash, created_at)
                VALUES ($1, $2, $3)
            """, user_id, new_password_hash, datetime.utcnow())
            
            # Clean up old password history
            await conn.execute("""
                DELETE FROM password_history 
                WHERE user_id = $1 AND id NOT IN (
                    SELECT id FROM password_history 
                    WHERE user_id = $1 
                    ORDER BY created_at DESC 
                    LIMIT $2
                )
            """, user_id, self.password_history_count)
            
            # Invalidate all sessions except current one
            await conn.execute("""
                UPDATE user_sessions SET expires_at = NOW() 
                WHERE user_id = $1
            """, user_id)
            
            # Log audit event
            await self._log_audit_event(
                user_id=user_id,
                action=AuditAction.PASSWORD_CHANGE,
                tenant_id=user["tenant_id"]
            )
        
        return {"message": "Password changed successfully"}
    
    async def setup_mfa(self, user_id: str) -> MFASetupResponse:
        """Setup MFA for user"""
        async with db_manager.pool.acquire() as conn:
            user = await conn.fetchrow("""
                SELECT email, tenant_id FROM users WHERE id = $1
            """, user_id)
            
            if not user:
                raise HTTPException(status_code=404, detail="User not found")
            
            # Generate secret
            secret = pyotp.random_base32()
            
            # Generate QR code
            totp_uri = pyotp.totp.TOTP(secret).provisioning_uri(
                name=user["email"],
                issuer_name="Healthcare Claims Platform"
            )
            
            qr = qrcode.QRCode(version=1, box_size=10, border=5)
            qr.add_data(totp_uri)
            qr.make(fit=True)
            
            qr_image = qr.make_image(fill_color="black", back_color="white")
            
            # Convert to base64
            buffer = io.BytesIO()
            qr_image.save(buffer, format='PNG')
            qr_code_base64 = base64.b64encode(buffer.getvalue()).decode()
            
            # Generate backup codes
            backup_codes = [str(uuid.uuid4()).replace('-', '')[:8].upper() for _ in range(10)]
            
            # Store MFA data
            await conn.execute("""
                INSERT INTO user_mfa (user_id, secret, backup_codes, created_at)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (user_id) DO UPDATE SET
                    secret = $2, backup_codes = $3, created_at = $4
            """, user_id, secret, json.dumps(backup_codes), datetime.utcnow())
            
            return MFASetupResponse(
                secret=secret,
                qr_code=qr_code_base64,
                backup_codes=backup_codes
            )
    
    async def enable_mfa(self, user_id: str, verification_code: str) -> Dict[str, str]:
        """Enable MFA after verification"""
        async with db_manager.pool.acquire() as conn:
            # Verify the code
            if not await self._verify_mfa_code(user_id, verification_code):
                raise HTTPException(status_code=400, detail="Invalid verification code")
            
            # Enable MFA
            await conn.execute("""
                UPDATE users SET mfa_enabled = true WHERE id = $1
            """, user_id)
            
            # Get tenant_id for audit log
            user = await conn.fetchrow("""
                SELECT tenant_id FROM users WHERE id = $1
            """, user_id)
            
            # Log audit event
            await self._log_audit_event(
                user_id=user_id,
                action=AuditAction.MFA_ENABLED,
                tenant_id=user["tenant_id"]
            )
        
        return {"message": "MFA enabled successfully"}
    
    async def get_audit_logs(
        self, 
        user_id: Optional[str] = None,
        action: Optional[AuditAction] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        tenant_id: Optional[str] = None,
        limit: int = 100,
        offset: int = 0
    ) -> List[AuditLogEntry]:
        """Get audit logs with filtering"""
        async with db_manager.pool.acquire() as conn:
            query = "SELECT * FROM audit_logs WHERE 1=1"
            params = []
            param_count = 0
            
            if user_id:
                param_count += 1
                query += f" AND user_id = ${param_count}"
                params.append(user_id)
            
            if action:
                param_count += 1
                query += f" AND action = ${param_count}"
                params.append(action.value)
            
            if start_date:
                param_count += 1
                query += f" AND timestamp >= ${param_count}"
                params.append(start_date)
            
            if end_date:
                param_count += 1
                query += f" AND timestamp <= ${param_count}"
                params.append(end_date)
            
            if tenant_id:
                param_count += 1
                query += f" AND tenant_id = ${param_count}"
                params.append(tenant_id)
            
            query += f" ORDER BY timestamp DESC LIMIT ${param_count + 1} OFFSET ${param_count + 2}"
            params.extend([limit, offset])
            
            logs = await conn.fetch(query, *params)
            
            return [
                AuditLogEntry(
                    id=log["id"],
                    user_id=log["user_id"],
                    action=AuditAction(log["action"]),
                    resource=log["resource"],
                    resource_id=log["resource_id"],
                    details=json.loads(log["details"]) if log["details"] else {},
                    ip_address=log["ip_address"],
                    user_agent=log["user_agent"],
                    tenant_id=log["tenant_id"],
                    timestamp=log["timestamp"],
                    compliance_frameworks=[
                        ComplianceFramework(f) for f in json.loads(log["compliance_frameworks"])
                    ] if log["compliance_frameworks"] else []
                )
                for log in logs
            ]
    
    async def generate_compliance_report(
        self, 
        framework: ComplianceFramework,
        start_date: datetime,
        end_date: datetime,
        tenant_id: Optional[str] = None
    ) -> ComplianceReport:
        """Generate compliance report for specific framework"""
        async with db_manager.pool.acquire() as conn:
            # Get relevant audit logs
            query = """
                SELECT * FROM audit_logs 
                WHERE timestamp BETWEEN $1 AND $2
                AND compliance_frameworks @> $3
            """
            params = [start_date, end_date, json.dumps([framework.value])]
            
            if tenant_id:
                query += " AND tenant_id = $4"
                params.append(tenant_id)
            
            logs = await conn.fetch(query, *params)
            
            # Analyze for violations and recommendations
            violations = []
            recommendations = []
            critical_events = 0
            
            for log in logs:
                details = json.loads(log["details"]) if log["details"] else {}
                
                # Check for critical events
                if log["action"] in [
                    AuditAction.ACCOUNT_LOCKED.value,
                    AuditAction.LOGIN_FAILED.value,
                    AuditAction.DATA_EXPORT.value
                ]:
                    critical_events += 1
                
                # Framework-specific violation checks
                if framework == ComplianceFramework.HIPAA:
                    if log["action"] == AuditAction.DATA_ACCESS.value and not log["user_id"]:
                        violations.append({
                            "type": "unauthorized_access",
                            "timestamp": log["timestamp"],
                            "details": "Data access without proper authentication"
                        })
                
                elif framework == ComplianceFramework.SOX:
                    if log["action"] == AuditAction.ROLE_CHANGE.value:
                        violations.append({
                            "type": "privilege_escalation",
                            "timestamp": log["timestamp"],
                            "details": "Role change detected - requires review"
                        })
            
            # Generate recommendations
            if critical_events > 10:
                recommendations.append("Consider implementing additional security monitoring")
            
            if len(violations) > 0:
                recommendations.append("Review and address identified violations")
            
            return ComplianceReport(
                framework=framework,
                period_start=start_date,
                period_end=end_date,
                total_events=len(logs),
                critical_events=critical_events,
                violations=violations,
                recommendations=recommendations,
                generated_at=datetime.utcnow()
            )
    
    async def _build_user_response(self, user_row) -> UserResponse:
        """Build UserResponse from database row"""
        async with db_manager.pool.acquire() as conn:
            # Get user roles
            roles_data = await conn.fetch("""
                SELECT r.* FROM roles r
                JOIN user_roles ur ON r.id = ur.role_id
                WHERE ur.user_id = $1
            """, user_row["id"])
            
            roles = [
                Role(
                    id=role["id"],
                    name=role["name"],
                    description=role["description"],
                    permissions=json.loads(role["permissions"]) if role["permissions"] else [],
                    tenant_id=role["tenant_id"],
                    is_system_role=role["is_system_role"],
                    created_at=role["created_at"],
                    updated_at=role["updated_at"]
                )
                for role in roles_data
            ]
            
            profile_data = json.loads(user_row["profile"]) if user_row["profile"] else {}
            
            return UserResponse(
                id=user_row["id"],
                email=user_row["email"],
                profile=UserProfile(**profile_data),
                roles=roles,
                status=UserStatus(user_row["status"]),
                tenant_id=user_row["tenant_id"],
                last_login=user_row["last_login"],
                login_count=user_row["login_count"],
                failed_login_attempts=user_row["failed_login_attempts"],
                mfa_enabled=user_row["mfa_enabled"],
                expires_at=user_row["expires_at"],
                force_password_change=user_row["force_password_change"],
                created_at=user_row["created_at"],
                updated_at=user_row["updated_at"]
            )
    
    async def _verify_mfa_code(self, user_id: str, code: str) -> bool:
        """Verify MFA code (TOTP or backup code)"""
        async with db_manager.pool.acquire() as conn:
            mfa_data = await conn.fetchrow("""
                SELECT secret, backup_codes FROM user_mfa WHERE user_id = $1
            """, user_id)
            
            if not mfa_data:
                return False
            
            # Try TOTP first
            totp = pyotp.TOTP(mfa_data["secret"])
            if totp.verify(code, valid_window=1):
                return True
            
            # Try backup codes
            backup_codes = json.loads(mfa_data["backup_codes"]) if mfa_data["backup_codes"] else []
            if code.upper() in backup_codes:
                # Remove used backup code
                backup_codes.remove(code.upper())
                await conn.execute("""
                    UPDATE user_mfa SET backup_codes = $1 WHERE user_id = $2
                """, json.dumps(backup_codes), user_id)
                return True
            
            return False
    
    async def _log_audit_event(
        self,
        action: AuditAction,
        user_id: Optional[str] = None,
        resource: Optional[str] = None,
        resource_id: Optional[str] = None,
        details: Dict[str, Any] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        tenant_id: Optional[str] = None
    ):
        """Log audit event"""
        try:
            # Determine compliance frameworks
            compliance_frameworks = []
            
            # All events are relevant for SOC2
            compliance_frameworks.append(ComplianceFramework.SOC2.value)
            
            # Healthcare data access events for HIPAA
            if action in [AuditAction.DATA_ACCESS, AuditAction.DATA_EXPORT, AuditAction.LOGIN]:
                compliance_frameworks.append(ComplianceFramework.HIPAA.value)
            
            # Financial events for SOX
            if action in [AuditAction.ROLE_CHANGE, AuditAction.PERMISSION_CHANGE]:
                compliance_frameworks.append(ComplianceFramework.SOX.value)
            
            async with db_manager.pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO audit_logs (
                        id, user_id, action, resource, resource_id, details,
                        ip_address, user_agent, tenant_id, timestamp, compliance_frameworks
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                """, 
                    str(uuid.uuid4()), user_id, action.value, resource, resource_id,
                    json.dumps(details or {}), ip_address, user_agent, tenant_id,
                    datetime.utcnow(), json.dumps(compliance_frameworks)
                )
        except Exception as e:
            logger.error(f"Failed to log audit event: {e}")

user_service = EnhancedUserManagementService()

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
    title="Healthcare Claims Platform - Enhanced User Management Service",
    description="Advanced RBAC, audit logging, compliance features, and comprehensive user lifecycle management",
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
        # Enhanced users table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                profile JSONB,
                status VARCHAR(50) DEFAULT 'pending_verification',
                tenant_id UUID,
                last_login TIMESTAMP,
                login_count INTEGER DEFAULT 0,
                failed_login_attempts INTEGER DEFAULT 0,
                locked_at TIMESTAMP,
                mfa_enabled BOOLEAN DEFAULT false,
                expires_at TIMESTAMP,
                force_password_change BOOLEAN DEFAULT true,
                password_changed_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        # Password history table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS password_history (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        # User sessions table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS user_sessions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                ip_address INET,
                user_agent TEXT,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        # User MFA table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS user_mfa (
                user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                secret VARCHAR(255) NOT NULL,
                backup_codes JSONB,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        # Enhanced audit logs table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS audit_logs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID,
                action VARCHAR(50) NOT NULL,
                resource VARCHAR(100),
                resource_id VARCHAR(255),
                details JSONB,
                ip_address INET,
                user_agent TEXT,
                tenant_id UUID,
                timestamp TIMESTAMP DEFAULT NOW(),
                compliance_frameworks JSONB
            )
        """)
        
        # Create indices for performance
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
            CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
            CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
            CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id ON audit_logs(tenant_id);
        """)
        
        logger.info("Enhanced user management database tables initialized")

# Dependency to get current user
async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> Dict[str, Any]:
    """Get current authenticated user"""
    token_data = verify_token(credentials.credentials)
    
    # Verify session is still valid
    async with db_manager.pool.acquire() as conn:
        session = await conn.fetchrow("""
            SELECT * FROM user_sessions 
            WHERE id = $1 AND user_id = $2 AND expires_at > NOW()
        """, token_data.get("session_id"), token_data.get("sub"))
        
        if not session:
            raise HTTPException(status_code=401, detail="Session expired")
    
    return token_data

# API Endpoints
@app.post("/users", response_model=UserResponse)
async def create_user(user_data: UserCreate, current_user: Dict = Depends(get_current_user)):
    """Create new user"""
    return await user_service.create_user(user_data, current_user["sub"])

@app.post("/auth/login", response_model=LoginResponse)
async def login(login_data: LoginRequest, request: Request):
    """Authenticate user"""
    return await user_service.authenticate_user(login_data, request)

@app.get("/users/{user_id}", response_model=UserResponse)
async def get_user(user_id: str, current_user: Dict = Depends(get_current_user)):
    """Get user by ID"""
    return await user_service.get_user(user_id)

@app.put("/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: str, 
    update_data: UserUpdate, 
    current_user: Dict = Depends(get_current_user)
):
    """Update user"""
    return await user_service.update_user(user_id, update_data, current_user["sub"])

@app.post("/users/{user_id}/change-password")
async def change_password(
    user_id: str, 
    password_data: PasswordChangeRequest,
    current_user: Dict = Depends(get_current_user)
):
    """Change user password"""
    # Users can only change their own password unless they're admin
    if user_id != current_user["sub"]:
        raise HTTPException(status_code=403, detail="Can only change own password")
    
    return await user_service.change_password(user_id, password_data)

@app.post("/users/{user_id}/mfa/setup", response_model=MFASetupResponse)
async def setup_mfa(user_id: str, current_user: Dict = Depends(get_current_user)):
    """Setup MFA for user"""
    if user_id != current_user["sub"]:
        raise HTTPException(status_code=403, detail="Can only setup MFA for own account")
    
    return await user_service.setup_mfa(user_id)

@app.post("/users/{user_id}/mfa/enable")
async def enable_mfa(
    user_id: str, 
    verification_code: str,
    current_user: Dict = Depends(get_current_user)
):
    """Enable MFA after verification"""
    if user_id != current_user["sub"]:
        raise HTTPException(status_code=403, detail="Can only enable MFA for own account")
    
    return await user_service.enable_mfa(user_id, verification_code)

@app.get("/audit-logs")
async def get_audit_logs(
    user_id: Optional[str] = None,
    action: Optional[AuditAction] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    tenant_id: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    current_user: Dict = Depends(get_current_user)
):
    """Get audit logs"""
    return await user_service.get_audit_logs(
        user_id, action, start_date, end_date, tenant_id, limit, offset
    )

@app.get("/compliance/report/{framework}")
async def generate_compliance_report(
    framework: ComplianceFramework,
    start_date: datetime,
    end_date: datetime,
    tenant_id: Optional[str] = None,
    current_user: Dict = Depends(get_current_user)
):
    """Generate compliance report"""
    return await user_service.generate_compliance_report(
        framework, start_date, end_date, tenant_id
    )

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
            "service": "enhanced-user-management-service",
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
    uvicorn.run(app, host="0.0.0.0", port=8008)
