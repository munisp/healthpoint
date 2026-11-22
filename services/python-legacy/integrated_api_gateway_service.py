"""
Integrated API Gateway Service for Healthcare Claims Platform with NSA/IDR Support
Combines main platform routing with NSA/IDR specific endpoints
"""

from fastapi import FastAPI, HTTPException, Depends, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import httpx
import asyncio
import time
import redis
from typing import Dict, List, Optional
import logging
from datetime import datetime, timedelta
import json
import os
from pydantic import BaseModel

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Healthcare Claims Platform - Integrated API Gateway",
    description="Unified API Gateway with NSA/IDR Support",
    version="2.0.0"
)

# Security
security = HTTPBearer()

# Redis for rate limiting and caching
redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)

# Service endpoints mapping
SERVICE_ENDPOINTS = {
    # Main Platform Services
    "user_management": "http://localhost:8001",
    "provider_management": "http://localhost:8002", 
    "authentication": "http://localhost:8003",
    "claims_processing": "http://localhost:8005",
    "notification": "http://localhost:8006",
    "search_analytics": "http://localhost:8007",
    "enhanced_user_management": "http://localhost:8008",
    "ai_fraud_detection": "http://localhost:8009",
    "document_verification": "http://localhost:8010",
    "kyb_verification": "http://localhost:8011",
    
    # NSA/IDR Services
    "cms_api_integration": "http://localhost:8012",
    "qpa_calculation": "http://localhost:8013",
    "good_faith_estimates": "http://localhost:8014",
    "federal_reporting": "http://localhost:8015",
    "administrative_fee_payment": "http://localhost:8016",
    "nsa_compliance": "http://localhost:8017"
}

# Route mappings
ROUTE_MAPPINGS = {
    # Main Platform Routes
    "/api/v1/users": "user_management",
    "/api/v1/providers": "provider_management",
    "/api/v1/auth": "authentication",
    "/api/v1/claims": "claims_processing",
    "/api/v1/notifications": "notification",
    "/api/v1/search": "search_analytics",
    "/api/v1/admin/users": "enhanced_user_management",
    "/api/v1/fraud": "ai_fraud_detection",
    "/api/v1/documents": "document_verification",
    "/api/v1/kyb": "kyb_verification",
    
    # NSA/IDR Routes
    "/api/v1/idr": "cms_api_integration",
    "/api/v1/qpa": "qpa_calculation",
    "/api/v1/gfe": "good_faith_estimates",
    "/api/v1/federal-reports": "federal_reporting",
    "/api/v1/admin-fees": "administrative_fee_payment",
    "/api/v1/nsa-compliance": "nsa_compliance"
}

# Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["*"]
)

class RateLimitConfig(BaseModel):
    requests_per_minute: int = 100
    burst_limit: int = 200

class HealthCheck(BaseModel):
    status: str
    timestamp: str
    services: Dict[str, str]

# Rate limiting
async def rate_limit_check(request: Request):
    client_ip = request.client.host
    current_time = int(time.time())
    minute_key = f"rate_limit:{client_ip}:{current_time // 60}"
    
    try:
        current_requests = redis_client.get(minute_key)
        if current_requests is None:
            redis_client.setex(minute_key, 60, 1)
            return True
        elif int(current_requests) < 100:  # 100 requests per minute
            redis_client.incr(minute_key)
            return True
        else:
            raise HTTPException(status_code=429, detail="Rate limit exceeded")
    except Exception as e:
        logger.warning(f"Rate limiting error: {e}")
        return True  # Allow request if Redis is down

# Authentication middleware
async def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        # Forward to authentication service for verification
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{SERVICE_ENDPOINTS['authentication']}/api/v1/auth/verify",
                headers={"Authorization": f"Bearer {credentials.credentials}"}
            )
            if response.status_code != 200:
                raise HTTPException(status_code=401, detail="Invalid token")
            return response.json()
    except Exception as e:
        logger.error(f"Token verification error: {e}")
        raise HTTPException(status_code=401, detail="Authentication failed")

# Service health check
async def check_service_health(service_name: str, endpoint: str) -> str:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{endpoint}/health")
            return "healthy" if response.status_code == 200 else "unhealthy"
    except Exception:
        return "unreachable"

# Route handler
async def route_request(request: Request, target_service: str):
    if target_service not in SERVICE_ENDPOINTS:
        raise HTTPException(status_code=404, detail="Service not found")
    
    target_url = SERVICE_ENDPOINTS[target_service]
    path = request.url.path
    query_params = str(request.url.query)
    
    # Build target URL
    full_url = f"{target_url}{path}"
    if query_params:
        full_url += f"?{query_params}"
    
    # Get request body
    body = await request.body()
    
    # Forward request
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.request(
                method=request.method,
                url=full_url,
                headers=dict(request.headers),
                content=body
            )
            
            return Response(
                content=response.content,
                status_code=response.status_code,
                headers=dict(response.headers)
            )
    except Exception as e:
        logger.error(f"Request forwarding error: {e}")
        raise HTTPException(status_code=503, detail="Service unavailable")

# Health check endpoint
@app.get("/health", response_model=HealthCheck)
async def health_check():
    services_health = {}
    
    # Check all services concurrently
    tasks = [
        check_service_health(name, endpoint) 
        for name, endpoint in SERVICE_ENDPOINTS.items()
    ]
    
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    for (name, _), result in zip(SERVICE_ENDPOINTS.items(), results):
        services_health[name] = result if isinstance(result, str) else "error"
    
    overall_status = "healthy" if all(
        status == "healthy" for status in services_health.values()
    ) else "degraded"
    
    return HealthCheck(
        status=overall_status,
        timestamp=datetime.utcnow().isoformat(),
        services=services_health
    )

# Metrics endpoint
@app.get("/metrics")
async def get_metrics():
    try:
        # Get basic metrics from Redis
        total_requests = redis_client.get("total_requests") or "0"
        error_count = redis_client.get("error_count") or "0"
        
        return {
            "total_requests": int(total_requests),
            "error_count": int(error_count),
            "uptime": time.time() - app.state.start_time if hasattr(app.state, 'start_time') else 0,
            "services_count": len(SERVICE_ENDPOINTS)
        }
    except Exception as e:
        logger.error(f"Metrics error: {e}")
        return {"error": "Metrics unavailable"}

# Dynamic routing for all API endpoints
@app.api_route("/api/v1/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def dynamic_route(request: Request, path: str):
    # Rate limiting
    await rate_limit_check(request)
    
    # Increment request counter
    try:
        redis_client.incr("total_requests")
    except Exception:
        pass
    
    # Find matching service
    request_path = f"/api/v1/{path}"
    target_service = None
    
    for route_prefix, service in ROUTE_MAPPINGS.items():
        if request_path.startswith(route_prefix):
            target_service = service
            break
    
    if not target_service:
        try:
            redis_client.incr("error_count")
        except Exception:
            pass
        raise HTTPException(status_code=404, detail="Route not found")
    
    # Route the request
    try:
        return await route_request(request, target_service)
    except HTTPException:
        try:
            redis_client.incr("error_count")
        except Exception:
            pass
        raise
    except Exception as e:
        try:
            redis_client.incr("error_count")
        except Exception:
            pass
        logger.error(f"Routing error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

# NSA/IDR specific endpoints with enhanced routing
@app.get("/api/v1/idr/disputes")
async def get_idr_disputes(request: Request):
    """Get all IDR disputes with enhanced filtering"""
    await rate_limit_check(request)
    return await route_request(request, "cms_api_integration")

@app.post("/api/v1/idr/disputes")
async def create_idr_dispute(request: Request):
    """Create new IDR dispute"""
    await rate_limit_check(request)
    return await route_request(request, "cms_api_integration")

@app.get("/api/v1/qpa/calculate")
async def calculate_qpa(request: Request):
    """Calculate Qualified Payment Amount"""
    await rate_limit_check(request)
    return await route_request(request, "qpa_calculation")

@app.post("/api/v1/gfe/generate")
async def generate_gfe(request: Request):
    """Generate Good Faith Estimate"""
    await rate_limit_check(request)
    return await route_request(request, "good_faith_estimates")

@app.get("/api/v1/federal-reports/generate")
async def generate_federal_report(request: Request):
    """Generate federal compliance reports"""
    await rate_limit_check(request)
    return await route_request(request, "federal_reporting")

@app.post("/api/v1/admin-fees/process")
async def process_admin_fee(request: Request):
    """Process administrative fee payment"""
    await rate_limit_check(request)
    return await route_request(request, "administrative_fee_payment")

@app.get("/api/v1/nsa-compliance/status")
async def get_compliance_status(request: Request):
    """Get NSA compliance status"""
    await rate_limit_check(request)
    return await route_request(request, "nsa_compliance")

# Startup event
@app.on_event("startup")
async def startup_event():
    app.state.start_time = time.time()
    logger.info("Integrated API Gateway started successfully")
    logger.info(f"Routing to {len(SERVICE_ENDPOINTS)} services")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8004)
