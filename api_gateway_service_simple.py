#!/usr/bin/env python3
"""
Healthcare Claims Platform - Simplified API Gateway Service
Basic API gateway service without Redis dependency for testing.
"""

from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Any, Optional
from datetime import datetime
import httpx
import logging
import time

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Service registry
SERVICES = {
    "user-management": "http://localhost:8001",
    "provider-management": "http://localhost:8002", 
    "authentication": "http://localhost:8003",
    "claims-processing": "http://localhost:8005",
    "notification": "http://localhost:8006",
    "search-analytics": "http://localhost:8007",
    "enhanced-user-management": "http://localhost:8008",
    "ai-fraud-detection": "http://localhost:8009",
    "document-verification": "http://localhost:8010",
    "kyb-verification": "http://localhost:8011"
}

# Rate limiting storage (in-memory for testing)
rate_limit_storage = {}

# Pydantic Models
class GatewayResponse(BaseModel):
    service: str
    status: str
    data: Any
    timestamp: str

class ServiceStatus(BaseModel):
    service: str
    url: str
    status: str
    response_time: Optional[float] = None

# FastAPI app
app = FastAPI(
    title="Healthcare Claims Platform - API Gateway Service",
    description="Simplified API gateway service for testing",
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

def check_rate_limit(client_ip: str, limit: int = 100, window: int = 60) -> bool:
    """Simple rate limiting check"""
    current_time = time.time()
    
    if client_ip not in rate_limit_storage:
        rate_limit_storage[client_ip] = []
    
    # Clean old requests outside the window
    rate_limit_storage[client_ip] = [
        req_time for req_time in rate_limit_storage[client_ip]
        if current_time - req_time < window
    ]
    
    # Check if limit exceeded
    if len(rate_limit_storage[client_ip]) >= limit:
        return False
    
    # Add current request
    rate_limit_storage[client_ip].append(current_time)
    return True

async def proxy_request(service_name: str, path: str, method: str, **kwargs):
    """Proxy request to backend service"""
    if service_name not in SERVICES:
        raise HTTPException(status_code=404, detail=f"Service {service_name} not found")
    
    service_url = SERVICES[service_name]
    full_url = f"{service_url}{path}"
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.request(method, full_url, **kwargs)
            return response
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail=f"Service {service_name} unavailable")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail=f"Service {service_name} timeout")
    except Exception as e:
        logger.error(f"Proxy error for {service_name}: {e}")
        raise HTTPException(status_code=500, detail="Gateway error")

@app.api_route("/api/{service_name:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def gateway_proxy(service_name: str, request: Request):
    """Main gateway proxy endpoint"""
    try:
        # Extract service name and path
        path_parts = service_name.split("/", 1)
        service = path_parts[0]
        path = "/" + (path_parts[1] if len(path_parts) > 1 else "")
        
        # Rate limiting
        client_ip = request.client.host
        if not check_rate_limit(client_ip):
            raise HTTPException(status_code=429, detail="Rate limit exceeded")
        
        # Get request data
        body = await request.body()
        headers = dict(request.headers)
        
        # Remove hop-by-hop headers
        headers.pop("host", None)
        headers.pop("content-length", None)
        
        # Proxy the request
        response = await proxy_request(
            service,
            path,
            request.method,
            content=body,
            headers=headers,
            params=dict(request.query_params)
        )
        
        logger.info(f"Proxied {request.method} {service}{path} -> {response.status_code}")
        
        return response.json() if response.headers.get("content-type", "").startswith("application/json") else response.text
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Gateway error: {e}")
        raise HTTPException(status_code=500, detail="Internal gateway error")

@app.get("/services/status")
async def get_services_status():
    """Get status of all registered services"""
    try:
        service_statuses = []
        
        async with httpx.AsyncClient(timeout=5.0) as client:
            for service_name, service_url in SERVICES.items():
                try:
                    start_time = time.time()
                    response = await client.get(f"{service_url}/health")
                    response_time = time.time() - start_time
                    
                    status = "healthy" if response.status_code == 200 else "unhealthy"
                    service_statuses.append(ServiceStatus(
                        service=service_name,
                        url=service_url,
                        status=status,
                        response_time=round(response_time * 1000, 2)  # ms
                    ))
                except Exception:
                    service_statuses.append(ServiceStatus(
                        service=service_name,
                        url=service_url,
                        status="unavailable"
                    ))
        
        healthy_count = sum(1 for s in service_statuses if s.status == "healthy")
        
        return {
            "services": service_statuses,
            "total_services": len(SERVICES),
            "healthy_services": healthy_count,
            "overall_health": "healthy" if healthy_count == len(SERVICES) else "degraded",
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Failed to get services status: {e}")
        raise HTTPException(status_code=500, detail="Failed to get services status")

@app.get("/services")
async def list_services():
    """List all registered services"""
    return {
        "services": [
            {"name": name, "url": url}
            for name, url in SERVICES.items()
        ],
        "total": len(SERVICES)
    }

@app.get("/gateway/stats")
async def get_gateway_stats():
    """Get gateway statistics"""
    try:
        current_time = time.time()
        active_clients = 0
        total_requests = 0
        
        for client_ip, requests in rate_limit_storage.items():
            # Count requests in last minute
            recent_requests = [
                req_time for req_time in requests
                if current_time - req_time < 60
            ]
            if recent_requests:
                active_clients += 1
                total_requests += len(recent_requests)
        
        return {
            "active_clients": active_clients,
            "requests_last_minute": total_requests,
            "registered_services": len(SERVICES),
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Failed to get gateway stats: {e}")
        raise HTTPException(status_code=500, detail="Failed to get gateway stats")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "service": "api-gateway-service",
        "version": "1.0.0",
        "registered_services": len(SERVICES)
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8004)
