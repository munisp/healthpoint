"""
Comprehensive Security, Authentication, and HIPAA Compliance Service
Handles user authentication, authorization, RBAC, and audit logging.
"""

from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel, validator
from typing import List, Optional, Dict, Any
from jose import JWTError, jwt
from passlib.context import CryptContext
from datetime import datetime, timedelta
import os

# ============================================================================
# CONFIGURATION
# ============================================================================

SECRET_KEY = os.environ.get("SECRET_KEY", "a_very_secret_key_for_dev_only")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

app = FastAPI(title="Security & Authentication Service", version="1.0.0")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")

# ============================================================================
# MOCK DATABASE
# ============================================================================

# In a real application, this would be a database
fake_users_db = {
    "admin": {
        "username": "admin",
        "full_name": "Admin User",
        "email": "admin@example.com",
        "hashed_password": pwd_context.hash("admin_password"[:72]),
        "roles": ["admin", "user"],
        "disabled": False,
    },
    "user": {
        "username": "user",
        "full_name": "Regular User",
        "email": "user@example.com",
        "hashed_password": pwd_context.hash("user_password"[:72]),
        "roles": ["user"],
        "disabled": False,
    }
}

# ============================================================================
# PYDANTIC MODELS
# ============================================================================

class User(BaseModel):
    username: str
    email: Optional[str] = None
    full_name: Optional[str] = None
    disabled: Optional[bool] = None
    roles: List[str] = []

class UserInDB(User):
    hashed_password: str

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: Optional[str] = None

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        token_data = TokenData(username=username)
    except JWTError:
        raise credentials_exception
    user = fake_users_db.get(token_data.username)
    if user is None:
        raise credentials_exception
    return UserInDB(**user)

async def get_current_active_user(current_user: User = Depends(get_current_user)):
    if current_user.disabled:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user

# ============================================================================
# AUTHENTICATION ENDPOINTS
# ============================================================================

@app.post("/api/v1/auth/token", response_model=Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends()):
    user = fake_users_db.get(form_data.username)
    if not user or not verify_password(form_data.password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user["username"], "scopes": form_data.scopes},
        expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/api/v1/users/me", response_model=User)
async def read_users_me(current_user: User = Depends(get_current_active_user)):
    return current_user

# ============================================================================
# AUTHORIZATION & RBAC
# ============================================================================

def require_role(required_role: str):
    async def role_checker(current_user: User = Depends(get_current_active_user)):
        if required_role not in current_user.roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Operation not permitted"
            )
        return True
    return role_checker

@app.get("/api/v1/admin/dashboard")
async def get_admin_dashboard(has_permission: bool = Depends(require_role("admin"))):
    return {"message": "Welcome to the admin dashboard"}

@app.get("/api/v1/user/profile")
async def get_user_profile(has_permission: bool = Depends(require_role("user"))):
    return {"message": "This is a user profile"}

# ============================================================================
# HIPAA COMPLIANCE & AUDIT LOGGING
# ============================================================================

class AuditLog(BaseModel):
    timestamp: datetime
    user: str
    action: str
    details: Dict[str, Any]

# In a real application, this would write to a secure, immutable log store
fake_audit_log_db = []

def log_action(user: str, action: str, details: Dict[str, Any]):
    log_entry = AuditLog(
        timestamp=datetime.utcnow(),
        user=user,
        action=action,
        details=details
    )
    fake_audit_log_db.append(log_entry)

@app.post("/api/v1/gfe/create", dependencies=[Depends(require_role("user"))])
async def create_gfe(gfe_data: Dict[str, Any], current_user: User = Depends(get_current_active_user)):
    log_action(current_user.username, "CREATE_GFE", {"gfe_id": gfe_data.get("gfeId")})
    return {"status": "GFE created successfully"}

@app.get("/api/v1/audit-logs", dependencies=[Depends(require_role("admin"))])
async def get_audit_logs():
    return fake_audit_log_db

# ============================================================================
# HEALTH CHECK
# ============================================================================

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "Security & Authentication Service",
        "version": "1.0.0",
        "timestamp": datetime.now().isoformat()
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8031)


@app.get("/health")
async def health_check():
    return {"status": "ok"}
