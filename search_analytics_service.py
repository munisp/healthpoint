#!/usr/bin/env python3
"""
Healthcare Claims Platform - Search and Analytics Service
Advanced search capabilities, real-time analytics, and comprehensive reporting.

Author: Manus AI
Date: October 5, 2025
"""

from fastapi import FastAPI, HTTPException, Depends, Query, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, validator, Field
from typing import List, Optional, Dict, Any, Union
from datetime import datetime, timedelta
from enum import Enum
import uuid
import logging
import asyncio
import asyncpg
import aioredis
import json
import os
from contextlib import asynccontextmanager
import httpx
from elasticsearch import AsyncElasticsearch
import pandas as pd
import numpy as np
from decimal import Decimal
import re
from collections import defaultdict

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost/healthcare_platform")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
ELASTICSEARCH_URL = os.getenv("ELASTICSEARCH_URL", "http://localhost:9200")

class SearchType(str, Enum):
    CLAIMS = "claims"
    USERS = "users"
    PROVIDERS = "providers"
    TENANTS = "tenants"
    TRANSACTIONS = "transactions"
    DOCUMENTS = "documents"
    GLOBAL = "global"

class AggregationType(str, Enum):
    COUNT = "count"
    SUM = "sum"
    AVG = "avg"
    MIN = "min"
    MAX = "max"
    TERMS = "terms"
    DATE_HISTOGRAM = "date_histogram"
    RANGE = "range"

class ReportType(str, Enum):
    CLAIMS_SUMMARY = "claims_summary"
    FINANCIAL_REPORT = "financial_report"
    PROVIDER_PERFORMANCE = "provider_performance"
    TENANT_ANALYTICS = "tenant_analytics"
    FRAUD_ANALYSIS = "fraud_analysis"
    OPERATIONAL_METRICS = "operational_metrics"
    COMPLIANCE_REPORT = "compliance_report"

class TimeRange(str, Enum):
    LAST_HOUR = "1h"
    LAST_DAY = "1d"
    LAST_WEEK = "7d"
    LAST_MONTH = "30d"
    LAST_QUARTER = "90d"
    LAST_YEAR = "365d"
    CUSTOM = "custom"

# Pydantic Models
class SearchQuery(BaseModel):
    query: str
    search_type: SearchType = SearchType.GLOBAL
    filters: Dict[str, Any] = {}
    sort: List[Dict[str, str]] = []
    limit: int = Field(default=50, le=1000)
    offset: int = Field(default=0, ge=0)
    highlight: bool = True
    tenant_id: Optional[str] = None

class SearchResult(BaseModel):
    total: int
    results: List[Dict[str, Any]]
    aggregations: Dict[str, Any] = {}
    suggestions: List[str] = []
    took: int  # milliseconds
    highlights: Dict[str, List[str]] = {}

class AnalyticsQuery(BaseModel):
    metric: str
    dimensions: List[str] = []
    filters: Dict[str, Any] = {}
    time_range: TimeRange = TimeRange.LAST_DAY
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    aggregations: List[Dict[str, Any]] = []
    tenant_id: Optional[str] = None

class AnalyticsResult(BaseModel):
    metric: str
    value: Union[int, float, Dict[str, Any]]
    dimensions: Dict[str, Any] = {}
    time_series: List[Dict[str, Any]] = []
    aggregations: Dict[str, Any] = {}
    metadata: Dict[str, Any] = {}

class ReportRequest(BaseModel):
    report_type: ReportType
    parameters: Dict[str, Any] = {}
    time_range: TimeRange = TimeRange.LAST_MONTH
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    format: str = "json"  # json, csv, pdf
    tenant_id: Optional[str] = None
    email_recipients: List[str] = []

class ReportResponse(BaseModel):
    id: str
    report_type: ReportType
    status: str  # generating, completed, failed
    file_url: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None
    metadata: Dict[str, Any] = {}

class DashboardWidget(BaseModel):
    id: str
    title: str
    type: str  # chart, metric, table, map
    query: AnalyticsQuery
    visualization_config: Dict[str, Any] = {}
    position: Dict[str, int] = {}  # x, y, width, height
    refresh_interval: int = 300  # seconds

class Dashboard(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    widgets: List[DashboardWidget]
    layout: Dict[str, Any] = {}
    permissions: Dict[str, List[str]] = {}
    tenant_id: Optional[str] = None
    created_by: str
    created_at: datetime
    updated_at: datetime

# Database connection management
class DatabaseManager:
    def __init__(self):
        self.pool = None
        self.redis = None
        self.elasticsearch = None
    
    async def connect(self):
        """Initialize database connections"""
        try:
            self.pool = await asyncpg.create_pool(DATABASE_URL)
            self.redis = await aioredis.from_url(REDIS_URL)
            self.elasticsearch = AsyncElasticsearch([ELASTICSEARCH_URL])
            logger.info("Search and analytics database connections established")
        except Exception as e:
            logger.error(f"Failed to connect to database: {e}")
            raise
    
    async def disconnect(self):
        """Close database connections"""
        if self.pool:
            await self.pool.close()
        if self.redis:
            await self.redis.close()
        if self.elasticsearch:
            await self.elasticsearch.close()
        logger.info("Search and analytics database connections closed")

db_manager = DatabaseManager()

# Search Engine
class SearchEngine:
    def __init__(self):
        self.indices = {
            SearchType.CLAIMS: "healthcare_claims",
            SearchType.USERS: "healthcare_users",
            SearchType.PROVIDERS: "healthcare_providers",
            SearchType.TENANTS: "healthcare_tenants",
            SearchType.TRANSACTIONS: "healthcare_transactions",
            SearchType.DOCUMENTS: "healthcare_documents"
        }
    
    async def initialize_indices(self):
        """Initialize Elasticsearch indices"""
        try:
            # Claims index
            claims_mapping = {
                "mappings": {
                    "properties": {
                        "id": {"type": "keyword"},
                        "claim_number": {"type": "keyword"},
                        "status": {"type": "keyword"},
                        "claim_type": {"type": "keyword"},
                        "priority": {"type": "keyword"},
                        "patient_id": {"type": "keyword"},
                        "provider_id": {"type": "keyword"},
                        "tenant_id": {"type": "keyword"},
                        "total_amount": {"type": "double"},
                        "approved_amount": {"type": "double"},
                        "service_date_from": {"type": "date"},
                        "service_date_to": {"type": "date"},
                        "submitted_at": {"type": "date"},
                        "processed_at": {"type": "date"},
                        "patient_info": {"type": "object"},
                        "provider_info": {"type": "object"},
                        "insurance_info": {"type": "object"},
                        "diagnosis_codes": {"type": "keyword"},
                        "procedure_codes": {"type": "keyword"},
                        "notes": {"type": "text", "analyzer": "standard"},
                        "ai_insights": {"type": "object"},
                        "fraud_score": {"type": "double"}
                    }
                }
            }
            
            # Users index
            users_mapping = {
                "mappings": {
                    "properties": {
                        "id": {"type": "keyword"},
                        "email": {"type": "keyword"},
                        "first_name": {"type": "text"},
                        "last_name": {"type": "text"},
                        "full_name": {"type": "text"},
                        "role": {"type": "keyword"},
                        "status": {"type": "keyword"},
                        "tenant_id": {"type": "keyword"},
                        "created_at": {"type": "date"},
                        "last_login": {"type": "date"},
                        "permissions": {"type": "keyword"},
                        "profile": {"type": "object"}
                    }
                }
            }
            
            # Create indices if they don't exist
            for search_type, index_name in self.indices.items():
                if not await db_manager.elasticsearch.indices.exists(index=index_name):
                    if search_type == SearchType.CLAIMS:
                        await db_manager.elasticsearch.indices.create(index=index_name, body=claims_mapping)
                    elif search_type == SearchType.USERS:
                        await db_manager.elasticsearch.indices.create(index=index_name, body=users_mapping)
                    else:
                        await db_manager.elasticsearch.indices.create(index=index_name)
                    
                    logger.info(f"Created Elasticsearch index: {index_name}")
            
        except Exception as e:
            logger.error(f"Failed to initialize Elasticsearch indices: {e}")
    
    async def index_document(self, search_type: SearchType, doc_id: str, document: Dict[str, Any]):
        """Index a document in Elasticsearch"""
        try:
            index_name = self.indices[search_type]
            await db_manager.elasticsearch.index(
                index=index_name,
                id=doc_id,
                body=document
            )
        except Exception as e:
            logger.error(f"Failed to index document {doc_id}: {e}")
    
    async def search(self, query: SearchQuery) -> SearchResult:
        """Perform search across indices"""
        try:
            # Build Elasticsearch query
            es_query = await self._build_elasticsearch_query(query)
            
            # Determine target indices
            if query.search_type == SearchType.GLOBAL:
                indices = list(self.indices.values())
            else:
                indices = [self.indices[query.search_type]]
            
            # Add tenant filter if specified
            if query.tenant_id:
                tenant_filter = {"term": {"tenant_id": query.tenant_id}}
                if "bool" not in es_query:
                    es_query = {"bool": {"must": [es_query]}}
                if "filter" not in es_query["bool"]:
                    es_query["bool"]["filter"] = []
                es_query["bool"]["filter"].append(tenant_filter)
            
            # Execute search
            search_body = {
                "query": es_query,
                "from": query.offset,
                "size": query.limit,
                "sort": query.sort or [{"_score": {"order": "desc"}}]
            }
            
            # Add highlighting
            if query.highlight:
                search_body["highlight"] = {
                    "fields": {
                        "*": {}
                    },
                    "pre_tags": ["<mark>"],
                    "post_tags": ["</mark>"]
                }
            
            # Add aggregations for faceted search
            search_body["aggs"] = {
                "types": {"terms": {"field": "_index"}},
                "status": {"terms": {"field": "status"}},
                "date_range": {
                    "date_histogram": {
                        "field": "created_at",
                        "calendar_interval": "day"
                    }
                }
            }
            
            start_time = datetime.utcnow()
            response = await db_manager.elasticsearch.search(
                index=",".join(indices),
                body=search_body
            )
            end_time = datetime.utcnow()
            
            # Process results
            results = []
            highlights = {}
            
            for hit in response["hits"]["hits"]:
                result = hit["_source"]
                result["_id"] = hit["_id"]
                result["_index"] = hit["_index"]
                result["_score"] = hit["_score"]
                results.append(result)
                
                if "highlight" in hit:
                    highlights[hit["_id"]] = hit["highlight"]
            
            # Generate suggestions
            suggestions = await self._generate_suggestions(query.query, query.search_type)
            
            return SearchResult(
                total=response["hits"]["total"]["value"],
                results=results,
                aggregations=response.get("aggregations", {}),
                suggestions=suggestions,
                took=int((end_time - start_time).total_seconds() * 1000),
                highlights=highlights
            )
            
        except Exception as e:
            logger.error(f"Search failed: {e}")
            raise HTTPException(status_code=500, detail="Search failed")
    
    async def _build_elasticsearch_query(self, query: SearchQuery) -> Dict[str, Any]:
        """Build Elasticsearch query from search parameters"""
        if not query.query or query.query.strip() == "*":
            es_query = {"match_all": {}}
        else:
            # Multi-field search with boosting
            es_query = {
                "multi_match": {
                    "query": query.query,
                    "fields": [
                        "claim_number^3",
                        "email^2",
                        "first_name^2",
                        "last_name^2",
                        "full_name^2",
                        "notes",
                        "description",
                        "*"
                    ],
                    "type": "best_fields",
                    "fuzziness": "AUTO"
                }
            }
        
        # Apply filters
        if query.filters:
            bool_query = {"bool": {"must": [es_query]}}
            
            for field, value in query.filters.items():
                if isinstance(value, list):
                    bool_query["bool"]["filter"] = bool_query["bool"].get("filter", [])
                    bool_query["bool"]["filter"].append({"terms": {field: value}})
                elif isinstance(value, dict):
                    # Range query
                    if "gte" in value or "lte" in value or "gt" in value or "lt" in value:
                        bool_query["bool"]["filter"] = bool_query["bool"].get("filter", [])
                        bool_query["bool"]["filter"].append({"range": {field: value}})
                else:
                    bool_query["bool"]["filter"] = bool_query["bool"].get("filter", [])
                    bool_query["bool"]["filter"].append({"term": {field: value}})
            
            es_query = bool_query
        
        return es_query
    
    async def _generate_suggestions(self, query: str, search_type: SearchType) -> List[str]:
        """Generate search suggestions"""
        try:
            # Simple suggestion based on common terms
            suggestions = []
            
            if search_type == SearchType.CLAIMS:
                suggestions = ["approved claims", "denied claims", "pending claims", "high value claims"]
            elif search_type == SearchType.USERS:
                suggestions = ["active users", "admin users", "provider users", "recent logins"]
            elif search_type == SearchType.PROVIDERS:
                suggestions = ["active providers", "high volume providers", "new providers"]
            
            # Filter suggestions based on query
            if query:
                suggestions = [s for s in suggestions if query.lower() in s.lower()]
            
            return suggestions[:5]
            
        except Exception as e:
            logger.error(f"Failed to generate suggestions: {e}")
            return []

search_engine = SearchEngine()

# Analytics Engine
class AnalyticsEngine:
    def __init__(self):
        self.cache_ttl = 300  # 5 minutes
    
    async def get_analytics(self, query: AnalyticsQuery) -> AnalyticsResult:
        """Get analytics data"""
        try:
            # Check cache first
            cache_key = self._generate_cache_key(query)
            cached_result = await db_manager.redis.get(cache_key)
            
            if cached_result:
                return AnalyticsResult(**json.loads(cached_result))
            
            # Calculate time range
            start_date, end_date = self._calculate_time_range(query)
            
            # Execute analytics query
            result = await self._execute_analytics_query(query, start_date, end_date)
            
            # Cache result
            await db_manager.redis.setex(
                cache_key, 
                self.cache_ttl, 
                json.dumps(result.dict(), default=str)
            )
            
            return result
            
        except Exception as e:
            logger.error(f"Analytics query failed: {e}")
            raise HTTPException(status_code=500, detail="Analytics query failed")
    
    async def _execute_analytics_query(self, query: AnalyticsQuery, start_date: datetime, end_date: datetime) -> AnalyticsResult:
        """Execute analytics query against database"""
        async with db_manager.pool.acquire() as conn:
            if query.metric == "claims_count":
                return await self._get_claims_analytics(conn, query, start_date, end_date)
            elif query.metric == "revenue_analytics":
                return await self._get_revenue_analytics(conn, query, start_date, end_date)
            elif query.metric == "provider_performance":
                return await self._get_provider_performance(conn, query, start_date, end_date)
            elif query.metric == "fraud_analytics":
                return await self._get_fraud_analytics(conn, query, start_date, end_date)
            else:
                raise HTTPException(status_code=400, detail="Unknown metric")
    
    async def _get_claims_analytics(self, conn, query: AnalyticsQuery, start_date: datetime, end_date: datetime) -> AnalyticsResult:
        """Get claims analytics"""
        # Base query
        sql = """
            SELECT 
                COUNT(*) as total_claims,
                COUNT(*) FILTER (WHERE status = 'approved') as approved_claims,
                COUNT(*) FILTER (WHERE status = 'denied') as denied_claims,
                COUNT(*) FILTER (WHERE status IN ('submitted', 'received', 'under_review')) as pending_claims,
                AVG(total_amount) as avg_claim_amount,
                SUM(total_amount) as total_claim_amount,
                SUM(approved_amount) as total_approved_amount
            FROM claims 
            WHERE submitted_at BETWEEN $1 AND $2
        """
        
        params = [start_date, end_date]
        
        # Add tenant filter
        if query.tenant_id:
            sql += " AND tenant_id = $3"
            params.append(query.tenant_id)
        
        # Add additional filters
        param_count = len(params)
        for field, value in query.filters.items():
            param_count += 1
            sql += f" AND {field} = ${param_count}"
            params.append(value)
        
        result = await conn.fetchrow(sql, *params)
        
        # Get time series data if requested
        time_series = []
        if "time_series" in query.dimensions:
            time_series = await self._get_claims_time_series(conn, query, start_date, end_date)
        
        return AnalyticsResult(
            metric=query.metric,
            value={
                "total_claims": result["total_claims"],
                "approved_claims": result["approved_claims"],
                "denied_claims": result["denied_claims"],
                "pending_claims": result["pending_claims"],
                "approval_rate": (result["approved_claims"] / max(result["total_claims"], 1)) * 100,
                "avg_claim_amount": float(result["avg_claim_amount"] or 0),
                "total_claim_amount": float(result["total_claim_amount"] or 0),
                "total_approved_amount": float(result["total_approved_amount"] or 0)
            },
            time_series=time_series,
            metadata={
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat(),
                "query_time": datetime.utcnow().isoformat()
            }
        )
    
    async def _get_claims_time_series(self, conn, query: AnalyticsQuery, start_date: datetime, end_date: datetime) -> List[Dict[str, Any]]:
        """Get claims time series data"""
        sql = """
            SELECT 
                DATE_TRUNC('day', submitted_at) as date,
                COUNT(*) as count,
                SUM(total_amount) as total_amount
            FROM claims 
            WHERE submitted_at BETWEEN $1 AND $2
        """
        
        params = [start_date, end_date]
        
        if query.tenant_id:
            sql += " AND tenant_id = $3"
            params.append(query.tenant_id)
        
        sql += " GROUP BY DATE_TRUNC('day', submitted_at) ORDER BY date"
        
        results = await conn.fetch(sql, *params)
        
        return [
            {
                "date": result["date"].isoformat(),
                "count": result["count"],
                "total_amount": float(result["total_amount"] or 0)
            }
            for result in results
        ]
    
    async def _get_revenue_analytics(self, conn, query: AnalyticsQuery, start_date: datetime, end_date: datetime) -> AnalyticsResult:
        """Get revenue analytics"""
        sql = """
            SELECT 
                SUM(total_amount) as total_revenue,
                SUM(approved_amount) as approved_revenue,
                COUNT(*) as transaction_count,
                AVG(total_amount) as avg_transaction_amount
            FROM claims 
            WHERE submitted_at BETWEEN $1 AND $2 AND status = 'approved'
        """
        
        params = [start_date, end_date]
        
        if query.tenant_id:
            sql += " AND tenant_id = $3"
            params.append(query.tenant_id)
        
        result = await conn.fetchrow(sql, *params)
        
        return AnalyticsResult(
            metric=query.metric,
            value={
                "total_revenue": float(result["total_revenue"] or 0),
                "approved_revenue": float(result["approved_revenue"] or 0),
                "transaction_count": result["transaction_count"],
                "avg_transaction_amount": float(result["avg_transaction_amount"] or 0)
            },
            metadata={
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat()
            }
        )
    
    async def _get_provider_performance(self, conn, query: AnalyticsQuery, start_date: datetime, end_date: datetime) -> AnalyticsResult:
        """Get provider performance analytics"""
        sql = """
            SELECT 
                provider_id,
                COUNT(*) as claims_count,
                SUM(total_amount) as total_amount,
                SUM(approved_amount) as approved_amount,
                AVG(total_amount) as avg_claim_amount,
                COUNT(*) FILTER (WHERE status = 'approved') as approved_count,
                COUNT(*) FILTER (WHERE status = 'denied') as denied_count
            FROM claims 
            WHERE submitted_at BETWEEN $1 AND $2
        """
        
        params = [start_date, end_date]
        
        if query.tenant_id:
            sql += " AND tenant_id = $3"
            params.append(query.tenant_id)
        
        sql += " GROUP BY provider_id ORDER BY claims_count DESC LIMIT 100"
        
        results = await conn.fetch(sql, *params)
        
        provider_data = []
        for result in results:
            approval_rate = (result["approved_count"] / max(result["claims_count"], 1)) * 100
            provider_data.append({
                "provider_id": result["provider_id"],
                "claims_count": result["claims_count"],
                "total_amount": float(result["total_amount"] or 0),
                "approved_amount": float(result["approved_amount"] or 0),
                "avg_claim_amount": float(result["avg_claim_amount"] or 0),
                "approval_rate": approval_rate
            })
        
        return AnalyticsResult(
            metric=query.metric,
            value=provider_data,
            metadata={
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat(),
                "provider_count": len(provider_data)
            }
        )
    
    async def _get_fraud_analytics(self, conn, query: AnalyticsQuery, start_date: datetime, end_date: datetime) -> AnalyticsResult:
        """Get fraud analytics"""
        # This would integrate with the AI insights from claims processing
        sql = """
            SELECT 
                COUNT(*) as total_claims,
                COUNT(*) FILTER (WHERE ai_insights->>'fraud_risk' IS NOT NULL) as flagged_claims,
                AVG(CAST(ai_insights->'fraud_risk'->>'risk_score' AS FLOAT)) as avg_fraud_score
            FROM claims 
            WHERE submitted_at BETWEEN $1 AND $2
        """
        
        params = [start_date, end_date]
        
        if query.tenant_id:
            sql += " AND tenant_id = $3"
            params.append(query.tenant_id)
        
        result = await conn.fetchrow(sql, *params)
        
        return AnalyticsResult(
            metric=query.metric,
            value={
                "total_claims": result["total_claims"],
                "flagged_claims": result["flagged_claims"],
                "fraud_detection_rate": (result["flagged_claims"] / max(result["total_claims"], 1)) * 100,
                "avg_fraud_score": float(result["avg_fraud_score"] or 0)
            },
            metadata={
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat()
            }
        )
    
    def _calculate_time_range(self, query: AnalyticsQuery) -> tuple[datetime, datetime]:
        """Calculate start and end dates for time range"""
        end_date = datetime.utcnow()
        
        if query.time_range == TimeRange.CUSTOM:
            if query.start_date and query.end_date:
                return query.start_date, query.end_date
            else:
                raise HTTPException(status_code=400, detail="Custom time range requires start_date and end_date")
        
        time_deltas = {
            TimeRange.LAST_HOUR: timedelta(hours=1),
            TimeRange.LAST_DAY: timedelta(days=1),
            TimeRange.LAST_WEEK: timedelta(days=7),
            TimeRange.LAST_MONTH: timedelta(days=30),
            TimeRange.LAST_QUARTER: timedelta(days=90),
            TimeRange.LAST_YEAR: timedelta(days=365)
        }
        
        delta = time_deltas.get(query.time_range, timedelta(days=1))
        start_date = end_date - delta
        
        return start_date, end_date
    
    def _generate_cache_key(self, query: AnalyticsQuery) -> str:
        """Generate cache key for analytics query"""
        key_data = {
            "metric": query.metric,
            "dimensions": sorted(query.dimensions),
            "filters": sorted(query.filters.items()) if query.filters else [],
            "time_range": query.time_range.value,
            "tenant_id": query.tenant_id
        }
        
        key_str = json.dumps(key_data, sort_keys=True)
        return f"analytics:{hash(key_str)}"

analytics_engine = AnalyticsEngine()

# Report Generator
class ReportGenerator:
    def __init__(self):
        self.report_handlers = {
            ReportType.CLAIMS_SUMMARY: self._generate_claims_summary,
            ReportType.FINANCIAL_REPORT: self._generate_financial_report,
            ReportType.PROVIDER_PERFORMANCE: self._generate_provider_performance,
            ReportType.FRAUD_ANALYSIS: self._generate_fraud_analysis
        }
    
    async def generate_report(self, request: ReportRequest) -> ReportResponse:
        """Generate report"""
        report_id = str(uuid.uuid4())
        
        # Store report request
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO reports (
                    id, report_type, parameters, time_range, start_date, end_date,
                    format, tenant_id, status, created_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            """, 
                report_id, request.report_type.value, json.dumps(request.parameters),
                request.time_range.value, request.start_date, request.end_date,
                request.format, request.tenant_id, "generating", datetime.utcnow()
            )
        
        # Generate report asynchronously
        asyncio.create_task(self._process_report(report_id, request))
        
        return ReportResponse(
            id=report_id,
            report_type=request.report_type,
            status="generating",
            created_at=datetime.utcnow()
        )
    
    async def _process_report(self, report_id: str, request: ReportRequest):
        """Process report generation"""
        try:
            handler = self.report_handlers.get(request.report_type)
            if not handler:
                raise ValueError(f"Unknown report type: {request.report_type}")
            
            # Generate report data
            report_data = await handler(request)
            
            # Save report file (simplified - would use proper file storage)
            file_path = f"/tmp/report_{report_id}.{request.format}"
            
            if request.format == "json":
                with open(file_path, "w") as f:
                    json.dump(report_data, f, indent=2, default=str)
            elif request.format == "csv":
                # Convert to CSV (simplified)
                df = pd.DataFrame(report_data.get("data", []))
                df.to_csv(file_path, index=False)
            
            # Update report status
            async with db_manager.pool.acquire() as conn:
                await conn.execute("""
                    UPDATE reports 
                    SET status = $1, file_path = $2, completed_at = $3
                    WHERE id = $4
                """, "completed", file_path, datetime.utcnow(), report_id)
            
            logger.info(f"Report {report_id} generated successfully")
            
        except Exception as e:
            logger.error(f"Report generation failed for {report_id}: {e}")
            
            # Update report status to failed
            async with db_manager.pool.acquire() as conn:
                await conn.execute("""
                    UPDATE reports 
                    SET status = $1, error_message = $2, completed_at = $3
                    WHERE id = $4
                """, "failed", str(e), datetime.utcnow(), report_id)
    
    async def _generate_claims_summary(self, request: ReportRequest) -> Dict[str, Any]:
        """Generate claims summary report"""
        start_date, end_date = self._calculate_time_range(request)
        
        async with db_manager.pool.acquire() as conn:
            # Summary statistics
            summary = await conn.fetchrow("""
                SELECT 
                    COUNT(*) as total_claims,
                    COUNT(*) FILTER (WHERE status = 'approved') as approved_claims,
                    COUNT(*) FILTER (WHERE status = 'denied') as denied_claims,
                    COUNT(*) FILTER (WHERE status IN ('submitted', 'received', 'under_review')) as pending_claims,
                    SUM(total_amount) as total_amount,
                    SUM(approved_amount) as approved_amount,
                    AVG(total_amount) as avg_claim_amount
                FROM claims 
                WHERE submitted_at BETWEEN $1 AND $2
                AND ($3::uuid IS NULL OR tenant_id = $3)
            """, start_date, end_date, request.tenant_id)
            
            # Claims by type
            by_type = await conn.fetch("""
                SELECT claim_type, COUNT(*) as count, SUM(total_amount) as amount
                FROM claims 
                WHERE submitted_at BETWEEN $1 AND $2
                AND ($3::uuid IS NULL OR tenant_id = $3)
                GROUP BY claim_type
                ORDER BY count DESC
            """, start_date, end_date, request.tenant_id)
            
            # Top providers
            top_providers = await conn.fetch("""
                SELECT provider_id, COUNT(*) as claims_count, SUM(total_amount) as total_amount
                FROM claims 
                WHERE submitted_at BETWEEN $1 AND $2
                AND ($3::uuid IS NULL OR tenant_id = $3)
                GROUP BY provider_id
                ORDER BY claims_count DESC
                LIMIT 10
            """, start_date, end_date, request.tenant_id)
        
        return {
            "report_type": "Claims Summary Report",
            "period": f"{start_date.date()} to {end_date.date()}",
            "summary": dict(summary),
            "by_type": [dict(row) for row in by_type],
            "top_providers": [dict(row) for row in top_providers],
            "generated_at": datetime.utcnow().isoformat()
        }
    
    async def _generate_financial_report(self, request: ReportRequest) -> Dict[str, Any]:
        """Generate financial report"""
        # Implementation would include detailed financial analytics
        return {"report_type": "Financial Report", "data": []}
    
    async def _generate_provider_performance(self, request: ReportRequest) -> Dict[str, Any]:
        """Generate provider performance report"""
        # Implementation would include provider performance metrics
        return {"report_type": "Provider Performance Report", "data": []}
    
    async def _generate_fraud_analysis(self, request: ReportRequest) -> Dict[str, Any]:
        """Generate fraud analysis report"""
        # Implementation would include fraud detection analytics
        return {"report_type": "Fraud Analysis Report", "data": []}
    
    def _calculate_time_range(self, request: ReportRequest) -> tuple[datetime, datetime]:
        """Calculate time range for report"""
        if request.time_range == TimeRange.CUSTOM:
            return request.start_date, request.end_date
        
        end_date = datetime.utcnow()
        time_deltas = {
            TimeRange.LAST_DAY: timedelta(days=1),
            TimeRange.LAST_WEEK: timedelta(days=7),
            TimeRange.LAST_MONTH: timedelta(days=30),
            TimeRange.LAST_QUARTER: timedelta(days=90),
            TimeRange.LAST_YEAR: timedelta(days=365)
        }
        
        delta = time_deltas.get(request.time_range, timedelta(days=30))
        start_date = end_date - delta
        
        return start_date, end_date

report_generator = ReportGenerator()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await db_manager.connect()
    await initialize_database()
    await search_engine.initialize_indices()
    yield
    # Shutdown
    await db_manager.disconnect()

# FastAPI app
app = FastAPI(
    title="Healthcare Claims Platform - Search and Analytics Service",
    description="Advanced search capabilities, real-time analytics, and comprehensive reporting",
    version="1.0.0",
    lifespan=lifespan
)

# Add middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

async def initialize_database():
    """Initialize database tables"""
    async with db_manager.pool.acquire() as conn:
        # Create reports table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS reports (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                report_type VARCHAR(50) NOT NULL,
                parameters JSONB,
                time_range VARCHAR(20),
                start_date TIMESTAMP,
                end_date TIMESTAMP,
                format VARCHAR(10) DEFAULT 'json',
                tenant_id UUID,
                status VARCHAR(20) DEFAULT 'generating',
                file_path TEXT,
                error_message TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                completed_at TIMESTAMP
            )
        """)
        
        # Create dashboards table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS dashboards (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR(255) NOT NULL,
                description TEXT,
                widgets JSONB NOT NULL,
                layout JSONB,
                permissions JSONB,
                tenant_id UUID,
                created_by UUID NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        logger.info("Search and analytics database tables initialized")

# API Endpoints
@app.post("/search", response_model=SearchResult)
async def search(query: SearchQuery):
    """Perform search across platform data"""
    return await search_engine.search(query)

@app.post("/analytics", response_model=AnalyticsResult)
async def get_analytics(query: AnalyticsQuery):
    """Get analytics data"""
    return await analytics_engine.get_analytics(query)

@app.post("/reports", response_model=ReportResponse)
async def generate_report(request: ReportRequest):
    """Generate report"""
    return await report_generator.generate_report(request)

@app.get("/reports/{report_id}")
async def get_report(report_id: str):
    """Get report status and download link"""
    async with db_manager.pool.acquire() as conn:
        report = await conn.fetchrow("""
            SELECT * FROM reports WHERE id = $1
        """, report_id)
        
        if not report:
            raise HTTPException(status_code=404, detail="Report not found")
        
        return dict(report)

@app.get("/dashboards")
async def list_dashboards(tenant_id: Optional[str] = None):
    """List dashboards"""
    async with db_manager.pool.acquire() as conn:
        query = "SELECT * FROM dashboards WHERE 1=1"
        params = []
        
        if tenant_id:
            query += " AND tenant_id = $1"
            params.append(tenant_id)
        
        query += " ORDER BY created_at DESC"
        
        dashboards = await conn.fetch(query, *params)
        return {"dashboards": [dict(dashboard) for dashboard in dashboards]}

@app.post("/index/{search_type}/{doc_id}")
async def index_document(search_type: SearchType, doc_id: str, document: Dict[str, Any]):
    """Index a document for search"""
    await search_engine.index_document(search_type, doc_id, document)
    return {"message": "Document indexed successfully"}

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        async with db_manager.pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        
        await db_manager.redis.ping()
        
        # Check Elasticsearch
        es_health = await db_manager.elasticsearch.cluster.health()
        
        return {
            "status": "healthy",
            "timestamp": datetime.utcnow().isoformat(),
            "service": "search-analytics-service",
            "version": "1.0.0",
            "elasticsearch_status": es_health["status"]
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service unhealthy"
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8006)
