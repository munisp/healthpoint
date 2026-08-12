"""
NSA Rate Calculation Engine — Full Production Implementation
Calculates Qualifying Payment Amounts (QPA) and other NSA-related rates
using statistical methods, geographic adjustments, and CMS rate data.
"""
import asyncio, json, logging, os, statistics, uuid
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

import asyncpg
import numpy as np
import redis.asyncio as aioredis
from fastapi import FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://healthpoint:healthpoint@postgres:5432/healthpoint")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

app = FastAPI(title="HealthPoint NSA Rate Calculation Engine", version="2.0.0",
              description="Calculates QPA and NSA-related rates per No Surprises Act regulations.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

# Geographic cost-of-living adjustment factors by state
GEOGRAPHIC_ADJUSTMENTS = {
    "CA": 1.35, "NY": 1.40, "MA": 1.25, "WA": 1.20, "CT": 1.18,
    "NJ": 1.22, "MD": 1.15, "VA": 1.10, "CO": 1.12, "IL": 1.08,
    "TX": 0.95, "FL": 0.98, "GA": 0.92, "NC": 0.90, "OH": 0.88,
    "MI": 0.87, "PA": 0.93, "AZ": 0.96, "MN": 1.00, "WI": 0.89,
    "DEFAULT": 1.00,
}

# Specialty relative value adjustments
SPECIALTY_ADJUSTMENTS = {
    "emergency_medicine": 1.15, "anesthesiology": 1.25, "radiology": 1.10,
    "pathology": 1.05, "surgery": 1.20, "cardiology": 1.18,
    "orthopedics": 1.22, "neurology": 1.15, "oncology": 1.30,
    "primary_care": 0.90, "general_practice": 0.88, "DEFAULT": 1.00,
}

# Plan type adjustments
PLAN_TYPE_ADJUSTMENTS = {
    "group_health_plan": 1.00, "individual_market_plan": 0.95,
    "federal_employee_plan": 1.05, "grandfathered_plan": 0.92,
    "self_funded_plan": 1.02, "DEFAULT": 1.00,
}

class PlanType(str, Enum):
    GROUP_HEALTH = "group_health_plan"; INDIVIDUAL_MARKET = "individual_market_plan"
    FEDERAL_EMPLOYEE = "federal_employee_plan"; GRANDFATHERED = "grandfathered_plan"
    SELF_FUNDED = "self_funded_plan"

class RateCalculationRequest(BaseModel):
    service_code: str; geographic_area: str; historical_rates: List[float]
    plan_type: PlanType = PlanType.GROUP_HEALTH
    specialty_code: Optional[str] = None; date_of_service: Optional[str] = None
    include_percentiles: bool = True; tenant_id: Optional[str] = None

class RateCalculationResponse(BaseModel):
    service_code: str; geographic_area: str; qpa: float
    median_contracted_rate: float; mean_contracted_rate: float
    percentile_25: float; percentile_50: float; percentile_75: float
    percentile_90: float; std_deviation: float; sample_size: int
    geographic_adjustment_factor: float; specialty_adjustment_factor: float
    plan_type_adjustment_factor: float; calculation_method: str
    confidence_level: str; calculated_at: datetime

class BatchRateRequest(BaseModel):
    requests: List[RateCalculationRequest]

class QPAValidationRequest(BaseModel):
    service_code: str; geographic_area: str; claimed_qpa: float
    historical_rates: List[float]; plan_type: PlanType = PlanType.GROUP_HEALTH
    specialty_code: Optional[str] = None

class QPAValidationResponse(BaseModel):
    service_code: str; claimed_qpa: float; calculated_qpa: float
    is_valid: bool; variance_percent: float; recommendation: str

_pool: Optional[asyncpg.Pool] = None
_redis: Optional[aioredis.Redis] = None

async def get_db():
    global _pool
    if _pool is None:
        try:
            _pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
        except Exception as e:
            logger.warning(f"DB pool failed: {e}")
    return _pool

async def get_redis():
    global _redis
    if _redis is None:
        try:
            _redis = await aioredis.from_url(REDIS_URL, decode_responses=True)
        except Exception as e:
            logger.warning(f"Redis failed: {e}")
    return _redis

def calculate_qpa(req: RateCalculationRequest) -> RateCalculationResponse:
    """
    Calculate QPA per NSA regulations:
    1. Compute median of historical contracted rates
    2. Apply geographic cost-of-living adjustment
    3. Apply specialty relative value adjustment
    4. Apply plan type adjustment
    5. QPA = adjusted median rate
    """
    if not req.historical_rates:
        raise ValueError("Historical rates cannot be empty")

    rates = sorted(req.historical_rates)
    n = len(rates)

    # Core statistical calculations
    median_rate = statistics.median(rates)
    mean_rate = statistics.mean(rates)
    std_dev = statistics.stdev(rates) if n > 1 else 0.0

    # Percentiles
    p25 = float(np.percentile(rates, 25))
    p50 = float(np.percentile(rates, 50))
    p75 = float(np.percentile(rates, 75))
    p90 = float(np.percentile(rates, 90))

    # Geographic adjustment
    state = req.geographic_area.upper()[:2] if len(req.geographic_area) >= 2 else "DEFAULT"
    geo_adj = GEOGRAPHIC_ADJUSTMENTS.get(state, GEOGRAPHIC_ADJUSTMENTS["DEFAULT"])

    # Specialty adjustment
    specialty = (req.specialty_code or "DEFAULT").lower()
    spec_adj = SPECIALTY_ADJUSTMENTS.get(specialty, SPECIALTY_ADJUSTMENTS["DEFAULT"])

    # Plan type adjustment
    plan_adj = PLAN_TYPE_ADJUSTMENTS.get(req.plan_type.value, PLAN_TYPE_ADJUSTMENTS["DEFAULT"])

    # QPA = median × geographic_adj × specialty_adj × plan_type_adj
    qpa = round(median_rate * geo_adj * spec_adj * plan_adj, 2)

    # Confidence level based on sample size
    if n >= 100:
        confidence = "high"
    elif n >= 30:
        confidence = "medium"
    elif n >= 10:
        confidence = "low"
    else:
        confidence = "very_low"

    return RateCalculationResponse(
        service_code=req.service_code, geographic_area=req.geographic_area,
        qpa=qpa, median_contracted_rate=round(median_rate, 2),
        mean_contracted_rate=round(mean_rate, 2),
        percentile_25=round(p25, 2), percentile_50=round(p50, 2),
        percentile_75=round(p75, 2), percentile_90=round(p90, 2),
        std_deviation=round(std_dev, 2), sample_size=n,
        geographic_adjustment_factor=geo_adj, specialty_adjustment_factor=spec_adj,
        plan_type_adjustment_factor=plan_adj,
        calculation_method="NSA_MEDIAN_WITH_ADJUSTMENTS",
        confidence_level=confidence, calculated_at=datetime.utcnow(),
    )

@app.get("/health")
async def health():
    return {"status": "healthy", "service": "nsa-rate-calculation-engine", "version": "2.0.0"}

@app.post("/calculate_qpa", response_model=RateCalculationResponse)
async def calculate_qpa_legacy(request: RateCalculationRequest):
    """Legacy endpoint: calculate QPA."""
    if not request.historical_rates:
        raise HTTPException(400, "Historical rates cannot be empty")
    try:
        return calculate_qpa(request)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"QPA calculation failed: {str(e)}")

@app.post("/api/v1/rates/calculate", response_model=RateCalculationResponse)
async def calculate_rate(request: RateCalculationRequest):
    """Calculate QPA and comprehensive rate statistics."""
    cache_key = f"qpa:{request.service_code}:{request.geographic_area}:{request.plan_type}:{len(request.historical_rates)}"
    redis = await get_redis()
    if redis:
        cached = await redis.get(cache_key)
        if cached:
            data = json.loads(cached)
            data["calculated_at"] = datetime.utcnow()
            return RateCalculationResponse(**data)
    if not request.historical_rates:
        raise HTTPException(400, "Historical rates cannot be empty")
    try:
        result = calculate_qpa(request)
        if redis:
            cache_data = result.dict()
            cache_data["calculated_at"] = cache_data["calculated_at"].isoformat()
            await redis.setex(cache_key, 3600, json.dumps(cache_data))
        return result
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Rate calculation failed: {str(e)}")

@app.post("/api/v1/rates/batch")
async def calculate_batch(req: BatchRateRequest):
    """Calculate QPA for multiple service codes in batch."""
    if len(req.requests) > 100:
        raise HTTPException(400, "Maximum 100 calculations per batch")
    results = []
    for r in req.requests:
        try:
            result = calculate_qpa(r)
            results.append({"status": "success", "data": result.dict()})
        except Exception as e:
            results.append({"status": "error", "service_code": r.service_code, "error": str(e)})
    return {"results": results, "total": len(results),
            "successful": sum(1 for r in results if r["status"] == "success")}

@app.post("/api/v1/rates/validate-qpa", response_model=QPAValidationResponse)
async def validate_qpa(req: QPAValidationRequest):
    """Validate a claimed QPA against calculated QPA."""
    calc_req = RateCalculationRequest(
        service_code=req.service_code, geographic_area=req.geographic_area,
        historical_rates=req.historical_rates, plan_type=req.plan_type,
        specialty_code=req.specialty_code)
    try:
        result = calculate_qpa(calc_req)
        calculated_qpa = result.qpa
        variance = abs(req.claimed_qpa - calculated_qpa) / calculated_qpa * 100 if calculated_qpa > 0 else 0
        is_valid = variance <= 10.0  # Allow 10% variance
        if is_valid:
            recommendation = "QPA is within acceptable range"
        elif req.claimed_qpa < calculated_qpa * 0.9:
            recommendation = "Claimed QPA is significantly below calculated QPA; may be understated"
        else:
            recommendation = "Claimed QPA is significantly above calculated QPA; may be overstated"
        return QPAValidationResponse(
            service_code=req.service_code, claimed_qpa=req.claimed_qpa,
            calculated_qpa=calculated_qpa, is_valid=is_valid,
            variance_percent=round(variance, 2), recommendation=recommendation)
    except Exception as e:
        raise HTTPException(500, f"QPA validation failed: {str(e)}")

@app.get("/api/v1/rates/geographic-adjustments")
async def get_geographic_adjustments():
    """Get all geographic adjustment factors."""
    return {"adjustments": GEOGRAPHIC_ADJUSTMENTS}

@app.get("/api/v1/rates/specialty-adjustments")
async def get_specialty_adjustments():
    """Get all specialty adjustment factors."""
    return {"adjustments": SPECIALTY_ADJUSTMENTS}

@app.get("/api/v1/rates/plan-type-adjustments")
async def get_plan_type_adjustments():
    """Get all plan type adjustment factors."""
    return {"adjustments": PLAN_TYPE_ADJUSTMENTS}

@app.get("/api/v1/rates/history/{service_code}")
async def get_rate_history(service_code: str, geographic_area: Optional[str] = None,
                            limit: int = Query(50, le=200)):
    """Get historical rate calculations for a service code."""
    pool = await get_db()
    if not pool:
        raise HTTPException(503, "Database unavailable")
    conds = ["service_code=$1"]
    params = [service_code]
    idx = 2
    if geographic_area:
        conds.append(f"geographic_area=${idx}"); params.append(geographic_area); idx += 1
    params.append(limit)
    try:
        rows = await pool.fetch(
            f"SELECT * FROM nsa_rate_history WHERE {' AND '.join(conds)} ORDER BY calculated_at DESC LIMIT ${idx}",
            *params)
        return {"service_code": service_code, "history": [dict(r) for r in rows]}
    except Exception:
        return {"service_code": service_code, "history": []}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8037")))
