#!/usr/bin/env python3
"""
Healthcare Claims Platform - Authentication Service
Comprehensive authentication with JWT/OAuth2, MFA, and SSO support.

Author: Manus AI
Date: October 5, 2025
"""

from fastapi import FastAPI, HTTPException, Depends, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials, OAuth2PasswordBearer
from pydantic import BaseModel, EmailStr, validator
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
import uuid
import hashlib
import jwt
import pyotp
import qrcode
import io
import base64
import logging
from enum import Enum
import asyncio
import aioredis
import asyncpg
import os
import json
from contextlib import asynccontextmanager
import secrets
import bcrypt
from passlib.context import CryptContext

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost/healthcare_platform")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
JWT_SECRET = os.getenv("JWT_SECRET", "your-secret-key-change-in-production")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
REFRESH_TOKEN_EXPIRE_DAYS = 7
MFA_CODE_EXPIRE_MINUTES = 5

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Security
security = HTTPBearer()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

class AuthMethod(str, Enum):
    PASSWORD = "password"
    OAUTH2 = "oauth2"
    SAML = "saml"
    LDAP = "ldap"

class MFAMethod(str, Enum):
    TOTP = "totp"
    SMS = "sms"
    EMAIL = "email"

class SessionStatus(str, Enum):
    ACTIVE = "active"
    EXPIRED = "expired"
    REVOKED = "revoked"

class TokenType(str, Enum):
    ACCESS = "access"
    REFRESH = "refresh"
    RESET = "reset"
    VERIFICATION = "verification"

# Pydantic Models
class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    tenant_id: str
    remember_me: bool = False

class MFASetupRequest(BaseModel):
    method: MFAMethod

class MFAVerifyRequest(BaseModel):
    code: str
    method: MFAMethod

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    scope: str = "read write"

class MFASetupResponse(BaseModel):
    secret: str
    qr_code: str
    backup_codes: List[str]

class UserInfo(BaseModel):
    id: str
    email: str
    tenant_id: str
    role: str
    permissions: List[str]
    mfa_enabled: bool
    last_login: Optional[datetime]

class SessionInfo(BaseModel):
    id: str
    user_id: str
    tenant_id: str
    ip_address: str
    user_agent: str
    created_at: datetime
    last_activity: datetime
    expires_at: datetime
    status: SessionStatus

class PasswordResetRequest(BaseModel):
    email: EmailStr
    tenant_id: str

class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str

class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str

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
            logger.info("Database connections established")
        except Exception as e:
            logger.error(f"Failed to connect to database: {e}")
            raise
    
    async def disconnect(self):
        """Close database connections"""
        if self.pool:
            await self.pool.close()
        if self.redis:
            await self.redis.close()
        logger.info("Database connections closed")

db_manager = DatabaseManager()

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
    title="Healthcare Claims Platform - Authentication Service",
    description="Comprehensive authentication with JWT/OAuth2, MFA, and SSO support",
    version="1.0.0",
    lifespan=lifespan
)

async def initialize_database():
    """Initialize database tables"""
    async with db_manager.pool.acquire() as conn:
        # Create auth_sessions table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS auth_sessions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL,
                tenant_id UUID NOT NULL,
                session_token VARCHAR(255) UNIQUE NOT NULL,
                refresh_token VARCHAR(255) UNIQUE NOT NULL,
                ip_address INET,
                user_agent TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                last_activity TIMESTAMP DEFAULT NOW(),
                expires_at TIMESTAMP NOT NULL,
                status VARCHAR(50) DEFAULT 'active'
            )
        """)
        
        # Create mfa_settings table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS mfa_settings (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL,
                method VARCHAR(50) NOT NULL,
                secret VARCHAR(255),
                backup_codes JSONB DEFAULT '[]',
                enabled BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(user_id, method)
            )
        """)
        
        # Create password_reset_tokens table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL,
                token VARCHAR(255) UNIQUE NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                used BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        # Create login_attempts table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS login_attempts (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                email VARCHAR(255) NOT NULL,
                tenant_id UUID NOT NULL,
                ip_address INET,
                success BOOLEAN NOT NULL,
                failure_reason VARCHAR(255),
                attempted_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        logger.info("Authentication database tables initialized")

# Utility functions
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
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({"exp": expire, "type": TokenType.ACCESS.value})
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)

def create_refresh_token(data: dict) -> str:
    """Create JWT refresh token"""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": TokenType.REFRESH.value})
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)

def verify_token(token: str, token_type: TokenType = TokenType.ACCESS) -> dict:
    """Verify JWT token"""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != token_type.value:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token type"
            )
        return payload
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token"
        )

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """Get current user from JWT token"""
    payload = verify_token(credentials.credentials)
    user_id = payload.get("sub")
    tenant_id = payload.get("tenant_id")
    
    if user_id is None or tenant_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials"
        )
    
    # Check if session is still valid
    async with db_manager.pool.acquire() as conn:
        session = await conn.fetchrow("""
            SELECT * FROM auth_sessions 
            WHERE session_token = $1 AND status = 'active' AND expires_at > NOW()
        """, credentials.credentials)
        
        if not session:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired or invalid"
            )
        
        # Update last activity
        await conn.execute("""
            UPDATE auth_sessions 
            SET last_activity = NOW() 
            WHERE id = $1
        """, session["id"])
        
        # Get user info (assuming users table exists from user management service)
        user = await conn.fetchrow("""
            SELECT * FROM users 
            WHERE id = $1 AND tenant_id = $2 AND status = 'active'
        """, user_id, tenant_id)
        
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found or inactive"
            )
        
        return dict(user)

async def check_rate_limit(email: str, tenant_id: str, ip_address: str) -> bool:
    """Check if login attempts are within rate limit"""
    async with db_manager.pool.acquire() as conn:
        # Check failed attempts in last 15 minutes
        failed_attempts = await conn.fetchval("""
            SELECT COUNT(*) FROM login_attempts 
            WHERE email = $1 AND tenant_id = $2 AND success = false 
            AND attempted_at > NOW() - INTERVAL '15 minutes'
        """, email, tenant_id)
        
        # Allow max 5 failed attempts per 15 minutes
        return failed_attempts < 5

async def log_login_attempt(email: str, tenant_id: str, ip_address: str, success: bool, failure_reason: str = None):
    """Log login attempt"""
    async with db_manager.pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO login_attempts (email, tenant_id, ip_address, success, failure_reason)
            VALUES ($1, $2, $3, $4, $5)
        """, email, tenant_id, ip_address, success, failure_reason)

def generate_mfa_secret() -> str:
    """Generate MFA secret"""
    return pyotp.random_base32()

def generate_qr_code(secret: str, email: str, issuer: str = "Healthcare Claims Platform") -> str:
    """Generate QR code for MFA setup"""
    totp_uri = pyotp.totp.TOTP(secret).provisioning_uri(
        name=email,
        issuer_name=issuer
    )
    
    qr = qrcode.QRCode(version=1, box_size=10, border=5)
    qr.add_data(totp_uri)
    qr.make(fit=True)
    
    img = qr.make_image(fill_color="black", back_color="white")
    img_buffer = io.BytesIO()
    img.save(img_buffer, format='PNG')
    img_buffer.seek(0)
    
    return base64.b64encode(img_buffer.getvalue()).decode()

def generate_backup_codes(count: int = 10) -> List[str]:
    """Generate backup codes for MFA"""
    return [secrets.token_hex(4).upper() for _ in range(count)]

def verify_totp_code(secret: str, code: str) -> bool:
    """Verify TOTP code"""
    totp = pyotp.TOTP(secret)
    return totp.verify(code, valid_window=1)

# API Endpoints

@app.post("/auth/login", response_model=TokenResponse)
async def login(login_data: LoginRequest, request: Request):
    """Authenticate user and return JWT tokens"""
    client_ip = request.client.host
    
    # Check rate limiting
    if not await check_rate_limit(login_data.email, login_data.tenant_id, client_ip):
        await log_login_attempt(login_data.email, login_data.tenant_id, client_ip, False, "Rate limit exceeded")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed login attempts. Please try again later."
        )
    
    async with db_manager.pool.acquire() as conn:
        # Get user
        user = await conn.fetchrow("""
            SELECT * FROM users 
            WHERE email = $1 AND tenant_id = $2 AND status = 'active'
        """, login_data.email, login_data.tenant_id)
        
        if not user or not verify_password(login_data.password, user["password_hash"]):
            await log_login_attempt(login_data.email, login_data.tenant_id, client_ip, False, "Invalid credentials")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials"
            )
        
        # Check if MFA is enabled
        mfa_settings = await conn.fetchrow("""
            SELECT * FROM mfa_settings 
            WHERE user_id = $1 AND enabled = true
        """, user["id"])
        
        if mfa_settings:
            # Store pending session in Redis for MFA verification
            pending_session_id = str(uuid.uuid4())
            await db_manager.redis.setex(
                f"pending_mfa:{pending_session_id}",
                300,  # 5 minutes
                json.dumps({
                    "user_id": str(user["id"]),
                    "tenant_id": str(user["tenant_id"]),
                    "email": user["email"],
                    "ip_address": client_ip,
                    "user_agent": request.headers.get("user-agent", "")
                })
            )
            
            return {
                "requires_mfa": True,
                "mfa_session_id": pending_session_id,
                "mfa_methods": [mfa_settings["method"]]
            }
        
        # Create session
        session_token = create_access_token({
            "sub": str(user["id"]),
            "email": user["email"],
            "tenant_id": str(user["tenant_id"]),
            "role": user["role"]
        })
        
        refresh_token = create_refresh_token({
            "sub": str(user["id"]),
            "tenant_id": str(user["tenant_id"])
        })
        
        expires_at = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        if login_data.remember_me:
            expires_at = datetime.utcnow() + timedelta(days=30)
        
        # Store session in database
        await conn.execute("""
            INSERT INTO auth_sessions (
                user_id, tenant_id, session_token, refresh_token, 
                ip_address, user_agent, expires_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        """, user["id"], user["tenant_id"], session_token, refresh_token,
            client_ip, request.headers.get("user-agent", ""), expires_at)
        
        # Update last login
        await conn.execute("""
            UPDATE users SET last_login = NOW() WHERE id = $1
        """, user["id"])
        
        # Log successful login
        await log_login_attempt(login_data.email, login_data.tenant_id, client_ip, True)
        
        return TokenResponse(
            access_token=session_token,
            refresh_token=refresh_token,
            expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60
        )

@app.post("/auth/mfa/setup", response_model=MFASetupResponse)
async def setup_mfa(
    setup_request: MFASetupRequest,
    current_user: dict = Depends(get_current_user)
):
    """Setup MFA for user"""
    if setup_request.method != MFAMethod.TOTP:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only TOTP method is currently supported"
        )
    
    secret = generate_mfa_secret()
    qr_code = generate_qr_code(secret, current_user["email"])
    backup_codes = generate_backup_codes()
    
    async with db_manager.pool.acquire() as conn:
        # Save MFA settings (not enabled until verified)
        await conn.execute("""
            INSERT INTO mfa_settings (user_id, method, secret, backup_codes, enabled)
            VALUES ($1, $2, $3, $4, false)
            ON CONFLICT (user_id, method) 
            DO UPDATE SET secret = $3, backup_codes = $4, enabled = false
        """, current_user["id"], setup_request.method.value, secret, json.dumps(backup_codes))
    
    return MFASetupResponse(
        secret=secret,
        qr_code=qr_code,
        backup_codes=backup_codes
    )

@app.post("/auth/mfa/verify")
async def verify_mfa(verify_request: MFAVerifyRequest, current_user: dict = Depends(get_current_user)):
    """Verify and enable MFA"""
    async with db_manager.pool.acquire() as conn:
        mfa_settings = await conn.fetchrow("""
            SELECT * FROM mfa_settings 
            WHERE user_id = $1 AND method = $2
        """, current_user["id"], verify_request.method.value)
        
        if not mfa_settings:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="MFA not set up for this method"
            )
        
        # Verify code
        if verify_request.method == MFAMethod.TOTP:
            if not verify_totp_code(mfa_settings["secret"], verify_request.code):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid MFA code"
                )
        
        # Enable MFA
        await conn.execute("""
            UPDATE mfa_settings 
            SET enabled = true 
            WHERE user_id = $1 AND method = $2
        """, current_user["id"], verify_request.method.value)
    
    return {"message": "MFA enabled successfully"}

@app.post("/auth/mfa/login", response_model=TokenResponse)
async def mfa_login(
    mfa_session_id: str,
    verify_request: MFAVerifyRequest,
    request: Request
):
    """Complete MFA login"""
    # Get pending session
    pending_data = await db_manager.redis.get(f"pending_mfa:{mfa_session_id}")
    if not pending_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired MFA session"
        )
    
    session_data = json.loads(pending_data)
    
    async with db_manager.pool.acquire() as conn:
        # Get MFA settings
        mfa_settings = await conn.fetchrow("""
            SELECT * FROM mfa_settings 
            WHERE user_id = $1 AND method = $2 AND enabled = true
        """, session_data["user_id"], verify_request.method.value)
        
        if not mfa_settings:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="MFA not enabled for this method"
            )
        
        # Verify code
        if verify_request.method == MFAMethod.TOTP:
            if not verify_totp_code(mfa_settings["secret"], verify_request.code):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid MFA code"
                )
        
        # Get user info
        user = await conn.fetchrow("SELECT * FROM users WHERE id = $1", session_data["user_id"])
        
        # Create session
        session_token = create_access_token({
            "sub": session_data["user_id"],
            "email": session_data["email"],
            "tenant_id": session_data["tenant_id"],
            "role": user["role"]
        })
        
        refresh_token = create_refresh_token({
            "sub": session_data["user_id"],
            "tenant_id": session_data["tenant_id"]
        })
        
        expires_at = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        
        # Store session in database
        await conn.execute("""
            INSERT INTO auth_sessions (
                user_id, tenant_id, session_token, refresh_token, 
                ip_address, user_agent, expires_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        """, session_data["user_id"], session_data["tenant_id"], session_token, refresh_token,
            session_data["ip_address"], session_data["user_agent"], expires_at)
        
        # Update last login
        await conn.execute("""
            UPDATE users SET last_login = NOW() WHERE id = $1
        """, session_data["user_id"])
        
        # Clean up pending session
        await db_manager.redis.delete(f"pending_mfa:{mfa_session_id}")
        
        return TokenResponse(
            access_token=session_token,
            refresh_token=refresh_token,
            expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60
        )

@app.post("/auth/refresh", response_model=TokenResponse)
async def refresh_token(refresh_token: str):
    """Refresh access token"""
    payload = verify_token(refresh_token, TokenType.REFRESH)
    user_id = payload.get("sub")
    tenant_id = payload.get("tenant_id")
    
    async with db_manager.pool.acquire() as conn:
        # Verify refresh token exists and is valid
        session = await conn.fetchrow("""
            SELECT * FROM auth_sessions 
            WHERE refresh_token = $1 AND status = 'active' AND expires_at > NOW()
        """, refresh_token)
        
        if not session:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid refresh token"
            )
        
        # Get user info
        user = await conn.fetchrow("""
            SELECT * FROM users 
            WHERE id = $1 AND tenant_id = $2 AND status = 'active'
        """, user_id, tenant_id)
        
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found or inactive"
            )
        
        # Create new access token
        new_access_token = create_access_token({
            "sub": str(user["id"]),
            "email": user["email"],
            "tenant_id": str(user["tenant_id"]),
            "role": user["role"]
        })
        
        # Update session token
        await conn.execute("""
            UPDATE auth_sessions 
            SET session_token = $1, last_activity = NOW()
            WHERE id = $2
        """, new_access_token, session["id"])
        
        return TokenResponse(
            access_token=new_access_token,
            refresh_token=refresh_token,
            expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60
        )

@app.post("/auth/logout")
async def logout(current_user: dict = Depends(get_current_user), credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Logout user and revoke session"""
    async with db_manager.pool.acquire() as conn:
        await conn.execute("""
            UPDATE auth_sessions 
            SET status = 'revoked' 
            WHERE session_token = $1
        """, credentials.credentials)
    
    return {"message": "Logged out successfully"}

@app.get("/auth/me", response_model=UserInfo)
async def get_user_info(current_user: dict = Depends(get_current_user)):
    """Get current user information"""
    async with db_manager.pool.acquire() as conn:
        # Check if MFA is enabled
        mfa_enabled = await conn.fetchval("""
            SELECT EXISTS(
                SELECT 1 FROM mfa_settings 
                WHERE user_id = $1 AND enabled = true
            )
        """, current_user["id"])
        
        # Get user permissions (simplified - would integrate with user management service)
        permissions = ["read", "write"]  # Placeholder
        
        return UserInfo(
            id=str(current_user["id"]),
            email=current_user["email"],
            tenant_id=str(current_user["tenant_id"]),
            role=current_user["role"],
            permissions=permissions,
            mfa_enabled=mfa_enabled,
            last_login=current_user["last_login"]
        )

@app.get("/auth/sessions", response_model=List[SessionInfo])
async def list_sessions(current_user: dict = Depends(get_current_user)):
    """List active sessions for current user"""
    async with db_manager.pool.acquire() as conn:
        sessions = await conn.fetch("""
            SELECT * FROM auth_sessions 
            WHERE user_id = $1 AND status = 'active'
            ORDER BY last_activity DESC
        """, current_user["id"])
        
        return [
            SessionInfo(
                id=str(session["id"]),
                user_id=str(session["user_id"]),
                tenant_id=str(session["tenant_id"]),
                ip_address=str(session["ip_address"]),
                user_agent=session["user_agent"],
                created_at=session["created_at"],
                last_activity=session["last_activity"],
                expires_at=session["expires_at"],
                status=SessionStatus(session["status"])
            )
            for session in sessions
        ]

@app.delete("/auth/sessions/{session_id}")
async def revoke_session(session_id: str, current_user: dict = Depends(get_current_user)):
    """Revoke a specific session"""
    async with db_manager.pool.acquire() as conn:
        result = await conn.execute("""
            UPDATE auth_sessions 
            SET status = 'revoked' 
            WHERE id = $1 AND user_id = $2
        """, session_id, current_user["id"])
        
        if result == "UPDATE 0":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Session not found"
            )
    
    return {"message": "Session revoked successfully"}

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
            "service": "authentication-service",
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
    uvicorn.run(app, host="0.0.0.0", port=8003)
