#!/usr/bin/env python3
"""
Healthcare Claims Platform - Simplified Search Analytics Service
Basic search and analytics service without Elasticsearch dependency for testing.
"""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
import uuid
import logging
import random

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Pydantic Models
class SearchQuery(BaseModel):
    query: str
    filters: Optional[Dict[str, Any]] = None
    limit: int = 10
    offset: int = 0

class SearchResult(BaseModel):
    id: str
    type: str
    title: str
    content: str
    score: float
    metadata: Dict[str, Any]

class AnalyticsQuery(BaseModel):
    metric: str
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    filters: Optional[Dict[str, Any]] = None

# Mock data for search
search_data = [
    {
        "id": "doc1",
        "type": "claim",
        "title": "Medical Claim - Patient 123",
        "content": "Routine checkup and blood work for patient 123. Diagnosis: Z00.00",
        "metadata": {"patient_id": "123", "provider_id": "prov1", "amount": 150.00}
    },
    {
        "id": "doc2", 
        "type": "provider",
        "title": "MedCorp Healthcare",
        "content": "Internal medicine practice specializing in preventive care",
        "metadata": {"npi": "1234567890", "specialty": "Internal Medicine", "verified": True}
    },
    {
        "id": "doc3",
        "type": "user",
        "title": "John Admin",
        "content": "Tenant administrator for MedCorp Healthcare",
        "metadata": {"role": "tenant_admin", "tenant_id": "tenant1", "active": True}
    }
]

# FastAPI app
app = FastAPI(
    title="Healthcare Claims Platform - Search Analytics Service",
    description="Simplified search and analytics service for testing",
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

def perform_search(query: str, filters: Optional[Dict] = None, limit: int = 10, offset: int = 0) -> List[Dict]:
    """Perform simple text search"""
    results = []
    
    for item in search_data:
        # Simple text matching
        score = 0.0
        query_lower = query.lower()
        
        if query_lower in item["title"].lower():
            score += 0.8
        if query_lower in item["content"].lower():
            score += 0.6
        
        # Apply filters
        if filters:
            for key, value in filters.items():
                if key in item["metadata"] and item["metadata"][key] == value:
                    score += 0.2
        
        if score > 0:
            results.append({
                **item,
                "score": score
            })
    
    # Sort by score and apply pagination
    results.sort(key=lambda x: x["score"], reverse=True)
    return results[offset:offset+limit]

@app.post("/search")
async def search(search_query: SearchQuery):
    """Search across platform data"""
    try:
        results = perform_search(
            search_query.query,
            search_query.filters,
            search_query.limit,
            search_query.offset
        )
        
        search_results = [
            SearchResult(
                id=item["id"],
                type=item["type"],
                title=item["title"],
                content=item["content"],
                score=item["score"],
                metadata=item["metadata"]
            )
            for item in results
        ]
        
        logger.info(f"Search performed: '{search_query.query}' - {len(search_results)} results")
        
        return {
            "results": search_results,
            "total": len(search_results),
            "query": search_query.query,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Search failed: {e}")
        raise HTTPException(status_code=500, detail="Search failed")

@app.get("/search/suggestions")
async def get_search_suggestions(q: str = Query(..., min_length=2)):
    """Get search suggestions"""
    try:
        suggestions = []
        q_lower = q.lower()
        
        for item in search_data:
            if q_lower in item["title"].lower():
                suggestions.append(item["title"])
            if q_lower in item["content"].lower() and item["title"] not in suggestions:
                suggestions.append(item["title"])
        
        return {
            "suggestions": suggestions[:5],  # Limit to 5 suggestions
            "query": q
        }
        
    except Exception as e:
        logger.error(f"Failed to get suggestions: {e}")
        raise HTTPException(status_code=500, detail="Failed to get suggestions")

@app.post("/analytics")
async def get_analytics(analytics_query: AnalyticsQuery):
    """Get analytics data"""
    try:
        # Generate mock analytics data
        end_date = datetime.utcnow()
        start_date = end_date - timedelta(days=30)
        
        if analytics_query.metric == "claims_volume":
            data = [
                {"date": (start_date + timedelta(days=i)).isoformat()[:10], 
                 "value": random.randint(50, 200)}
                for i in range(30)
            ]
        elif analytics_query.metric == "revenue":
            data = [
                {"date": (start_date + timedelta(days=i)).isoformat()[:10],
                 "value": round(random.uniform(5000, 25000), 2)}
                for i in range(30)
            ]
        elif analytics_query.metric == "provider_performance":
            data = [
                {"provider_id": f"prov{i}", "claims_processed": random.randint(10, 100),
                 "approval_rate": round(random.uniform(0.7, 0.95), 2)}
                for i in range(1, 6)
            ]
        else:
            data = []
        
        return {
            "metric": analytics_query.metric,
            "data": data,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Analytics query failed: {e}")
        raise HTTPException(status_code=500, detail="Analytics query failed")

@app.get("/analytics/dashboard")
async def get_dashboard_data():
    """Get dashboard analytics data"""
    try:
        return {
            "total_searches": random.randint(1000, 5000),
            "avg_response_time": round(random.uniform(50, 200), 2),
            "top_queries": [
                {"query": "patient claims", "count": random.randint(50, 200)},
                {"query": "provider verification", "count": random.randint(30, 150)},
                {"query": "billing reports", "count": random.randint(20, 100)}
            ],
            "search_trends": [
                {"date": (datetime.utcnow() - timedelta(days=i)).isoformat()[:10],
                 "searches": random.randint(100, 500)}
                for i in range(7, 0, -1)
            ],
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Failed to get dashboard data: {e}")
        raise HTTPException(status_code=500, detail="Failed to get dashboard data")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "service": "search-analytics-service",
        "version": "1.0.0",
        "indexed_documents": len(search_data)
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8007)
