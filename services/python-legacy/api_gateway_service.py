#!/usr/bin/env python3
"""
Healthcare Claims Platform - API Gateway Service
Centralized routing, authentication, rate limiting, and request/response management.

Author: Manus AI
Date: October 7, 2025
"""

from fastapi import FastAPI, HTTPException, Depends, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import JSONResponse, StreamingResponse
import httpx
import asyncio
import aiohttp
from pydantic import BaseModel, Field, validator
from typing import List, Optional, Dict, Any, Union, Callable
from datetime import datetime, timedelta
from enum import Enum
import uuid
import logging
import json
import time
import os
import hashlib
import hmac
import redis.asyncio as aioredis
import asyncpg
from contextlib import asynccontextmanager
import jwt
from passlib.context import CryptContext
import uvicorn
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import prometheus_client
from prometheus_client import Counter, Histogram, Gauge, generate_latest
import structlog
from circuitbreaker import circuit
import backoff

# Configure structured logging
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.processors.JSONRenderer()
    ],
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    wrapper_class=structlog.stdlib.BoundLogger,
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger(__name__)

# Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://claimuser:password@localhost/healthcare_platform")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "your-secret-key")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
JWT_EXPIRATION_HOURS = int(os.getenv("JWT_EXPIRATION_HOURS", "24"))

# Service URLs
FRAUD_SERVICE_URL = os.getenv("FRAUD_SERVICE_URL", "http://localhost:8005")
PRICING_SERVICE_URL = os.getenv("PRICING_SERVICE_URL", "http://localhost:8006")
COMPLIANCE_SERVICE_URL = os.getenv("COMPLIANCE_SERVICE_URL", "http://localhost:8007")
ANALYTICS_SERVICE_URL = os.getenv("ANALYTICS_SERVICE_URL", "http://localhost:8008")
NOTIFICATION_SERVICE_URL = os.getenv("NOTIFICATION_SERVICE_URL", "http://localhost:8009")
PROVIDER_SERVICE_URL = os.getenv("PROVIDER_SERVICE_URL", "http://localhost:8010")

# Prometheus metrics
REQUEST_COUNT = Counter('gateway_requests_total', 'Total requests', ['method', 'endpoint', 'status'])
REQUEST_DURATION = Histogram('gateway_request_duration_seconds', 'Request duration', ['method', 'endpoint'])
ACTIVE_CONNECTIONS = Gauge('gateway_active_connections', 'Active connections')
SERVICE_HEALTH = Gauge('gateway_service_health', 'Service health status', ['service'])

# Rate limiter
limiter = Limiter(key_func=get_remote_address)

class ServiceStatus(str, Enum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"
    UNKNOWN = "unknown"

class RouteMethod(str, Enum):
    GET = "GET"
    POST = "POST"
    PUT = "PUT"
    DELETE = "DELETE"
    PATCH = "PATCH"

class AuthenticationType(str, Enum):
    JWT = "jwt"
    API_KEY = "api_key"
    OAUTH = "oauth"
    NONE = "none"

# Pydantic Models
class ServiceRoute(BaseModel):
    id: str
    path: str
    methods: List[RouteMethod]
    service_url: str
    service_name: str
    authentication: AuthenticationType = AuthenticationType.JWT
    rate_limit: Optional[str] = None  # e.g., "100/minute"
    timeout_seconds: int = 30
    retry_attempts: int = 3
    circuit_breaker_enabled: bool = True
    active: bool = True
    tenant_specific: bool = False
    metadata: Dict[str, Any] = {}

class ServiceHealthCheck(BaseModel):
    service_name: str
    url: str
    status: ServiceStatus
    response_time_ms: float
    last_check: datetime
    error_message: Optional[str] = None
    metadata: Dict[str, Any] = {}

class RequestLog(BaseModel):
    request_id: str
    method: str
    path: str
    service_name: Optional[str] = None
    status_code: int
    response_time_ms: float
    client_ip: str
    user_agent: Optional[str] = None
    user_id: Optional[str] = None
    tenant_id: Optional[str] = None
    timestamp: datetime
    error_message: Optional[str] = None

class CircuitBreakerState(BaseModel):
    service_name: str
    state: str  # "closed", "open", "half-open"
    failure_count: int
    last_failure: Optional[datetime] = None
    next_attempt: Optional[datetime] = None

# Database Manager
class DatabaseManager:
    def __init__(self):
        self.pool = None
        self.redis = None
    
    async def connect(self):
        try:
            self.pool = await asyncpg.create_pool(DATABASE_URL)
            self.redis = await aioredis.from_url(REDIS_URL)
            logger.info("API Gateway database connections established")
        except Exception as e:
            logger.error("Failed to connect to database", error=str(e))
            raise
    
    async def disconnect(self):
        if self.pool:
            await self.pool.close()
        if self.redis:
            await self.redis.close()
        logger.info("API Gateway database connections closed")

db_manager = DatabaseManager()

# Authentication Manager
class AuthenticationManager:
    def __init__(self):
        self.pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
    
    async def verify_jwt_token(self, token: str) -> Dict[str, Any]:
        """Verify JWT token and return payload"""
        try:
            payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
            
            # Check if token is blacklisted
            if await self._is_token_blacklisted(token):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Token has been revoked"
                )
            
            return payload
            
        except jwt.ExpiredSignatureError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token has expired"
            )
        except jwt.JWTError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token"
            )
    
    async def verify_api_key(self, api_key: str) -> Dict[str, Any]:
        """Verify API key and return associated info"""
        try:
            # Hash the API key for lookup
            key_hash = hashlib.sha256(api_key.encode()).hexdigest()
            
            async with db_manager.pool.acquire() as conn:
                key_info = await conn.fetchrow("""
                    SELECT user_id, tenant_id, permissions, rate_limit, active
                    FROM api_keys 
                    WHERE key_hash = $1 AND active = true
                    AND (expires_at IS NULL OR expires_at > NOW())
                """, key_hash)
                
                if not key_info:
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="Invalid API key"
                    )
                
                return {
                    "user_id": key_info["user_id"],
                    "tenant_id": key_info["tenant_id"],
                    "permissions": json.loads(key_info["permissions"]) if key_info["permissions"] else [],
                    "rate_limit": key_info["rate_limit"],
                    "auth_type": "api_key"
                }
                
        except Exception as e:
            logger.error("API key verification failed", error=str(e))
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="API key verification failed"
            )
    
    async def _is_token_blacklisted(self, token: str) -> bool:
        """Check if JWT token is blacklisted"""
        try:
            token_hash = hashlib.sha256(token.encode()).hexdigest()
            result = await db_manager.redis.get(f"blacklist:{token_hash}")
            return result is not None
        except Exception:
            return False
    
    async def blacklist_token(self, token: str, expiration: datetime):
        """Add token to blacklist"""
        try:
            token_hash = hashlib.sha256(token.encode()).hexdigest()
            ttl = int((expiration - datetime.utcnow()).total_seconds())
            if ttl > 0:
                await db_manager.redis.setex(f"blacklist:{token_hash}", ttl, "1")
        except Exception as e:
            logger.error("Failed to blacklist token", error=str(e))

auth_manager = AuthenticationManager()

# Circuit Breaker Manager
class CircuitBreakerManager:
    def __init__(self):
        self.breakers: Dict[str, CircuitBreakerState] = {}
        self.failure_threshold = 5
        self.recovery_timeout = 60  # seconds
    
    async def can_execute(self, service_name: str) -> bool:
        """Check if service call can be executed"""
        breaker = await self._get_breaker_state(service_name)
        
        if breaker.state == "closed":
            return True
        elif breaker.state == "open":
            if breaker.next_attempt and datetime.utcnow() >= breaker.next_attempt:
                await self._set_breaker_state(service_name, "half-open")
                return True
            return False
        elif breaker.state == "half-open":
            return True
        
        return False
    
    async def record_success(self, service_name: str):
        """Record successful service call"""
        await self._set_breaker_state(service_name, "closed", failure_count=0)
    
    async def record_failure(self, service_name: str):
        """Record failed service call"""
        breaker = await self._get_breaker_state(service_name)
        failure_count = breaker.failure_count + 1
        
        if failure_count >= self.failure_threshold:
            next_attempt = datetime.utcnow() + timedelta(seconds=self.recovery_timeout)
            await self._set_breaker_state(
                service_name, 
                "open", 
                failure_count=failure_count,
                last_failure=datetime.utcnow(),
                next_attempt=next_attempt
            )
        else:
            await self._set_breaker_state(
                service_name,
                "closed",
                failure_count=failure_count,
                last_failure=datetime.utcnow()
            )
    
    async def _get_breaker_state(self, service_name: str) -> CircuitBreakerState:
        """Get circuit breaker state from Redis"""
        try:
            state_data = await db_manager.redis.hgetall(f"circuit_breaker:{service_name}")
            
            if not state_data:
                return CircuitBreakerState(
                    service_name=service_name,
                    state="closed",
                    failure_count=0
                )
            
            return CircuitBreakerState(
                service_name=service_name,
                state=state_data.get(b"state", b"closed").decode(),
                failure_count=int(state_data.get(b"failure_count", b"0")),
                last_failure=datetime.fromisoformat(state_data[b"last_failure"].decode()) if b"last_failure" in state_data else None,
                next_attempt=datetime.fromisoformat(state_data[b"next_attempt"].decode()) if b"next_attempt" in state_data else None
            )
            
        except Exception as e:
            logger.error("Failed to get circuit breaker state", service=service_name, error=str(e))
            return CircuitBreakerState(
                service_name=service_name,
                state="closed",
                failure_count=0
            )
    
    async def _set_breaker_state(
        self, 
        service_name: str, 
        state: str, 
        failure_count: int = None,
        last_failure: datetime = None,
        next_attempt: datetime = None
    ):
        """Set circuit breaker state in Redis"""
        try:
            state_data = {"state": state}
            
            if failure_count is not None:
                state_data["failure_count"] = str(failure_count)
            if last_failure:
                state_data["last_failure"] = last_failure.isoformat()
            if next_attempt:
                state_data["next_attempt"] = next_attempt.isoformat()
            
            await db_manager.redis.hset(f"circuit_breaker:{service_name}", mapping=state_data)
            
        except Exception as e:
            logger.error("Failed to set circuit breaker state", service=service_name, error=str(e))

circuit_manager = CircuitBreakerManager()

# Service Router
class ServiceRouter:
    def __init__(self):
        self.routes: Dict[str, ServiceRoute] = {}
        self.http_client = None
    
    async def initialize(self):
        """Initialize HTTP client and load routes"""
        self.http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0),
            limits=httpx.Limits(max_keepalive_connections=100, max_connections=200)
        )
        await self._load_routes()
    
    async def _load_routes(self):
        """Load service routes from database"""
        try:
            async with db_manager.pool.acquire() as conn:
                routes_data = await conn.fetch("""
                    SELECT id, path, methods, service_url, service_name, 
                           authentication, rate_limit, timeout_seconds, 
                           retry_attempts, circuit_breaker_enabled, active,
                           tenant_specific, metadata
                    FROM api_routes 
                    WHERE active = true
                """)
                
                for route_data in routes_data:
                    route = ServiceRoute(
                        id=route_data["id"],
                        path=route_data["path"],
                        methods=[RouteMethod(m) for m in route_data["methods"]],
                        service_url=route_data["service_url"],
                        service_name=route_data["service_name"],
                        authentication=AuthenticationType(route_data["authentication"]),
                        rate_limit=route_data["rate_limit"],
                        timeout_seconds=route_data["timeout_seconds"],
                        retry_attempts=route_data["retry_attempts"],
                        circuit_breaker_enabled=route_data["circuit_breaker_enabled"],
                        active=route_data["active"],
                        tenant_specific=route_data["tenant_specific"],
                        metadata=json.loads(route_data["metadata"]) if route_data["metadata"] else {}
                    )
                    
                    self.routes[route.path] = route
                
                logger.info("Loaded service routes", count=len(self.routes))
                
        except Exception as e:
            logger.error("Failed to load routes", error=str(e))
            # Load default routes as fallback
            await self._load_default_routes()
    
    async def _load_default_routes(self):
        """Load default routes as fallback"""
        default_routes = [
            ServiceRoute(
                id="fraud-detection",
                path="/api/v1/fraud/*",
                methods=[RouteMethod.GET, RouteMethod.POST],
                service_url=FRAUD_SERVICE_URL,
                service_name="fraud-detection"
            ),
            ServiceRoute(
                id="pricing",
                path="/api/v1/pricing/*",
                methods=[RouteMethod.GET, RouteMethod.POST],
                service_url=PRICING_SERVICE_URL,
                service_name="pricing"
            ),
            ServiceRoute(
                id="compliance",
                path="/api/v1/compliance/*",
                methods=[RouteMethod.GET, RouteMethod.POST],
                service_url=COMPLIANCE_SERVICE_URL,
                service_name="compliance"
            ),
            ServiceRoute(
                id="analytics",
                path="/api/v1/analytics/*",
                methods=[RouteMethod.GET, RouteMethod.POST],
                service_url=ANALYTICS_SERVICE_URL,
                service_name="analytics"
            ),
            ServiceRoute(
                id="notifications",
                path="/api/v1/notifications/*",
                methods=[RouteMethod.GET, RouteMethod.POST],
                service_url=NOTIFICATION_SERVICE_URL,
                service_name="notifications"
            ),
            ServiceRoute(
                id="providers",
                path="/api/v1/providers/*",
                methods=[RouteMethod.GET, RouteMethod.POST],
                service_url=PROVIDER_SERVICE_URL,
                service_name="providers"
            )
        ]
        
        for route in default_routes:
            self.routes[route.path] = route
        
        logger.info("Loaded default routes", count=len(default_routes))
    
    def find_route(self, path: str, method: str) -> Optional[ServiceRoute]:
        """Find matching route for path and method"""
        # Exact match first
        if path in self.routes:
            route = self.routes[path]
            if method in [m.value for m in route.methods]:
                return route
        
        # Pattern matching for wildcard routes
        for route_path, route in self.routes.items():
            if route_path.endswith("*"):
                prefix = route_path[:-1]
                if path.startswith(prefix) and method in [m.value for m in route.methods]:
                    return route
        
        return None
    
    @backoff.on_exception(
        backoff.expo,
        (httpx.RequestError, httpx.TimeoutException),
        max_tries=3,
        max_time=30
    )
    async def forward_request(
        self, 
        route: ServiceRoute, 
        request: Request,
        path: str,
        user_context: Dict[str, Any] = None
    ) -> Response:
        """Forward request to appropriate service"""
        
        # Check circuit breaker
        if route.circuit_breaker_enabled:
            if not await circuit_manager.can_execute(route.service_name):
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=f"Service {route.service_name} is currently unavailable"
                )
        
        # Prepare request
        url = f"{route.service_url}{path}"
        headers = dict(request.headers)
        
        # Remove hop-by-hop headers
        headers_to_remove = [
            "host", "connection", "keep-alive", "proxy-authenticate",
            "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade"
        ]
        for header in headers_to_remove:
            headers.pop(header, None)
        
        # Add user context headers
        if user_context:
            headers["X-User-ID"] = str(user_context.get("user_id", ""))
            headers["X-Tenant-ID"] = str(user_context.get("tenant_id", ""))
            headers["X-Auth-Type"] = user_context.get("auth_type", "")
        
        # Add request ID for tracing
        request_id = str(uuid.uuid4())
        headers["X-Request-ID"] = request_id
        
        try:
            # Get request body
            body = await request.body()
            
            # Make request to service
            start_time = time.time()
            
            response = await self.http_client.request(
                method=request.method,
                url=url,
                headers=headers,
                content=body,
                params=dict(request.query_params),
                timeout=route.timeout_seconds
            )
            
            response_time = time.time() - start_time
            
            # Record success in circuit breaker
            if route.circuit_breaker_enabled:
                await circuit_manager.record_success(route.service_name)
            
            # Log request
            await self._log_request(
                request_id=request_id,
                method=request.method,
                path=path,
                service_name=route.service_name,
                status_code=response.status_code,
                response_time_ms=response_time * 1000,
                client_ip=request.client.host,
                user_agent=request.headers.get("user-agent"),
                user_id=user_context.get("user_id") if user_context else None,
                tenant_id=user_context.get("tenant_id") if user_context else None
            )
            
            # Return response
            return Response(
                content=response.content,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.headers.get("content-type")
            )
            
        except (httpx.RequestError, httpx.TimeoutException) as e:
            # Record failure in circuit breaker
            if route.circuit_breaker_enabled:
                await circuit_manager.record_failure(route.service_name)
            
            # Log error
            await self._log_request(
                request_id=request_id,
                method=request.method,
                path=path,
                service_name=route.service_name,
                status_code=503,
                response_time_ms=0,
                client_ip=request.client.host,
                user_agent=request.headers.get("user-agent"),
                user_id=user_context.get("user_id") if user_context else None,
                tenant_id=user_context.get("tenant_id") if user_context else None,
                error_message=str(e)
            )
            
            logger.error(
                "Service request failed",
                service=route.service_name,
                url=url,
                error=str(e)
            )
            
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Service temporarily unavailable: {route.service_name}"
            )
    
    async def _log_request(self, **kwargs):
        """Log request to database"""
        try:
            async with db_manager.pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO request_logs 
                    (request_id, method, path, service_name, status_code, 
                     response_time_ms, client_ip, user_agent, user_id, 
                     tenant_id, timestamp, error_message)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                """, 
                    kwargs["request_id"],
                    kwargs["method"],
                    kwargs["path"],
                    kwargs.get("service_name"),
                    kwargs["status_code"],
                    kwargs["response_time_ms"],
                    kwargs["client_ip"],
                    kwargs.get("user_agent"),
                    kwargs.get("user_id"),
                    kwargs.get("tenant_id"),
                    datetime.utcnow(),
                    kwargs.get("error_message")
                )
        except Exception as e:
            logger.error("Failed to log request", error=str(e))

service_router = ServiceRouter()

# Health Check Manager
class HealthCheckManager:
    def __init__(self):
        self.services = {
            "fraud-detection": FRAUD_SERVICE_URL,
            "pricing": PRICING_SERVICE_URL,
            "compliance": COMPLIANCE_SERVICE_URL,
            "analytics": ANALYTICS_SERVICE_URL,
            "notifications": NOTIFICATION_SERVICE_URL,
            "providers": PROVIDER_SERVICE_URL
        }
        self.health_status: Dict[str, ServiceHealthCheck] = {}
    
    async def check_all_services(self):
        """Check health of all services"""
        tasks = []
        for service_name, url in self.services.items():
            tasks.append(self._check_service_health(service_name, url))
        
        await asyncio.gather(*tasks, return_exceptions=True)
    
    async def _check_service_health(self, service_name: str, base_url: str):
        """Check health of individual service"""
        start_time = time.time()
        
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{base_url}/health")
                response_time = (time.time() - start_time) * 1000
                
                if response.status_code == 200:
                    status = ServiceStatus.HEALTHY
                    error_message = None
                else:
                    status = ServiceStatus.DEGRADED
                    error_message = f"HTTP {response.status_code}"
                
                health_check = ServiceHealthCheck(
                    service_name=service_name,
                    url=base_url,
                    status=status,
                    response_time_ms=response_time,
                    last_check=datetime.utcnow(),
                    error_message=error_message
                )
                
                self.health_status[service_name] = health_check
                SERVICE_HEALTH.labels(service=service_name).set(1 if status == ServiceStatus.HEALTHY else 0)
                
        except Exception as e:
            response_time = (time.time() - start_time) * 1000
            
            health_check = ServiceHealthCheck(
                service_name=service_name,
                url=base_url,
                status=ServiceStatus.UNHEALTHY,
                response_time_ms=response_time,
                last_check=datetime.utcnow(),
                error_message=str(e)
            )
            
            self.health_status[service_name] = health_check
            SERVICE_HEALTH.labels(service=service_name).set(0)

health_manager = HealthCheckManager()

# Application lifespan
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await db_manager.connect()
    await service_router.initialize()
    
    # Start background health checking
    health_task = asyncio.create_task(periodic_health_check())
    
    yield
    
    # Shutdown
    health_task.cancel()
    await db_manager.disconnect()
    if service_router.http_client:
        await service_router.http_client.aclose()

async def periodic_health_check():
    """Periodic health check of all services"""
    while True:
        try:
            await health_manager.check_all_services()
            await asyncio.sleep(30)  # Check every 30 seconds
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error("Health check failed", error=str(e))
            await asyncio.sleep(30)

# FastAPI application
app = FastAPI(
    title="Healthcare Claims Platform - API Gateway",
    description="Centralized routing, authentication, rate limiting, and request management.",
    version="1.0.0",
    lifespan=lifespan
)

# Add middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(GZipMiddleware, minimum_size=1000)

# Add rate limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Security
security = HTTPBearer(auto_error=False)

# Middleware for metrics and logging
@app.middleware("http")
async def metrics_middleware(request: Request, call_next):
    start_time = time.time()
    
    # Increment active connections
    ACTIVE_CONNECTIONS.inc()
    
    try:
        response = await call_next(request)
        
        # Record metrics
        duration = time.time() - start_time
        REQUEST_DURATION.labels(
            method=request.method,
            endpoint=request.url.path
        ).observe(duration)
        
        REQUEST_COUNT.labels(
            method=request.method,
            endpoint=request.url.path,
            status=response.status_code
        ).inc()
        
        return response
        
    finally:
        ACTIVE_CONNECTIONS.dec()

# Authentication dependency
async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not credentials:
        return None
    
    if credentials.scheme.lower() == "bearer":
        return await auth_manager.verify_jwt_token(credentials.credentials)
    elif credentials.scheme.lower() == "apikey":
        return await auth_manager.verify_api_key(credentials.credentials)
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unsupported authentication scheme"
        )

# Routes
@app.get("/health")
async def health_check():
    """Gateway health check"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow(),
        "services": health_manager.health_status
    }

@app.get("/metrics")
async def metrics():
    """Prometheus metrics endpoint"""
    return Response(generate_latest(), media_type="text/plain")

@app.get("/admin/routes", response_model=List[ServiceRoute])
async def get_routes(user: Dict = Depends(get_current_user)):
    """Get all configured routes"""
    if not user or "admin" not in user.get("permissions", []):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    return list(service_router.routes.values())

@app.post("/admin/routes", response_model=ServiceRoute)
async def create_route(route: ServiceRoute, user: Dict = Depends(get_current_user)):
    """Create new route"""
    if not user or "admin" not in user.get("permissions", []):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Store in database
    async with db_manager.pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO api_routes 
            (id, path, methods, service_url, service_name, authentication,
             rate_limit, timeout_seconds, retry_attempts, circuit_breaker_enabled,
             active, tenant_specific, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        """,
            route.id, route.path, [m.value for m in route.methods],
            route.service_url, route.service_name, route.authentication.value,
            route.rate_limit, route.timeout_seconds, route.retry_attempts,
            route.circuit_breaker_enabled, route.active, route.tenant_specific,
            json.dumps(route.metadata)
        )
    
    # Update in-memory routes
    service_router.routes[route.path] = route
    
    return route

@app.get("/admin/health", response_model=Dict[str, ServiceHealthCheck])
async def get_service_health(user: Dict = Depends(get_current_user)):
    """Get health status of all services"""
    if not user or "admin" not in user.get("permissions", []):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    return health_manager.health_status

@app.post("/admin/health/check")
async def trigger_health_check(user: Dict = Depends(get_current_user)):
    """Trigger immediate health check of all services"""
    if not user or "admin" not in user.get("permissions", []):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    await health_manager.check_all_services()
    return {"message": "Health check completed"}

# Main proxy route - catch all
@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
@limiter.limit("1000/minute")
async def proxy_request(
    request: Request,
    path: str,
    user: Dict = Depends(get_current_user)
):
    """Proxy requests to appropriate services"""
    full_path = f"/{path}"
    
    # Find matching route
    route = service_router.find_route(full_path, request.method)
    
    if not route:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Route not found"
        )
    
    # Check authentication requirements
    if route.authentication != AuthenticationType.NONE and not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required"
        )
    
    # Forward request to service
    return await service_router.forward_request(route, request, full_path, user)

# Request logging endpoint
@app.get("/admin/logs", response_model=List[RequestLog])
async def get_request_logs(
    limit: int = 100,
    offset: int = 0,
    service_name: Optional[str] = None,
    user: Dict = Depends(get_current_user)
):
    """Get request logs"""
    if not user or "admin" not in user.get("permissions", []):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    query = """
        SELECT request_id, method, path, service_name, status_code,
               response_time_ms, client_ip, user_agent, user_id,
               tenant_id, timestamp, error_message
        FROM request_logs
    """
    params = []
    
    if service_name:
        query += " WHERE service_name = $1"
        params.append(service_name)
    
    query += " ORDER BY timestamp DESC LIMIT $" + str(len(params) + 1) + " OFFSET $" + str(len(params) + 2)
    params.extend([limit, offset])
    
    async with db_manager.pool.acquire() as conn:
        logs = await conn.fetch(query, *params)
        
        return [
            RequestLog(
                request_id=log["request_id"],
                method=log["method"],
                path=log["path"],
                service_name=log["service_name"],
                status_code=log["status_code"],
                response_time_ms=log["response_time_ms"],
                client_ip=log["client_ip"],
                user_agent=log["user_agent"],
                user_id=log["user_id"],
                tenant_id=log["tenant_id"],
                timestamp=log["timestamp"],
                error_message=log["error_message"]
            )
            for log in logs
        ]

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
