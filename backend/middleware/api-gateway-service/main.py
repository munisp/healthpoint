"""
Unified API Gateway and Service Orchestration
Central hub for all NSA/IDR Healthcare Platform services
"""

from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
import httpx
import asyncio
from datetime import datetime
import logging
import json
from backend.shared.auth import get_current_user, require_admin, require_role, TokenPayload
from shared.telemetry import setup_telemetry, instrument_fastapi, get_tracer

# ============================================================================
# CONFIGURATION
# ============================================================================

setup_telemetry(service_name="api-gateway-service", service_version="1.0.0")
app = FastAPI(
instrument_fastapi(app)
    title="NSA/IDR Healthcare Platform API Gateway",
    version="1.0.0",
    description="Unified API Gateway for all platform services"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","),  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Service endpoints configuration
SERVICE_ENDPOINTS = {
    "gfe_management": "http://localhost:8027",
    "x12_edi_processing": "http://localhost:8028",
    "cms_portal_automation": "http://localhost:8029",
    "idr_entity_integration": "http://localhost:8030",
    "data_transformation": "http://localhost:8031",
    "security_authentication": "http://localhost:8032",
    "admin_fee_management": "http://localhost:8026",
    "nsa_rate_calculation": "http://localhost:8033"
}

# ============================================================================
# MODELS
# ============================================================================

class ServiceHealth(BaseModel):
    service_name: str
    status: str
    response_time_ms: float
    last_check: datetime

class PlatformStatus(BaseModel):
    overall_status: str
    services: List[ServiceHealth]
    total_services: int
    healthy_services: int

class APIRequest(BaseModel):
    service: str
    endpoint: str
    method: str
    data: Optional[Dict[str, Any]] = None
    headers: Optional[Dict[str, str]] = None

# ============================================================================
# SERVICE ORCHESTRATION
# ============================================================================

async def call_service(service_name: str, endpoint: str, method: str = "GET", data: Dict[str, Any] = None, headers: Dict[str, str] = None):
    """Make HTTP call to a specific service"""
    if service_name not in SERVICE_ENDPOINTS:
        raise HTTPException(status_code=404, detail=f"Service {service_name} not found")
    
    base_url = SERVICE_ENDPOINTS[service_name]
    url = f"{base_url}{endpoint}"
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            if method.upper() == "GET":
                response = await client.get(url, headers=headers)
            elif method.upper() == "POST":
                response = await client.post(url, json=data, headers=headers)
            elif method.upper() == "PUT":
                response = await client.put(url, json=data, headers=headers)
            elif method.upper() == "DELETE":
                response = await client.delete(url, headers=headers)
            else:
                raise HTTPException(status_code=400, detail=f"Unsupported method: {method}")
            
            response.raise_for_status()
            return response.json()
    
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"Service {service_name} unavailable: {str(e)}")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=f"Service error: {e.response.text}")

# ============================================================================
# HEALTH CHECK ENDPOINTS
# ============================================================================

@app.get("/health")
async def gateway_health():
    """Gateway health check"""
    return {
        "status": "healthy",
        "service": "API Gateway",
        "version": "1.0.0",
        "timestamp": datetime.now().isoformat()
    }

@app.get("/health/platform", response_model=PlatformStatus)
async def platform_health():
    """Check health of all platform services"""
    service_health_checks = []
    
    for service_name, base_url in SERVICE_ENDPOINTS.items():
        start_time = datetime.now()
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{base_url}/health")
                response_time = (datetime.now() - start_time).total_seconds() * 1000
                
                service_health = ServiceHealth(
                    service_name=service_name,
                    status="healthy" if response.status_code == 200 else "unhealthy",
                    response_time_ms=response_time,
                    last_check=datetime.now()
                )
        except Exception as e:
            response_time = (datetime.now() - start_time).total_seconds() * 1000
            service_health = ServiceHealth(
                service_name=service_name,
                status="unhealthy",
                response_time_ms=response_time,
                last_check=datetime.now()
            )
        
        service_health_checks.append(service_health)
    
    healthy_count = sum(1 for s in service_health_checks if s.status == "healthy")
    overall_status = "healthy" if healthy_count == len(service_health_checks) else "degraded" if healthy_count > 0 else "unhealthy"
    
    return PlatformStatus(
        overall_status=overall_status,
        services=service_health_checks,
        total_services=len(service_health_checks),
        healthy_services=healthy_count
    )

# ============================================================================
# GFE MANAGEMENT ENDPOINTS
# ============================================================================

@app.post("/api/v1/gfe/generate")
async def generate_gfe(gfe_data: Dict[str, Any],
    current_user: TokenPayload = Depends(get_current_user),
):
    """Generate a new Good Faith Estimate"""
    return await call_service("gfe_management", "/api/v1/gfe/generate", "POST", gfe_data)

@app.get("/api/v1/gfe/{gfe_id}")
async def get_gfe(gfe_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Retrieve a specific GFE"""
    return await call_service("gfe_management", f"/api/v1/gfe/{gfe_id}", "GET")

@app.put("/api/v1/gfe/{gfe_id}")
async def update_gfe(gfe_id: str, gfe_data: Dict[str, Any],
    current_user: TokenPayload = Depends(get_current_user),
):
    """Update an existing GFE"""
    return await call_service("gfe_management", f"/api/v1/gfe/{gfe_id}", "PUT", gfe_data)

@app.post("/api/v1/gfe/{gfe_id}/submit")
async def submit_gfe(gfe_id: str, submission_data: Dict[str, Any],
    current_user: TokenPayload = Depends(get_current_user),
):
    """Submit GFE to CMS/IDR entities"""
    return await call_service("gfe_management", f"/api/v1/gfe/{gfe_id}/submit", "POST", submission_data)

# ============================================================================
# DATA TRANSFORMATION ENDPOINTS
# ============================================================================

@app.post("/api/v1/transform/gfe-to-json")
async def transform_gfe_to_json(gfe_data: Dict[str, Any],
    current_user: TokenPayload = Depends(get_current_user),
):
    """Transform GFE to JSON format"""
    return await call_service("data_transformation", "/api/v1/transform/gfe-to-json", "POST", gfe_data)

@app.post("/api/v1/transform/gfe-to-x12")
async def transform_gfe_to_x12(gfe_data: Dict[str, Any],
    current_user: TokenPayload = Depends(get_current_user),
):
    """Transform GFE to X12 EDI format"""
    return await call_service("data_transformation", "/api/v1/transform/gfe-to-x12", "POST", gfe_data)

@app.post("/api/v1/transform/gfe-to-cms")
async def transform_gfe_to_cms(gfe_data: Dict[str, Any], submission_type: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Transform GFE to CMS submission format"""
    data = {"gfe_data": gfe_data, "submission_type": submission_type}
    return await call_service("data_transformation", "/api/v1/transform/gfe-to-cms", "POST", data)

@app.post("/api/v1/validate/gfe")
async def validate_gfe(gfe_data: Dict[str, Any],
    current_user: TokenPayload = Depends(get_current_user),
):
    """Validate GFE data"""
    return await call_service("data_transformation", "/api/v1/validate/gfe", "POST", gfe_data)

# ============================================================================
# CMS INTEGRATION ENDPOINTS
# ============================================================================

@app.post("/api/v1/cms/ppdr/submit")
async def submit_ppdr(submission_data: Dict[str, Any],
    current_user: TokenPayload = Depends(get_current_user),
):
    """Submit Patient-Provider Dispute Resolution to CMS"""
    return await call_service("cms_portal_automation", "/api/v1/cms/ppdr/submit", "POST", submission_data)

@app.get("/api/v1/cms/submission-status/{submission_id}")
async def get_cms_submission_status(submission_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get CMS submission status"""
    return await call_service("cms_portal_automation", f"/api/v1/cms/submission-status/{submission_id}", "GET")

@app.post("/api/v1/cms/compliance/report")
async def submit_compliance_report(report_data: Dict[str, Any],
    current_user: TokenPayload = Depends(get_current_user),
):
    """Submit compliance report to CMS"""
    return await call_service("cms_portal_automation", "/api/v1/cms/compliance/report", "POST", report_data)

# ============================================================================
# IDR ENTITY INTEGRATION ENDPOINTS
# ============================================================================

@app.post("/api/v1/idr/dispute/initiate")
async def initiate_idr_dispute(dispute_data: Dict[str, Any],
    current_user: TokenPayload = Depends(get_current_user),
):
    """Initiate IDR dispute"""
    return await call_service("idr_entity_integration", "/api/v1/idr/dispute/initiate", "POST", dispute_data)

@app.put("/api/v1/idr/dispute/{dispute_id}/evidence")
async def submit_idr_evidence(dispute_id: str, evidence_data: Dict[str, Any],
    current_user: TokenPayload = Depends(get_current_user),
):
    """Submit evidence for IDR dispute"""
    return await call_service("idr_entity_integration", f"/api/v1/idr/dispute/{dispute_id}/evidence", "PUT", evidence_data)

@app.get("/api/v1/idr/dispute/{dispute_id}/status")
async def get_idr_dispute_status(dispute_id: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get IDR dispute status"""
    return await call_service("idr_entity_integration", f"/api/v1/idr/dispute/{dispute_id}/status", "GET")

# ============================================================================
# NSA RATE CALCULATION ENDPOINTS
# ============================================================================

@app.post("/api/v1/nsa/calculate-qpa")
async def calculate_qpa(calculation_data: Dict[str, Any],
    current_user: TokenPayload = Depends(get_current_user),
):
    """Calculate Qualifying Payment Amount (QPA)"""
    return await call_service("nsa_rate_calculation", "/api/v1/nsa/calculate-qpa", "POST", calculation_data)

@app.post("/api/v1/nsa/geographic-adjustment")
async def apply_geographic_adjustment(adjustment_data: Dict[str, Any],
    current_user: TokenPayload = Depends(get_current_user),
):
    """Apply geographic adjustment to rates"""
    return await call_service("nsa_rate_calculation", "/api/v1/nsa/geographic-adjustment", "POST", adjustment_data)

# ============================================================================
# ADMIN FEE MANAGEMENT ENDPOINTS
# ============================================================================

@app.get("/api/v1/admin/fees")
async def get_admin_fees(,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get admin fee configuration"""
    return await call_service("admin_fee_management", "/api/v1/admin/fees", "GET")

@app.put("/api/v1/admin/fees/{fee_id}")
async def update_admin_fee(fee_id: str, fee_data: Dict[str, Any],
    current_user: TokenPayload = Depends(get_current_user),
):
    """Update admin fee"""
    return await call_service("admin_fee_management", f"/api/v1/admin/fees/{fee_id}", "PUT", fee_data)

# ============================================================================
# WORKFLOW ORCHESTRATION
# ============================================================================

@app.post("/api/v1/workflows/complete-gfe-submission")
async def complete_gfe_submission_workflow(workflow_data: Dict[str, Any],
    current_user: TokenPayload = Depends(get_current_user),
):
    """Complete end-to-end GFE submission workflow"""
    try:
        # Step 1: Validate GFE
        validation_result = await call_service("data_transformation", "/api/v1/validate/gfe", "POST", workflow_data["gfe"])
        
        if not validation_result.get("is_valid", False):
            return {"status": "failed", "step": "validation", "errors": validation_result.get("errors", [])}
        
        # Step 2: Generate GFE
        gfe_result = await call_service("gfe_management", "/api/v1/gfe/generate", "POST", workflow_data["gfe"])
        gfe_id = gfe_result.get("gfeId")
        
        # Step 3: Transform to CMS format
        cms_transform_result = await call_service("data_transformation", "/api/v1/transform/gfe-to-cms", "POST", {
            "gfe_data": workflow_data["gfe"],
            "submission_type": workflow_data.get("submission_type", "PPDR")
        })
        
        # Step 4: Submit to CMS
        cms_submission_result = await call_service("cms_portal_automation", "/api/v1/cms/ppdr/submit", "POST", cms_transform_result["cms_submission"])
        
        return {
            "status": "success",
            "gfe_id": gfe_id,
            "cms_submission_id": cms_submission_result.get("submission_id"),
            "workflow_completed_at": datetime.now().isoformat()
        }
    
    except Exception as e:
        return {"status": "failed", "error": str(e)}

@app.post("/api/v1/workflows/idr-dispute-process")
async def idr_dispute_process_workflow(workflow_data: Dict[str, Any],
    current_user: TokenPayload = Depends(get_current_user),
):
    """Complete IDR dispute process workflow"""
    try:
        # Step 1: Initiate dispute
        dispute_result = await call_service("idr_entity_integration", "/api/v1/idr/dispute/initiate", "POST", workflow_data["dispute"])
        dispute_id = dispute_result.get("dispute_id")
        
        # Step 2: Submit evidence (including GFE if applicable)
        if "evidence" in workflow_data:
            evidence_result = await call_service("idr_entity_integration", f"/api/v1/idr/dispute/{dispute_id}/evidence", "PUT", workflow_data["evidence"])
        
        # Step 3: Calculate QPA if needed
        if "qpa_calculation" in workflow_data:
            qpa_result = await call_service("nsa_rate_calculation", "/api/v1/nsa/calculate-qpa", "POST", workflow_data["qpa_calculation"])
        
        return {
            "status": "success",
            "dispute_id": dispute_id,
            "workflow_completed_at": datetime.now().isoformat()
        }
    
    except Exception as e:
        return {"status": "failed", "error": str(e)}

# ============================================================================
# GENERIC SERVICE PROXY
# ============================================================================

@app.post("/api/v1/proxy")
async def service_proxy(request: APIRequest,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Generic proxy for any service call"""
    return await call_service(
        service_name=request.service,
        endpoint=request.endpoint,
        method=request.method,
        data=request.data,
        headers=request.headers
    )

# ============================================================================
# PLATFORM METRICS AND MONITORING
# ============================================================================

@app.get("/api/v1/metrics/platform")
async def get_platform_metrics(,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get comprehensive platform metrics"""
    try:
        # Collect metrics from various services
        metrics = {
            "timestamp": datetime.now().isoformat(),
            "gfe_metrics": await call_service("gfe_management", "/api/v1/metrics", "GET"),
            "transformation_metrics": await call_service("data_transformation", "/api/v1/metrics", "GET"),
            "cms_metrics": await call_service("cms_portal_automation", "/api/v1/metrics", "GET"),
            "idr_metrics": await call_service("idr_entity_integration", "/api/v1/metrics", "GET")
        }
        return metrics
    except Exception as e:
        return {"error": f"Failed to collect metrics: {str(e)}"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8025)

@app.get("/health")
async def health_check():
    return {"status": "ok"}