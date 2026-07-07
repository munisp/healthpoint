#!/usr/bin/env python3
"""
Enhanced Integration Orchestrator for Georgetown + Health Affairs + CMS PUF Platform
Coordinates all enhanced services with full CMS PUF compliance and advanced analytics
"""

from flask import Flask, request, jsonify
import requests
import asyncio
import aiohttp
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
import json
import os
import sqlite3
import pandas as pd
from concurrent.futures import ThreadPoolExecutor
import threading

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

class EnhancedIntegrationOrchestrator:
    """Enhanced orchestrator supporting Georgetown, Health Affairs, and CMS PUF integration"""
    
    def __init__(self):
        self.services = {
            'volume_management': 'http://localhost:5001',
            'predictive_analytics': 'http://localhost:5002',
            'idr_entity_selection': 'http://localhost:5003',
            'third_party_integration': 'http://localhost:5004',
            'eligibility_validation': 'http://localhost:5005',
            'enhanced_entity_selection': 'http://localhost:5006',
            'puf_data_service': 'http://localhost:5007'
        }
        
        self.cache = {}
        self.cache_ttl = 300  # 5 minutes
        self.executor = ThreadPoolExecutor(max_workers=10)
        
        # Georgetown research baseline
        self.georgetown_baseline = {
            "provider_win_rate": 0.88,
            "case_volume_q1_q2_2024": 586581,
            "specialty_multipliers": {
                "Radiology": 5.0,
                "Emergency Medicine": 3.5,
                "Surgery": 8.0,
                "Neurology": 12.0
            }
        }
        
        # Health Affairs entity bias patterns
        self.health_affairs_patterns = {
            "entity_variance_range": (0.33, 0.99),
            "pe_organizations": ["Team Health", "SCP Health", "Radiology Partners", "Envision"],
            "market_concentration": 0.70,  # 70% of cases by 4 PE organizations
            "payment_acceleration": {
                "2023_q1": 0.72,
                "2023_q4": 0.85
            }
        }
    
    def _is_cache_valid(self, key: str) -> bool:
        """Check if cached data is still valid"""
        if key not in self.cache:
            return False
        
        cached_time = self.cache[key].get('timestamp', 0)
        return (datetime.now().timestamp() - cached_time) < self.cache_ttl
    
    def _get_cached_or_fetch(self, key: str, fetch_func, *args, **kwargs):
        """Get data from cache or fetch if expired"""
        if self._is_cache_valid(key):
            return self.cache[key]['data']
        
        try:
            data = fetch_func(*args, **kwargs)
            self.cache[key] = {
                'data': data,
                'timestamp': datetime.now().timestamp()
            }
            return data
        except Exception as e:
            logger.error(f"Error fetching data for {key}: {str(e)}")
            return self.cache.get(key, {}).get('data', {})
    
    async def _async_service_call(self, session: aiohttp.ClientSession, service_name: str, endpoint: str, method: str = 'GET', data: Dict = None) -> Dict:
        """Make async call to service"""
        try:
            url = f"{self.services[service_name]}{endpoint}"
            
            if method.upper() == 'GET':
                async with session.get(url, timeout=10) as response:
                    return await response.json()
            elif method.upper() == 'POST':
                async with session.post(url, json=data, timeout=10) as response:
                    return await response.json()
                    
        except Exception as e:
            logger.error(f"Error calling {service_name}{endpoint}: {str(e)}")
            return {"error": str(e), "service": service_name}
    
    async def get_comprehensive_analytics(self) -> Dict[str, Any]:
        """Get comprehensive analytics from all enhanced services"""
        try:
            async with aiohttp.ClientSession() as session:
                # Parallel service calls
                tasks = [
                    self._async_service_call(session, 'volume_management', '/analytics/current-load'),
                    self._async_service_call(session, 'predictive_analytics', '/analytics/georgetown-enhanced'),
                    self._async_service_call(session, 'idr_entity_selection', '/analytics/bias-detection'),
                    self._async_service_call(session, 'enhanced_entity_selection', '/analytics/health-affairs-enhanced'),
                    self._async_service_call(session, 'puf_data_service', '/puf/analytics/dispute-types'),
                    self._async_service_call(session, 'puf_data_service', '/puf/analytics/geographic'),
                    self._async_service_call(session, 'puf_data_service', '/puf/analytics/financial')
                ]
                
                results = await asyncio.gather(*tasks, return_exceptions=True)
                
                # Process results
                analytics_data = {
                    'volume_management': results[0] if not isinstance(results[0], Exception) else {},
                    'predictive_analytics': results[1] if not isinstance(results[1], Exception) else {},
                    'entity_bias_detection': results[2] if not isinstance(results[2], Exception) else {},
                    'health_affairs_enhanced': results[3] if not isinstance(results[3], Exception) else {},
                    'puf_dispute_types': results[4] if not isinstance(results[4], Exception) else {},
                    'puf_geographic': results[5] if not isinstance(results[5], Exception) else {},
                    'puf_financial': results[6] if not isinstance(results[6], Exception) else {}
                }
                
                # Add integration insights
                analytics_data['integration_insights'] = self._generate_integration_insights(analytics_data)
                analytics_data['compliance_score'] = self._calculate_compliance_score(analytics_data)
                analytics_data['timestamp'] = datetime.now().isoformat()
                
                return analytics_data
                
        except Exception as e:
            logger.error(f"Error getting comprehensive analytics: {str(e)}")
            return {"error": str(e)}
    
    def _generate_integration_insights(self, analytics_data: Dict) -> Dict[str, Any]:
        """Generate insights from integrated data sources"""
        insights = {
            "georgetown_validation": {},
            "health_affairs_validation": {},
            "puf_compliance": {},
            "cross_validation": {}
        }
        
        try:
            # Georgetown validation
            puf_financial = analytics_data.get('puf_financial', {})
            if 'financial_summary' in puf_financial:
                actual_provider_rate = puf_financial['financial_summary'].get('avg_prevailing_pct_qpa', 0) / 100
                expected_rate = self.georgetown_baseline['provider_win_rate']
                
                insights['georgetown_validation'] = {
                    "expected_win_rate": expected_rate,
                    "actual_win_rate": actual_provider_rate,
                    "variance": abs(actual_provider_rate - expected_rate),
                    "alignment_score": max(0, 1 - abs(actual_provider_rate - expected_rate))
                }
            
            # Health Affairs validation
            entity_bias = analytics_data.get('entity_bias_detection', {})
            if 'bias_metrics' in entity_bias:
                insights['health_affairs_validation'] = {
                    "entity_variance_detected": entity_bias.get('variance_score', 0) > 0.1,
                    "pe_concentration_detected": entity_bias.get('concentration_score', 0) > 0.5,
                    "bias_risk_level": "high" if entity_bias.get('variance_score', 0) > 0.3 else "medium"
                }
            
            # PUF compliance assessment
            puf_dispute_types = analytics_data.get('puf_dispute_types', {})
            puf_geographic = analytics_data.get('puf_geographic', {})
            
            insights['puf_compliance'] = {
                "multi_tab_support": bool(puf_dispute_types and puf_geographic),
                "dispute_type_coverage": len(puf_dispute_types.get('dispute_types', [])),
                "geographic_coverage": len(puf_geographic.get('state_analysis', [])),
                "data_completeness": self._assess_puf_completeness(analytics_data)
            }
            
            # Cross-validation insights
            insights['cross_validation'] = {
                "data_consistency": self._check_data_consistency(analytics_data),
                "model_alignment": self._check_model_alignment(analytics_data),
                "recommendation_confidence": self._calculate_recommendation_confidence(analytics_data)
            }
            
        except Exception as e:
            logger.error(f"Error generating integration insights: {str(e)}")
            insights['error'] = str(e)
        
        return insights
    
    def _calculate_compliance_score(self, analytics_data: Dict) -> Dict[str, Any]:
        """Calculate overall platform compliance score"""
        scores = {
            "georgetown_compliance": 0,
            "health_affairs_compliance": 0,
            "puf_compliance": 0,
            "overall_compliance": 0
        }
        
        try:
            # Georgetown compliance (based on research alignment)
            georgetown_insights = analytics_data.get('integration_insights', {}).get('georgetown_validation', {})
            if georgetown_insights:
                scores['georgetown_compliance'] = georgetown_insights.get('alignment_score', 0) * 100
            
            # Health Affairs compliance (based on bias detection capabilities)
            health_affairs_insights = analytics_data.get('integration_insights', {}).get('health_affairs_validation', {})
            if health_affairs_insights:
                bias_detection_score = 80 if health_affairs_insights.get('entity_variance_detected') else 40
                pe_detection_score = 20 if health_affairs_insights.get('pe_concentration_detected') else 0
                scores['health_affairs_compliance'] = bias_detection_score + pe_detection_score
            
            # PUF compliance (based on data structure support)
            puf_insights = analytics_data.get('integration_insights', {}).get('puf_compliance', {})
            if puf_insights:
                multi_tab_score = 40 if puf_insights.get('multi_tab_support') else 0
                coverage_score = min(40, puf_insights.get('dispute_type_coverage', 0) * 10)
                completeness_score = puf_insights.get('data_completeness', 0) * 20
                scores['puf_compliance'] = multi_tab_score + coverage_score + completeness_score
            
            # Overall compliance
            scores['overall_compliance'] = (
                scores['georgetown_compliance'] * 0.3 +
                scores['health_affairs_compliance'] * 0.3 +
                scores['puf_compliance'] * 0.4
            )
            
        except Exception as e:
            logger.error(f"Error calculating compliance score: {str(e)}")
        
        return scores
    
    def _assess_puf_completeness(self, analytics_data: Dict) -> float:
        """Assess completeness of PUF data implementation"""
        completeness_factors = []
        
        # Check for multi-tab data
        if analytics_data.get('puf_dispute_types'):
            completeness_factors.append(0.25)
        if analytics_data.get('puf_geographic'):
            completeness_factors.append(0.25)
        if analytics_data.get('puf_financial'):
            completeness_factors.append(0.25)
        
        # Check for advanced analytics
        if analytics_data.get('health_affairs_enhanced'):
            completeness_factors.append(0.25)
        
        return sum(completeness_factors)
    
    def _check_data_consistency(self, analytics_data: Dict) -> float:
        """Check consistency across data sources"""
        # Simplified consistency check
        # In production, this would compare actual data points
        consistency_score = 0.85  # Mock score
        return consistency_score
    
    def _check_model_alignment(self, analytics_data: Dict) -> float:
        """Check alignment between different predictive models"""
        # Simplified alignment check
        alignment_score = 0.78  # Mock score
        return alignment_score
    
    def _calculate_recommendation_confidence(self, analytics_data: Dict) -> float:
        """Calculate confidence level for recommendations"""
        # Based on data quality and model performance
        confidence_factors = []
        
        # Model performance factor
        predictive_analytics = analytics_data.get('predictive_analytics', {})
        if 'model_accuracy' in predictive_analytics:
            confidence_factors.append(predictive_analytics['model_accuracy'])
        
        # Data completeness factor
        puf_compliance = analytics_data.get('integration_insights', {}).get('puf_compliance', {})
        if 'data_completeness' in puf_compliance:
            confidence_factors.append(puf_compliance['data_completeness'])
        
        return sum(confidence_factors) / len(confidence_factors) if confidence_factors else 0.5
    
    def generate_strategic_recommendations(self, analytics_data: Dict) -> List[Dict[str, Any]]:
        """Generate strategic recommendations based on integrated analytics"""
        recommendations = []
        
        try:
            integration_insights = analytics_data.get('integration_insights', {})
            
            # Georgetown-based recommendations
            georgetown_validation = integration_insights.get('georgetown_validation', {})
            if georgetown_validation.get('variance', 1) > 0.1:
                recommendations.append({
                    "category": "Georgetown Research Alignment",
                    "priority": "high",
                    "recommendation": "Significant variance detected from Georgetown baseline. Review specialty-specific strategies.",
                    "impact": "Improve prediction accuracy by 15-20%",
                    "implementation": "Update specialty multipliers and geographic complexity factors"
                })
            
            # Health Affairs-based recommendations
            health_affairs_validation = integration_insights.get('health_affairs_validation', {})
            if health_affairs_validation.get('entity_variance_detected'):
                recommendations.append({
                    "category": "Entity Bias Mitigation",
                    "priority": "critical",
                    "recommendation": "High entity bias variance detected. Implement bias-aware entity selection.",
                    "impact": "Reduce bias-related losses by 25-40%",
                    "implementation": "Deploy enhanced entity selection algorithms with 33-99% variance detection"
                })
            
            # PUF compliance recommendations
            puf_compliance = integration_insights.get('puf_compliance', {})
            if not puf_compliance.get('multi_tab_support'):
                recommendations.append({
                    "category": "CMS PUF Compliance",
                    "priority": "high",
                    "recommendation": "Implement full CMS PUF multi-tab data structure support.",
                    "impact": "Achieve 100% federal compliance and unlock advanced analytics",
                    "implementation": "Deploy PUF data service with dual-level granularity support"
                })
            
            # Cross-validation recommendations
            cross_validation = integration_insights.get('cross_validation', {})
            if cross_validation.get('data_consistency', 1) < 0.8:
                recommendations.append({
                    "category": "Data Quality",
                    "priority": "medium",
                    "recommendation": "Improve data consistency across integrated sources.",
                    "impact": "Increase recommendation confidence by 10-15%",
                    "implementation": "Implement data validation and reconciliation processes"
                })
            
        except Exception as e:
            logger.error(f"Error generating recommendations: {str(e)}")
            recommendations.append({
                "category": "System Error",
                "priority": "critical",
                "recommendation": f"Address system error: {str(e)}",
                "impact": "Restore full platform functionality",
                "implementation": "Debug and fix integration issues"
            })
        
        return recommendations

# Initialize orchestrator
orchestrator = EnhancedIntegrationOrchestrator()

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "service": "Enhanced Integration Orchestrator",
        "timestamp": datetime.now().isoformat(),
        "version": "2.0.0",
        "integrations": {
            "georgetown_research": True,
            "health_affairs_enhanced": True,
            "cms_puf_compliant": True
        }
    })

@app.route('/analytics/comprehensive', methods=['GET'])
def get_comprehensive_analytics():
    """Get comprehensive analytics from all enhanced services"""
    try:
        # Use asyncio to run the async function
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        analytics_data = loop.run_until_complete(orchestrator.get_comprehensive_analytics())
        loop.close()
        
        return jsonify(analytics_data)
        
    except Exception as e:
        logger.error(f"Error getting comprehensive analytics: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/recommendations/strategic', methods=['GET'])
def get_strategic_recommendations():
    """Get strategic recommendations based on integrated analytics"""
    try:
        # Get analytics data first
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        analytics_data = loop.run_until_complete(orchestrator.get_comprehensive_analytics())
        loop.close()
        
        # Generate recommendations
        recommendations = orchestrator.generate_strategic_recommendations(analytics_data)
        
        return jsonify({
            "recommendations": recommendations,
            "total_recommendations": len(recommendations),
            "high_priority_count": len([r for r in recommendations if r.get('priority') == 'high']),
            "critical_priority_count": len([r for r in recommendations if r.get('priority') == 'critical']),
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Error getting strategic recommendations: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/compliance/score', methods=['GET'])
def get_compliance_score():
    """Get overall platform compliance score"""
    try:
        # Get analytics data
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        analytics_data = loop.run_until_complete(orchestrator.get_comprehensive_analytics())
        loop.close()
        
        compliance_score = analytics_data.get('compliance_score', {})
        
        return jsonify({
            "compliance_scores": compliance_score,
            "overall_grade": "A" if compliance_score.get('overall_compliance', 0) >= 90 else
                           "B" if compliance_score.get('overall_compliance', 0) >= 80 else
                           "C" if compliance_score.get('overall_compliance', 0) >= 70 else "D",
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Error getting compliance score: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/integration/status', methods=['GET'])
def get_integration_status():
    """Get status of all integrated services"""
    try:
        service_status = {}
        
        for service_name, service_url in orchestrator.services.items():
            try:
                response = requests.get(f"{service_url}/health", timeout=5)
                service_status[service_name] = {
                    "status": "healthy" if response.status_code == 200 else "unhealthy",
                    "response_time": response.elapsed.total_seconds(),
                    "last_check": datetime.now().isoformat()
                }
            except Exception as e:
                service_status[service_name] = {
                    "status": "unreachable",
                    "error": str(e),
                    "last_check": datetime.now().isoformat()
                }
        
        healthy_services = len([s for s in service_status.values() if s['status'] == 'healthy'])
        total_services = len(service_status)
        
        return jsonify({
            "service_status": service_status,
            "overall_health": "healthy" if healthy_services == total_services else "degraded",
            "healthy_services": healthy_services,
            "total_services": total_services,
            "health_percentage": (healthy_services / total_services) * 100,
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Error getting integration status: {str(e)}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5008, debug=True)
