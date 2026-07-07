#!/usr/bin/env python3
"""
Healthcare Claims Platform - Simplified Enhanced User Management Service
Basic enhanced user management service without Redis dependency for testing.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from typing import List, Optional, Dict, Any
from datetime import datetime
import uuid
import logging
import hashlib

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Pydantic Models
class UserCreate(BaseModel):
    email: EmailStr
    first_name: str
    last_name: str
    role: str
    tenant_id: str
    password: str

class UserUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: Optional[str] = None
    active: Optional[bool] = None

class UserResponse(BaseModel):
    id: str
    email: str
    first_name: str
    last_name: str
    role: str
    tenant_id: str
    active: bool
    created_at: str
    last_login: Optional[str] = None

class AuditLog(BaseModel):
    id: str
    user_id: str
    action: str
    resource: str
    timestamp: str
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None

# In-memory storage for testing
users_db = {}
audit_logs_db = {}

# FastAPI app
app = FastAPI(
    title="Healthcare Claims Platform - Enhanced User Management Service",
    description="Simplified enhanced user management service for testing",
    version="1.0.0"
)

# Add middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def log_audit_event(user_id: str, action: str, resource: str, ip_address: str = None):
    """Log audit event"""
    audit_id = str(uuid.uuid4())
    audit_log = {
        "id": audit_id,
        "user_id": user_id,
        "action": action,
        "resource": resource,
        "timestamp": datetime.utcnow().isoformat(),
        "ip_address": ip_address,
        "user_agent": "API"
    }
    audit_logs_db[audit_id] = audit_log

@app.post("/users", response_model=UserResponse)
async def create_user(user: UserCreate):
    """Create new user"""
    try:
        # Check if user already exists
        if any(u["email"] == user.email for u in users_db.values()):
            raise HTTPException(status_code=400, detail="User already exists")
        
        user_id = str(uuid.uuid4())
        password_hash = hashlib.sha256(user.password.encode()).hexdigest()
        
        user_record = {
            "id": user_id,
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "role": user.role,
            "tenant_id": user.tenant_id,
            "password_hash": password_hash,
            "active": True,
            "created_at": datetime.utcnow().isoformat(),
            "last_login": None
        }
        
        users_db[user_id] = user_record
        log_audit_event(user_id, "CREATE", f"user:{user_id}")
        
        logger.info(f"User created: {user_id} - {user.email}")
        
        return UserResponse(**{k: v for k, v in user_record.items() if k != "password_hash"})
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create user: {e}")
        raise HTTPException(status_code=500, detail="Failed to create user")

@app.get("/users/{user_id}", response_model=UserResponse)
async def get_user(user_id: str):
    """Get user by ID"""
    try:
        user = users_db.get(user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        return UserResponse(**{k: v for k, v in user.items() if k != "password_hash"})
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get user: {e}")
        raise HTTPException(status_code=500, detail="Failed to get user")

@app.put("/users/{user_id}", response_model=UserResponse)
async def update_user(user_id: str, user_update: UserUpdate):
    """Update user"""
    try:
        user = users_db.get(user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Update fields
        update_data = user_update.dict(exclude_unset=True)
        for field, value in update_data.items():
            user[field] = value
        
        users_db[user_id] = user
        log_audit_event(user_id, "UPDATE", f"user:{user_id}")
        
        logger.info(f"User updated: {user_id}")
        
        return UserResponse(**{k: v for k, v in user.items() if k != "password_hash"})
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update user: {e}")
        raise HTTPException(status_code=500, detail="Failed to update user")

@app.delete("/users/{user_id}")
async def delete_user(user_id: str):
    """Delete user"""
    try:
        user = users_db.get(user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        del users_db[user_id]
        log_audit_event(user_id, "DELETE", f"user:{user_id}")
        
        logger.info(f"User deleted: {user_id}")
        
        return {"message": "User deleted successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete user: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete user")

@app.get("/users")
async def list_users(limit: int = 100, offset: int = 0, tenant_id: Optional[str] = None):
    """List users"""
    try:
        users = list(users_db.values())
        
        # Filter by tenant if specified
        if tenant_id:
            users = [u for u in users if u["tenant_id"] == tenant_id]
        
        users.sort(key=lambda x: x["created_at"], reverse=True)
        
        # Remove password hashes
        users_response = [
            {k: v for k, v in user.items() if k != "password_hash"}
            for user in users[offset:offset+limit]
        ]
        
        return {
            "users": users_response,
            "total": len(users),
            "limit": limit,
            "offset": offset
        }
        
    except Exception as e:
        logger.error(f"Failed to list users: {e}")
        raise HTTPException(status_code=500, detail="Failed to list users")

@app.get("/audit-logs")
async def get_audit_logs(limit: int = 100, offset: int = 0, user_id: Optional[str] = None):
    """Get audit logs"""
    try:
        logs = list(audit_logs_db.values())
        
        # Filter by user if specified
        if user_id:
            logs = [log for log in logs if log["user_id"] == user_id]
        
        logs.sort(key=lambda x: x["timestamp"], reverse=True)
        
        return {
            "audit_logs": logs[offset:offset+limit],
            "total": len(logs),
            "limit": limit,
            "offset": offset
        }
        
    except Exception as e:
        logger.error(f"Failed to get audit logs: {e}")
        raise HTTPException(status_code=500, detail="Failed to get audit logs")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "service": "enhanced-user-management-service",
        "version": "1.0.0",
        "users_count": len(users_db),
        "audit_logs_count": len(audit_logs_db)
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8008)
