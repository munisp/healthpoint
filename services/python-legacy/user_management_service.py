#!/usr/bin/env python3
"""
Healthcare Claims Platform - User Management Service
A comprehensive microservice for managing users, roles, and multi-tenant access control.

Author: Manus AI
Date: October 5, 2025
"""

from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
import uuid
import hashlib
import jwt
import logging
from enum import Enum
import asyncio
import aioredis
import asyncpg
import os
from contextlib import asynccontextmanager

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost/healthcare_platform")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
JWT_SECRET = os.getenv("JWT_SECRET", "your-secret-key-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

# Security
security = HTTPBearer()

class UserRole(str, Enum):
    SUPER_ADMIN = "super_admin"
    TENANT_ADMIN = "tenant_admin"
    PROVIDER_ADMIN = "provider_admin"
    PROVIDER_USER = "provider_user"
    MEMBER = "member"
    AUDITOR = "auditor"
    SUPPORT = "support"

class UserStatus(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    SUSPENDED = "suspended"
    PENDING = "pending"

class Permission(str, Enum):
    # User Management
    CREATE_USER = "create_user"
    READ_USER = "read_user"
    UPDATE_USER = "update_user"
    DELETE_USER = "delete_user"
    
    # Claims Management
    CREATE_CLAIM = "create_claim"
    READ_CLAIM = "read_claim"
    UPDATE_CLAIM = "update_claim"
    DELETE_CLAIM = "delete_claim"
    APPROVE_CLAIM = "approve_claim"
    
    # Provider Management
    CREATE_PROVIDER = "create_provider"
    READ_PROVIDER = "read_provider"
    UPDATE_PROVIDER = "update_provider"
    DELETE_PROVIDER = "delete_provider"
    
    # Billing Management
    READ_BILLING = "read_billing"
    CREATE_BILLING = "create_billing"
    UPDATE_BILLING = "update_billing"
    PROCESS_PAYMENT = "process_payment"
    
    # Reporting
    READ_REPORTS = "read_reports"
    CREATE_REPORTS = "create_reports"
    EXPORT_DATA = "export_data"
    
    # System Administration
    MANAGE_TENANTS = "manage_tenants"
    SYSTEM_CONFIG = "system_config"
    VIEW_AUDIT_LOGS = "view_audit_logs"

# Role-Permission Mapping
ROLE_PERMISSIONS = {
    UserRole.SUPER_ADMIN: [p for p in Permission],  # All permissions
    UserRole.TENANT_ADMIN: [
        Permission.CREATE_USER, Permission.READ_USER, Permission.UPDATE_USER, Permission.DELETE_USER,
        Permission.CREATE_CLAIM, Permission.READ_CLAIM, Permission.UPDATE_CLAIM, Permission.DELETE_CLAIM,
        Permission.APPROVE_CLAIM, Permission.CREATE_PROVIDER, Permission.READ_PROVIDER,
        Permission.UPDATE_PROVIDER, Permission.DELETE_PROVIDER, Permission.READ_BILLING,
        Permission.CREATE_BILLING, Permission.UPDATE_BILLING, Permission.PROCESS_PAYMENT,
        Permission.READ_REPORTS, Permission.CREATE_REPORTS, Permission.EXPORT_DATA,
        Permission.VIEW_AUDIT_LOGS
    ],
    UserRole.PROVIDER_ADMIN: [
        Permission.CREATE_USER, Permission.READ_USER, Permission.UPDATE_USER,
        Permission.CREATE_CLAIM, Permission.READ_CLAIM, Permission.UPDATE_CLAIM,
        Permission.READ_PROVIDER, Permission.UPDATE_PROVIDER, Permission.READ_BILLING,
        Permission.READ_REPORTS, Permission.CREATE_REPORTS
    ],
    UserRole.PROVIDER_USER: [
        Permission.READ_USER, Permission.CREATE_CLAIM, Permission.READ_CLAIM,
        Permission.UPDATE_CLAIM, Permission.READ_PROVIDER, Permission.READ_BILLING,
        Permission.READ_REPORTS
    ],
    UserRole.MEMBER: [
        Permission.READ_USER, Permission.READ_CLAIM, Permission.READ_BILLING
    ],
    UserRole.AUDITOR: [
        Permission.READ_USER, Permission.READ_CLAIM, Permission.READ_PROVIDER,
        Permission.READ_BILLING, Permission.READ_REPORTS, Permission.EXPORT_DATA,
        Permission.VIEW_AUDIT_LOGS
    ],
    UserRole.SUPPORT: [
        Permission.READ_USER, Permission.UPDATE_USER, Permission.READ_CLAIM,
        Permission.READ_PROVIDER, Permission.READ_BILLING, Permission.READ_REPORTS
    ]
}

# Pydantic Models
class UserBase(BaseModel):
    email: EmailStr
    first_name: str
    last_name: str
    phone: Optional[str] = None
    tenant_id: str
    role: UserRole
    status: UserStatus = UserStatus.PENDING

class UserCreate(UserBase):
    password: str

class UserUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[UserRole] = None
    status: Optional[UserStatus] = None

class UserResponse(UserBase):
    id: str
    created_at: datetime
    updated_at: datetime
    last_login: Optional[datetime] = None
    permissions: List[Permission]

class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    tenant_id: str

class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserResponse

class TenantBase(BaseModel):
    name: str
    domain: str
    status: str = "active"
    settings: Dict[str, Any] = {}

class TenantCreate(TenantBase):
    pass

class TenantResponse(TenantBase):
    id: str
    created_at: datetime
    updated_at: datetime

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
    title="Healthcare Claims Platform - User Management Service",
    description="Comprehensive user management with RBAC and multi-tenant support",
    version="1.0.0",
    lifespan=lifespan
)

# Utility functions
def hash_password(password: str) -> str:
    """Hash password using SHA-256"""
    return hashlib.sha256(password.encode()).hexdigest()

def verify_password(password: str, hashed: str) -> bool:
    """Verify password against hash"""
    return hash_password(password) == hashed

def create_access_token(data: dict) -> str:
    """Create JWT access token"""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """Get current user from JWT token"""
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
        tenant_id = payload.get("tenant_id")
        
        if user_id is None or tenant_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials"
            )
        
        # Get user from database
        async with db_manager.pool.acquire() as conn:
            user = await conn.fetchrow(
                "SELECT * FROM users WHERE id = $1 AND tenant_id = $2 AND status = 'active'",
                user_id, tenant_id
            )
            
            if not user:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="User not found or inactive"
                )
            
            return dict(user)
    
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials"
        )

def check_permission(required_permission: Permission):
    """Decorator to check if user has required permission"""
    def decorator(func):
        async def wrapper(*args, current_user: dict = Depends(get_current_user), **kwargs):
            user_role = UserRole(current_user["role"])
            user_permissions = ROLE_PERMISSIONS.get(user_role, [])
            
            if required_permission not in user_permissions:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Insufficient permissions"
                )
            
            return await func(*args, current_user=current_user, **kwargs)
        return wrapper
    return decorator

async def initialize_database():
    """Initialize database tables"""
    async with db_manager.pool.acquire() as conn:
        # Create tenants table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS tenants (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR(255) NOT NULL,
                domain VARCHAR(255) UNIQUE NOT NULL,
                status VARCHAR(50) DEFAULT 'active',
                settings JSONB DEFAULT '{}',
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        # Create users table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                email VARCHAR(255) NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                first_name VARCHAR(255) NOT NULL,
                last_name VARCHAR(255) NOT NULL,
                phone VARCHAR(50),
                tenant_id UUID NOT NULL REFERENCES tenants(id),
                role VARCHAR(50) NOT NULL,
                status VARCHAR(50) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                last_login TIMESTAMP,
                UNIQUE(email, tenant_id)
            )
        """)
        
        # Create audit logs table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS audit_logs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID REFERENCES users(id),
                tenant_id UUID REFERENCES tenants(id),
                action VARCHAR(255) NOT NULL,
                resource VARCHAR(255) NOT NULL,
                resource_id VARCHAR(255),
                details JSONB DEFAULT '{}',
                ip_address INET,
                user_agent TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        logger.info("Database tables initialized")

async def log_audit_event(user_id: str, tenant_id: str, action: str, resource: str, 
                         resource_id: str = None, details: dict = None):
    """Log audit event"""
    async with db_manager.pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO audit_logs (user_id, tenant_id, action, resource, resource_id, details)
            VALUES ($1, $2, $3, $4, $5, $6)
        """, user_id, tenant_id, action, resource, resource_id, details or {})

# API Endpoints

@app.post("/auth/login", response_model=LoginResponse)
async def login(login_data: LoginRequest):
    """Authenticate user and return JWT token"""
    async with db_manager.pool.acquire() as conn:
        user = await conn.fetchrow("""
            SELECT u.*, t.name as tenant_name 
            FROM users u 
            JOIN tenants t ON u.tenant_id = t.id 
            WHERE u.email = $1 AND u.tenant_id = $2 AND u.status = 'active'
        """, login_data.email, login_data.tenant_id)
        
        if not user or not verify_password(login_data.password, user["password_hash"]):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials"
            )
        
        # Update last login
        await conn.execute(
            "UPDATE users SET last_login = NOW() WHERE id = $1",
            user["id"]
        )
        
        # Create access token
        token_data = {
            "sub": str(user["id"]),
            "email": user["email"],
            "tenant_id": str(user["tenant_id"]),
            "role": user["role"]
        }
        access_token = create_access_token(token_data)
        
        # Get user permissions
        user_role = UserRole(user["role"])
        permissions = ROLE_PERMISSIONS.get(user_role, [])
        
        # Log audit event
        await log_audit_event(
            str(user["id"]), str(user["tenant_id"]), 
            "LOGIN", "USER", str(user["id"])
        )
        
        user_response = UserResponse(
            id=str(user["id"]),
            email=user["email"],
            first_name=user["first_name"],
            last_name=user["last_name"],
            phone=user["phone"],
            tenant_id=str(user["tenant_id"]),
            role=UserRole(user["role"]),
            status=UserStatus(user["status"]),
            created_at=user["created_at"],
            updated_at=user["updated_at"],
            last_login=user["last_login"],
            permissions=permissions
        )
        
        return LoginResponse(
            access_token=access_token,
            expires_in=JWT_EXPIRATION_HOURS * 3600,
            user=user_response
        )

@app.post("/tenants", response_model=TenantResponse)
@check_permission(Permission.MANAGE_TENANTS)
async def create_tenant(tenant_data: TenantCreate, current_user: dict = Depends(get_current_user)):
    """Create a new tenant (Super Admin only)"""
    async with db_manager.pool.acquire() as conn:
        # Check if domain already exists
        existing = await conn.fetchrow("SELECT id FROM tenants WHERE domain = $1", tenant_data.domain)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Domain already exists"
            )
        
        # Create tenant
        tenant_id = await conn.fetchval("""
            INSERT INTO tenants (name, domain, status, settings)
            VALUES ($1, $2, $3, $4)
            RETURNING id
        """, tenant_data.name, tenant_data.domain, tenant_data.status, tenant_data.settings)
        
        # Get created tenant
        tenant = await conn.fetchrow("SELECT * FROM tenants WHERE id = $1", tenant_id)
        
        # Log audit event
        await log_audit_event(
            current_user["id"], current_user["tenant_id"],
            "CREATE", "TENANT", str(tenant_id)
        )
        
        return TenantResponse(
            id=str(tenant["id"]),
            name=tenant["name"],
            domain=tenant["domain"],
            status=tenant["status"],
            settings=tenant["settings"],
            created_at=tenant["created_at"],
            updated_at=tenant["updated_at"]
        )

@app.get("/tenants", response_model=List[TenantResponse])
@check_permission(Permission.MANAGE_TENANTS)
async def list_tenants(current_user: dict = Depends(get_current_user)):
    """List all tenants (Super Admin only)"""
    async with db_manager.pool.acquire() as conn:
        tenants = await conn.fetch("SELECT * FROM tenants ORDER BY created_at DESC")
        
        return [
            TenantResponse(
                id=str(tenant["id"]),
                name=tenant["name"],
                domain=tenant["domain"],
                status=tenant["status"],
                settings=tenant["settings"],
                created_at=tenant["created_at"],
                updated_at=tenant["updated_at"]
            )
            for tenant in tenants
        ]

@app.post("/users", response_model=UserResponse)
@check_permission(Permission.CREATE_USER)
async def create_user(user_data: UserCreate, current_user: dict = Depends(get_current_user)):
    """Create a new user"""
    async with db_manager.pool.acquire() as conn:
        # Check if user already exists
        existing = await conn.fetchrow(
            "SELECT id FROM users WHERE email = $1 AND tenant_id = $2",
            user_data.email, user_data.tenant_id
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User already exists"
            )
        
        # Verify tenant exists
        tenant = await conn.fetchrow("SELECT id FROM tenants WHERE id = $1", user_data.tenant_id)
        if not tenant:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Tenant not found"
            )
        
        # Hash password
        password_hash = hash_password(user_data.password)
        
        # Create user
        user_id = await conn.fetchval("""
            INSERT INTO users (email, password_hash, first_name, last_name, phone, tenant_id, role, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id
        """, user_data.email, password_hash, user_data.first_name, user_data.last_name,
            user_data.phone, user_data.tenant_id, user_data.role.value, user_data.status.value)
        
        # Get created user
        user = await conn.fetchrow("SELECT * FROM users WHERE id = $1", user_id)
        
        # Get user permissions
        permissions = ROLE_PERMISSIONS.get(user_data.role, [])
        
        # Log audit event
        await log_audit_event(
            current_user["id"], current_user["tenant_id"],
            "CREATE", "USER", str(user_id)
        )
        
        return UserResponse(
            id=str(user["id"]),
            email=user["email"],
            first_name=user["first_name"],
            last_name=user["last_name"],
            phone=user["phone"],
            tenant_id=str(user["tenant_id"]),
            role=UserRole(user["role"]),
            status=UserStatus(user["status"]),
            created_at=user["created_at"],
            updated_at=user["updated_at"],
            last_login=user["last_login"],
            permissions=permissions
        )

@app.get("/users", response_model=List[UserResponse])
@check_permission(Permission.READ_USER)
async def list_users(current_user: dict = Depends(get_current_user), skip: int = 0, limit: int = 100):
    """List users in the current tenant"""
    async with db_manager.pool.acquire() as conn:
        users = await conn.fetch("""
            SELECT * FROM users 
            WHERE tenant_id = $1 
            ORDER BY created_at DESC 
            LIMIT $2 OFFSET $3
        """, current_user["tenant_id"], limit, skip)
        
        result = []
        for user in users:
            user_role = UserRole(user["role"])
            permissions = ROLE_PERMISSIONS.get(user_role, [])
            
            result.append(UserResponse(
                id=str(user["id"]),
                email=user["email"],
                first_name=user["first_name"],
                last_name=user["last_name"],
                phone=user["phone"],
                tenant_id=str(user["tenant_id"]),
                role=user_role,
                status=UserStatus(user["status"]),
                created_at=user["created_at"],
                updated_at=user["updated_at"],
                last_login=user["last_login"],
                permissions=permissions
            ))
        
        return result

@app.get("/users/{user_id}", response_model=UserResponse)
@check_permission(Permission.READ_USER)
async def get_user(user_id: str, current_user: dict = Depends(get_current_user)):
    """Get a specific user"""
    async with db_manager.pool.acquire() as conn:
        user = await conn.fetchrow("""
            SELECT * FROM users 
            WHERE id = $1 AND tenant_id = $2
        """, user_id, current_user["tenant_id"])
        
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )
        
        user_role = UserRole(user["role"])
        permissions = ROLE_PERMISSIONS.get(user_role, [])
        
        return UserResponse(
            id=str(user["id"]),
            email=user["email"],
            first_name=user["first_name"],
            last_name=user["last_name"],
            phone=user["phone"],
            tenant_id=str(user["tenant_id"]),
            role=user_role,
            status=UserStatus(user["status"]),
            created_at=user["created_at"],
            updated_at=user["updated_at"],
            last_login=user["last_login"],
            permissions=permissions
        )

@app.put("/users/{user_id}", response_model=UserResponse)
@check_permission(Permission.UPDATE_USER)
async def update_user(user_id: str, user_data: UserUpdate, current_user: dict = Depends(get_current_user)):
    """Update a user"""
    async with db_manager.pool.acquire() as conn:
        # Check if user exists
        existing_user = await conn.fetchrow("""
            SELECT * FROM users 
            WHERE id = $1 AND tenant_id = $2
        """, user_id, current_user["tenant_id"])
        
        if not existing_user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )
        
        # Build update query
        update_fields = []
        update_values = []
        param_count = 1
        
        if user_data.first_name is not None:
            update_fields.append(f"first_name = ${param_count}")
            update_values.append(user_data.first_name)
            param_count += 1
        
        if user_data.last_name is not None:
            update_fields.append(f"last_name = ${param_count}")
            update_values.append(user_data.last_name)
            param_count += 1
        
        if user_data.phone is not None:
            update_fields.append(f"phone = ${param_count}")
            update_values.append(user_data.phone)
            param_count += 1
        
        if user_data.role is not None:
            update_fields.append(f"role = ${param_count}")
            update_values.append(user_data.role.value)
            param_count += 1
        
        if user_data.status is not None:
            update_fields.append(f"status = ${param_count}")
            update_values.append(user_data.status.value)
            param_count += 1
        
        if not update_fields:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No fields to update"
            )
        
        update_fields.append("updated_at = NOW()")
        update_values.extend([user_id, current_user["tenant_id"]])
        
        query = f"""
            UPDATE users 
            SET {', '.join(update_fields)}
            WHERE id = ${param_count} AND tenant_id = ${param_count + 1}
            RETURNING *
        """
        
        updated_user = await conn.fetchrow(query, *update_values)
        
        # Get user permissions
        user_role = UserRole(updated_user["role"])
        permissions = ROLE_PERMISSIONS.get(user_role, [])
        
        # Log audit event
        await log_audit_event(
            current_user["id"], current_user["tenant_id"],
            "UPDATE", "USER", user_id, user_data.dict(exclude_unset=True)
        )
        
        return UserResponse(
            id=str(updated_user["id"]),
            email=updated_user["email"],
            first_name=updated_user["first_name"],
            last_name=updated_user["last_name"],
            phone=updated_user["phone"],
            tenant_id=str(updated_user["tenant_id"]),
            role=user_role,
            status=UserStatus(updated_user["status"]),
            created_at=updated_user["created_at"],
            updated_at=updated_user["updated_at"],
            last_login=updated_user["last_login"],
            permissions=permissions
        )

@app.delete("/users/{user_id}")
@check_permission(Permission.DELETE_USER)
async def delete_user(user_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a user (soft delete by setting status to inactive)"""
    async with db_manager.pool.acquire() as conn:
        result = await conn.execute("""
            UPDATE users 
            SET status = 'inactive', updated_at = NOW()
            WHERE id = $1 AND tenant_id = $2
        """, user_id, current_user["tenant_id"])
        
        if result == "UPDATE 0":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )
        
        # Log audit event
        await log_audit_event(
            current_user["id"], current_user["tenant_id"],
            "DELETE", "USER", user_id
        )
        
        return {"message": "User deleted successfully"}

@app.get("/me", response_model=UserResponse)
async def get_current_user_info(current_user: dict = Depends(get_current_user)):
    """Get current user information"""
    user_role = UserRole(current_user["role"])
    permissions = ROLE_PERMISSIONS.get(user_role, [])
    
    return UserResponse(
        id=str(current_user["id"]),
        email=current_user["email"],
        first_name=current_user["first_name"],
        last_name=current_user["last_name"],
        phone=current_user["phone"],
        tenant_id=str(current_user["tenant_id"]),
        role=user_role,
        status=UserStatus(current_user["status"]),
        created_at=current_user["created_at"],
        updated_at=current_user["updated_at"],
        last_login=current_user["last_login"],
        permissions=permissions
    )

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        # Check database connection
        async with db_manager.pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        
        # Check Redis connection
        await db_manager.redis.ping()
        
        return {
            "status": "healthy",
            "timestamp": datetime.utcnow().isoformat(),
            "service": "user-management-service",
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
    uvicorn.run(app, host="0.0.0.0", port=8001)
