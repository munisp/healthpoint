#!/usr/bin/env python3
"""
Healthcare Claims Platform - Simplified AI Fraud Detection Service
Basic fraud detection service without ML dependencies for testing.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime
import uuid
import logging
import random

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Pydantic Models
class FraudAnalysisRequest(BaseModel):
    claim_id: str
    patient_id: str
    provider_id: str
    diagnosis_code: str
    procedure_code: str
    amount: float
    service_date: str

class FraudAnalysisResponse(BaseModel):
    analysis_id: str
    claim_id: str
    risk_score: float
    risk_level: str
    flags: List[str]
    recommendations: List[str]
    confidence: float

class FraudAlert(BaseModel):
    id: str
    claim_id: str
    risk_score: float
    alert_type: str
    description: str
    created_at: str

# In-memory storage for testing
fraud_analyses = {}
fraud_alerts = {}

# FastAPI app
app = FastAPI(
    title="Healthcare Claims Platform - AI Fraud Detection Service",
    description="Simplified AI fraud detection service for testing",
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

def analyze_fraud_risk(request: FraudAnalysisRequest) -> Dict[str, Any]:
    """Simulate fraud risk analysis"""
    flags = []
    risk_score = 0.0
    
    # Rule-based fraud detection simulation
    
    # High amount flag
    if request.amount > 1000:
        flags.append("high_amount")
        risk_score += 0.3
    
    # Weekend service flag (simplified check)
    if "weekend" in request.service_date.lower():
        flags.append("weekend_service")
        risk_score += 0.2
    
    # Duplicate procedure simulation (random)
    if random.random() < 0.1:
        flags.append("potential_duplicate")
        risk_score += 0.4
    
    # Provider history simulation
    if random.random() < 0.05:
        flags.append("provider_history_concern")
        risk_score += 0.5
    
    # Unusual diagnosis-procedure combination
    if request.diagnosis_code.startswith("Z") and request.procedure_code.startswith("99"):
        if random.random() < 0.15:
            flags.append("unusual_dx_procedure_combo")
            risk_score += 0.3
    
    # Add some randomness to simulate ML model uncertainty
    risk_score += random.uniform(-0.1, 0.1)
    risk_score = max(0.0, min(1.0, risk_score))
    
    # Determine risk level
    if risk_score < 0.3:
        risk_level = "low"
    elif risk_score < 0.6:
        risk_level = "medium"
    elif risk_score < 0.8:
        risk_level = "high"
    else:
        risk_level = "critical"
    
    # Generate recommendations
    recommendations = []
    if "high_amount" in flags:
        recommendations.append("Review supporting documentation for high-value claim")
    if "potential_duplicate" in flags:
        recommendations.append("Check for duplicate submissions")
    if "provider_history_concern" in flags:
        recommendations.append("Review provider's recent claim patterns")
    if risk_level in ["high", "critical"]:
        recommendations.append("Manual review required before approval")
    
    confidence = random.uniform(0.7, 0.95)
    
    return {
        "risk_score": round(risk_score, 3),
        "risk_level": risk_level,
        "flags": flags,
        "recommendations": recommendations,
        "confidence": round(confidence, 3)
    }

@app.post("/analyze", response_model=FraudAnalysisResponse)
async def analyze_claim(request: FraudAnalysisRequest):
    """Analyze claim for fraud risk"""
    try:
        analysis_id = str(uuid.uuid4())
        
        # Perform fraud analysis
        analysis_result = analyze_fraud_risk(request)
        
        # Store analysis
        analysis_record = {
            "analysis_id": analysis_id,
            "claim_id": request.claim_id,
            "patient_id": request.patient_id,
            "provider_id": request.provider_id,
            "created_at": datetime.utcnow().isoformat(),
            **analysis_result
        }
        
        fraud_analyses[analysis_id] = analysis_record
        
        # Create alert if high risk
        if analysis_result["risk_level"] in ["high", "critical"]:
            alert_id = str(uuid.uuid4())
            alert = {
                "id": alert_id,
                "claim_id": request.claim_id,
                "risk_score": analysis_result["risk_score"],
                "alert_type": "high_risk_claim",
                "description": f"High fraud risk detected for claim {request.claim_id}",
                "created_at": datetime.utcnow().isoformat()
            }
            fraud_alerts[alert_id] = alert
        
        logger.info(f"Fraud analysis completed: {analysis_id} - Risk: {analysis_result['risk_level']}")
        
        return FraudAnalysisResponse(
            analysis_id=analysis_id,
            claim_id=request.claim_id,
            **analysis_result
        )
        
    except Exception as e:
        logger.error(f"Fraud analysis failed: {e}")
        raise HTTPException(status_code=500, detail="Fraud analysis failed")

@app.get("/analysis/{analysis_id}")
async def get_analysis(analysis_id: str):
    """Get fraud analysis by ID"""
    try:
        analysis = fraud_analyses.get(analysis_id)
        if not analysis:
            raise HTTPException(status_code=404, detail="Analysis not found")
        
        return analysis
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get analysis: {e}")
        raise HTTPException(status_code=500, detail="Failed to get analysis")

@app.get("/alerts")
async def get_fraud_alerts(limit: int = 100, offset: int = 0):
    """Get fraud alerts"""
    try:
        alerts = list(fraud_alerts.values())
        alerts.sort(key=lambda x: x["created_at"], reverse=True)
        
        return {
            "alerts": alerts[offset:offset+limit],
            "total": len(alerts),
            "limit": limit,
            "offset": offset
        }
        
    except Exception as e:
        logger.error(f"Failed to get alerts: {e}")
        raise HTTPException(status_code=500, detail="Failed to get alerts")

@app.get("/stats")
async def get_fraud_stats():
    """Get fraud detection statistics"""
    try:
        analyses = list(fraud_analyses.values())
        alerts = list(fraud_alerts.values())
        
        total_analyses = len(analyses)
        high_risk_count = len([a for a in analyses if a["risk_level"] in ["high", "critical"]])
        
        risk_distribution = {
            "low": len([a for a in analyses if a["risk_level"] == "low"]),
            "medium": len([a for a in analyses if a["risk_level"] == "medium"]),
            "high": len([a for a in analyses if a["risk_level"] == "high"]),
            "critical": len([a for a in analyses if a["risk_level"] == "critical"])
        }
        
        avg_risk_score = sum(a["risk_score"] for a in analyses) / total_analyses if total_analyses > 0 else 0
        
        return {
            "total_analyses": total_analyses,
            "total_alerts": len(alerts),
            "high_risk_claims": high_risk_count,
            "fraud_detection_rate": round(high_risk_count / total_analyses * 100, 2) if total_analyses > 0 else 0,
            "average_risk_score": round(avg_risk_score, 3),
            "risk_distribution": risk_distribution,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Failed to get fraud stats: {e}")
        raise HTTPException(status_code=500, detail="Failed to get fraud stats")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "service": "ai-fraud-detection-service",
        "version": "1.0.0",
        "analyses_count": len(fraud_analyses),
        "alerts_count": len(fraud_alerts)
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8009)
