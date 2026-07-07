"""
Enhanced IDR Entity Selection Service with Health Affairs Bias Detection
Georgetown-Enhanced NSA/IDR Healthcare Claims Platform

Based on Health Affairs research showing 33-99% variance in entity decision patterns
"""

from flask import Flask, request, jsonify
from datetime import datetime, timedelta
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, GradientBoostingRegressor
from sklearn.preprocessing import StandardScaler
import logging
import json
from typing import Dict, List, Optional, Tuple
import sqlite3

# ── Shared HealthPoint infrastructure ─────────────────────────────────────────
import sys, os as _os
_repo_root = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)
from backend.shared.database import fetch, fetchrow, execute, fetchval, transaction, bootstrap_schema, get_pool
from backend.shared.cache import get_client as get_redis_client, rate_limit_check, set_json, get_json
from backend.shared.auth import get_current_user, require_role, require_admin, require_provider, security_headers_middleware
from backend.shared.messaging import publish, Topics
# ─────────────────────────────────────────────────────────────────────────────

import os
from shared.telemetry import setup_telemetry, instrument_fastapi, get_tracer

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class HealthAffairsEnhancedEntitySelector:
    """
    Advanced IDR Entity Selection with Health Affairs bias detection insights
    
    Key Findings Integrated:
    - Entity win rates vary from 33% to 99% (80-point variance)
    - Volume-outcome correlation exists
    - Decision times vary from 31-195 days
    - Private equity organizations show specific patterns
    """
    
    def __init__(self):
        self.bias_detector = ArbitratorBiasDetector()
        self.qpa_predictor = QPAMultiplierPredictor()
        self.pe_analyzer = PrivateEquityAnalyzer()
        self.geographic_analyzer = GeographicConcentrationAnalyzer()
        self.entity_performance_db = self._initialize_entity_database()
        
    def _initialize_entity_database(self):
        """Initialize entity performance database with Health Affairs patterns"""
        conn = sqlite3.connect(':memory:')
        cursor = conn.cursor()
        
        # Create entity performance table
        cursor.execute('''
            CREATE TABLE entity_performance (
                entity_id TEXT PRIMARY KEY,
                entity_name TEXT,
                provider_win_rate REAL,
                avg_decision_days INTEGER,
                case_volume INTEGER,
                avg_qpa_multiplier REAL,
                bias_score REAL,
                last_updated TIMESTAMP
            )
        ''')
        
        # Insert Health Affairs-based entity data
        entities = [
            ('entity_1', 'Healthcare Resolution LLC', 0.94, 28, 1234, 3.2, 0.15),
            ('entity_2', 'Medical Arbitration Services', 0.89, 32, 987, 3.5, 0.25),
            ('entity_3', 'Independent Health Decisions', 0.33, 25, 156, 2.1, 0.85),  # High bias
            ('entity_4', 'Dispute Resolution Partners', 0.99, 45, 2341, 4.2, 0.95),  # Extreme bias
            ('entity_5', 'Healthcare Mediation Group', 0.91, 27, 1123, 3.8, 0.20),
            ('entity_6', 'Federal Hearings Appeals', 0.87, 31, 876, 3.1, 0.30),
            ('entity_7', 'MCMC Services LLC', 0.76, 52, 654, 2.8, 0.45),
            ('entity_8', 'Arbitration Forums Inc', 0.82, 38, 789, 3.3, 0.35),
            ('entity_9', 'Resolution Partners Group', 0.95, 41, 1567, 4.1, 0.18),
            ('entity_10', 'Independent Medical Review', 0.68, 29, 432, 2.6, 0.55)
        ]
        
        for entity in entities:
            cursor.execute('''
                INSERT INTO entity_performance 
                (entity_id, entity_name, provider_win_rate, avg_decision_days, 
                 case_volume, avg_qpa_multiplier, bias_score, last_updated)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (*entity, datetime.now()))
        
        conn.commit()
        return conn
    
    def select_optimal_entity(self, case_details: Dict) -> Dict:
        """
        Select optimal IDR entity based on Health Affairs bias analysis
        
        Args:
            case_details: Dictionary containing case information
            
        Returns:
            Dictionary with entity recommendation and analysis
        """
        try:
            # Analyze case characteristics
            specialty = case_details.get('specialty', 'general')
            provider_org = case_details.get('provider_organization', '')
            state = case_details.get('state', '')
            case_value = case_details.get('case_value', 0)
            urgency = case_details.get('urgency', 'normal')
            
            # Get entity performance data
            entities = self._get_entity_performance_data()
            
            # Apply Health Affairs bias detection
            entity_scores = []
            for entity in entities:
                bias_analysis = self.bias_detector.analyze_entity_bias(entity)
                qpa_prediction = self.qpa_predictor.predict_multiplier(entity, specialty)
                pe_analysis = self.pe_analyzer.analyze_organization_pattern(provider_org)
                geo_analysis = self.geographic_analyzer.analyze_state_factors(state)
                
                # Calculate composite score
                composite_score = self._calculate_composite_score(
                    entity, bias_analysis, qpa_prediction, pe_analysis, geo_analysis, urgency
                )
                
                entity_scores.append({
                    'entity_id': entity['entity_id'],
                    'entity_name': entity['entity_name'],
                    'composite_score': composite_score,
                    'bias_analysis': bias_analysis,
                    'qpa_prediction': qpa_prediction,
                    'expected_outcome': self._predict_case_outcome(entity, case_details)
                })
            
            # Sort by composite score (higher is better)
            entity_scores.sort(key=lambda x: x['composite_score'], reverse=True)
            
            # Select top 3 recommendations
            recommendations = entity_scores[:3]
            
            return {
                'status': 'success',
                'primary_recommendation': recommendations[0],
                'alternative_options': recommendations[1:3],
                'bias_warning': self._generate_bias_warning(recommendations[0]),
                'health_affairs_insights': self._generate_health_affairs_insights(case_details),
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Entity selection error: {str(e)}")
            return {
                'status': 'error',
                'message': f"Entity selection failed: {str(e)}",
                'timestamp': datetime.now().isoformat()
            }
    
    def _get_entity_performance_data(self) -> List[Dict]:
        """Retrieve entity performance data from database"""
        cursor = self.entity_performance_db.cursor()
        cursor.execute('SELECT * FROM entity_performance')
        columns = [description[0] for description in cursor.description]
        rows = cursor.fetchall()
        
        return [dict(zip(columns, row)) for row in rows]
    
    def _calculate_composite_score(self, entity: Dict, bias_analysis: Dict, 
                                 qpa_prediction: Dict, pe_analysis: Dict, 
                                 geo_analysis: Dict, urgency: str) -> float:
        """Calculate composite entity selection score"""
        
        # Base score from provider win rate (Health Affairs: 33-99% range)
        win_rate_score = entity['provider_win_rate'] * 100
        
        # Bias penalty (Health Affairs: significant entity variation)
        bias_penalty = bias_analysis['bias_score'] * 50
        
        # QPA multiplier bonus (Health Affairs: 3.2-3.5x median)
        qpa_bonus = min(qpa_prediction['expected_multiplier'] * 10, 50)
        
        # Volume reliability bonus (Health Affairs: volume-outcome correlation)
        volume_bonus = min(np.log(entity['case_volume']) * 5, 25)
        
        # Decision time factor (Health Affairs: 31-195 days range)
        if urgency == 'urgent':
            time_factor = max(0, 50 - entity['avg_decision_days'])
        else:
            time_factor = 10  # Neutral for normal cases
        
        # Private equity organization factor
        pe_factor = pe_analysis.get('strategic_bonus', 0)
        
        # Geographic factor
        geo_factor = geo_analysis.get('state_bonus', 0)
        
        composite_score = (
            win_rate_score - bias_penalty + qpa_bonus + 
            volume_bonus + time_factor + pe_factor + geo_factor
        )
        
        return max(0, min(100, composite_score))  # Normalize to 0-100
    
    def _predict_case_outcome(self, entity: Dict, case_details: Dict) -> Dict:
        """Predict case outcome based on Health Affairs patterns"""
        
        specialty = case_details.get('specialty', 'general')
        provider_org = case_details.get('provider_organization', '')
        
        # Base prediction from entity performance
        base_win_probability = entity['provider_win_rate']
        
        # Specialty adjustments (Health Affairs: specialty-specific patterns)
        specialty_adjustments = {
            'radiology': 0.15,      # Higher win rates for radiology
            'surgery': 0.12,        # Higher win rates for surgery
            'neurology': 0.10,      # Higher win rates for neurology
            'emergency': 0.08,      # Moderate increase
            'anesthesiology': 0.05, # Slight increase
            'general': 0.0          # No adjustment
        }
        
        adjusted_win_probability = min(0.99, base_win_probability + 
                                     specialty_adjustments.get(specialty, 0))
        
        # QPA multiplier prediction (Health Affairs: 3.2-3.5x median)
        base_multiplier = entity['avg_qpa_multiplier']
        
        # Specialty-specific QPA multipliers (Health Affairs data)
        specialty_multipliers = {
            'radiology': 5.0,       # 500% QPA median
            'surgery': 8.0,         # 800% QPA median
            'neurology': 8.0,       # 800% QPA median
            'emergency': 3.5,       # Standard median
            'anesthesiology': 3.2,  # Lower end
            'general': 3.0          # Conservative
        }
        
        expected_multiplier = specialty_multipliers.get(specialty, base_multiplier)
        
        # Private equity bonus (Health Affairs: PE orgs win >90%)
        pe_organizations = ['Team Health', 'SCP Health', 'Radiology Partners', 'Envision']
        if any(pe_org in provider_org for pe_org in pe_organizations):
            adjusted_win_probability = min(0.95, adjusted_win_probability + 0.10)
            expected_multiplier *= 1.2  # Higher payments for PE orgs
        
        return {
            'win_probability': round(adjusted_win_probability, 3),
            'expected_qpa_multiplier': round(expected_multiplier, 2),
            'expected_decision_days': entity['avg_decision_days'],
            'confidence_level': 'high' if entity['case_volume'] > 500 else 'medium'
        }
    
    def _generate_bias_warning(self, recommendation: Dict) -> Optional[str]:
        """Generate bias warning based on Health Affairs findings"""
        bias_score = recommendation['bias_analysis']['bias_score']
        
        if bias_score > 0.7:
            return (
                "HIGH BIAS WARNING: This entity shows significant decision pattern "
                "variance (>70% bias score). Consider alternative entities."
            )
        elif bias_score > 0.5:
            return (
                "MODERATE BIAS WARNING: This entity shows some decision pattern "
                "inconsistency. Monitor case closely."
            )
        
        return None
    
    def _generate_health_affairs_insights(self, case_details: Dict) -> Dict:
        """Generate insights based on Health Affairs research"""
        specialty = case_details.get('specialty', 'general')
        state = case_details.get('state', '')
        provider_org = case_details.get('provider_organization', '')
        
        insights = {
            'entity_variance_note': (
                "Health Affairs research shows IDR entities vary significantly "
                "in decision patterns (33-99% provider win rates)."
            ),
            'specialty_insights': {},
            'geographic_insights': {},
            'organization_insights': {}
        }
        
        # Specialty-specific insights
        if specialty == 'radiology':
            insights['specialty_insights'] = {
                'win_rate_expectation': 'High (radiology providers especially successful)',
                'payment_expectation': '500%+ of QPA median',
                'strategic_note': 'Radiology cases show consistently high success rates'
            }
        elif specialty in ['surgery', 'neurology']:
            insights['specialty_insights'] = {
                'win_rate_expectation': 'Very High',
                'payment_expectation': '800%+ of QPA median',
                'strategic_note': 'Surgery and neurology show highest payment multiples'
            }
        
        # Geographic insights
        high_volume_states = ['TX', 'FL', 'TN', 'GA']
        if state in high_volume_states:
            insights['geographic_insights'] = {
                'volume_category': 'High-volume state',
                'market_dynamics': 'Significant IDR activity in this state',
                'strategic_note': '50% of all IDR cases come from TX, FL, TN, GA'
            }
        
        # Organization insights
        pe_organizations = ['Team Health', 'SCP Health', 'Radiology Partners', 'Envision']
        if any(pe_org in provider_org for pe_org in pe_organizations):
            insights['organization_insights'] = {
                'organization_type': 'Private equity-backed',
                'success_rate': '>90% win rate expected',
                'volume_impact': 'Part of 70% of all IDR cases',
                'strategic_note': 'PE-backed organizations show superior IDR performance'
            }
        
        return insights


class ArbitratorBiasDetector:
    """Detect arbitrator bias based on Health Affairs 80-point variance finding"""
    
    def analyze_entity_bias(self, entity: Dict) -> Dict:
        """Analyze entity for bias indicators"""
        
        win_rate = entity['provider_win_rate']
        case_volume = entity['case_volume']
        
        # Calculate bias score based on deviation from expected 50% neutral rate
        neutral_rate = 0.5
        deviation = abs(win_rate - neutral_rate)
        
        # Health Affairs shows 33-99% range (66-point spread from neutral)
        max_deviation = 0.49  # Maximum possible deviation from 50%
        bias_score = deviation / max_deviation
        
        # Volume correlation factor (Health Affairs finding)
        volume_factor = 1.0
        if case_volume > 1000 and win_rate > 0.9:
            volume_factor = 1.2  # Higher bias concern for high-volume, high-win entities
        elif case_volume < 200 and win_rate < 0.4:
            volume_factor = 1.3  # Higher bias concern for low-volume, low-win entities
        
        final_bias_score = min(1.0, bias_score * volume_factor)
        
        return {
            'bias_score': round(final_bias_score, 3),
            'bias_level': self._categorize_bias_level(final_bias_score),
            'volume_correlation': case_volume > 1000 and win_rate > 0.9,
            'recommendation': self._generate_bias_recommendation(final_bias_score)
        }
    
    def _categorize_bias_level(self, bias_score: float) -> str:
        """Categorize bias level"""
        if bias_score > 0.7:
            return 'HIGH'
        elif bias_score > 0.4:
            return 'MODERATE'
        elif bias_score > 0.2:
            return 'LOW'
        else:
            return 'MINIMAL'
    
    def _generate_bias_recommendation(self, bias_score: float) -> str:
        """Generate bias-based recommendation"""
        if bias_score > 0.7:
            return "AVOID: High bias risk detected"
        elif bias_score > 0.4:
            return "CAUTION: Monitor case closely"
        else:
            return "ACCEPTABLE: Low bias risk"


class QPAMultiplierPredictor:
    """Predict QPA multipliers based on Health Affairs payment data"""
    
    def predict_multiplier(self, entity: Dict, specialty: str) -> Dict:
        """Predict QPA multiplier based on entity and specialty"""
        
        base_multiplier = entity['avg_qpa_multiplier']
        
        # Health Affairs specialty-specific multipliers
        specialty_factors = {
            'radiology': 5.0,       # 500% QPA median
            'surgery': 8.0,         # 800% QPA median
            'neurology': 8.0,       # 800% QPA median
            'emergency': 3.5,       # Standard
            'anesthesiology': 3.2,  # Lower end
            'general': 3.0          # Conservative
        }
        
        expected_multiplier = specialty_factors.get(specialty, base_multiplier)
        
        # Calculate probability of extreme cases (Health Affairs: 25% >5x, 9% >10x)
        extreme_5x_probability = 0.25 if specialty in ['radiology', 'surgery', 'neurology'] else 0.15
        extreme_10x_probability = 0.09 if specialty in ['surgery', 'neurology'] else 0.03
        
        return {
            'expected_multiplier': round(expected_multiplier, 2),
            'range_low': round(expected_multiplier * 0.8, 2),
            'range_high': round(expected_multiplier * 1.3, 2),
            'extreme_5x_probability': extreme_5x_probability,
            'extreme_10x_probability': extreme_10x_probability,
            'confidence': 'high' if specialty in specialty_factors else 'medium'
        }


class PrivateEquityAnalyzer:
    """Analyze private equity organization patterns"""
    
    def analyze_organization_pattern(self, provider_org: str) -> Dict:
        """Analyze if organization shows PE patterns"""
        
        # Health Affairs "Big 4" PE organizations
        pe_organizations = {
            'Team Health': {'win_rate': 0.90, 'qpa_multiple': 2.0, 'volume': 'very_high'},
            'SCP Health': {'win_rate': 0.92, 'qpa_multiple': 3.5, 'volume': 'very_high'},
            'Radiology Partners': {'win_rate': 0.95, 'qpa_multiple': 8.0, 'volume': 'high'},
            'Envision': {'win_rate': 0.88, 'qpa_multiple': 3.2, 'volume': 'very_high'}
        }
        
        for pe_org, patterns in pe_organizations.items():
            if pe_org.lower() in provider_org.lower():
                return {
                    'is_pe_backed': True,
                    'organization': pe_org,
                    'expected_performance': patterns,
                    'strategic_bonus': 15,  # Bonus points for PE backing
                    'volume_category': patterns['volume'],
                    'success_probability': patterns['win_rate']
                }
        
        return {
            'is_pe_backed': False,
            'strategic_bonus': 0,
            'volume_category': 'standard',
            'success_probability': 0.75  # Average non-PE performance
        }


class GeographicConcentrationAnalyzer:
    """Analyze geographic concentration patterns"""
    
    def analyze_state_factors(self, state: str) -> Dict:
        """Analyze state-specific factors"""
        
        # Health Affairs high-volume states (50% of cases)
        high_volume_states = {
            'TX': {'volume_share': 0.20, 'pe_presence': 'high', 'bonus': 10},
            'FL': {'volume_share': 0.15, 'pe_presence': 'high', 'bonus': 8},
            'TN': {'volume_share': 0.08, 'pe_presence': 'medium', 'bonus': 5},
            'GA': {'volume_share': 0.07, 'pe_presence': 'medium', 'bonus': 5}
        }
        
        # Low-volume states (<1,500 cases each)
        low_volume_states = ['CT', 'MD', 'MA', 'WA']
        
        if state in high_volume_states:
            state_data = high_volume_states[state]
            return {
                'volume_category': 'high',
                'market_dynamics': 'active_idr_market',
                'pe_presence': state_data['pe_presence'],
                'state_bonus': state_data['bonus'],
                'strategic_note': f"High-volume state with {state_data['volume_share']*100}% of national cases"
            }
        elif state in low_volume_states:
            return {
                'volume_category': 'low',
                'market_dynamics': 'limited_idr_activity',
                'pe_presence': 'low',
                'state_bonus': -5,  # Slight penalty for low-volume states
                'strategic_note': "Low-volume state (<1,500 cases annually)"
            }
        else:
            return {
                'volume_category': 'medium',
                'market_dynamics': 'moderate_idr_activity',
                'pe_presence': 'medium',
                'state_bonus': 0,
                'strategic_note': "Standard IDR activity level"
            }


# Flask API endpoints
@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'Enhanced Entity Selection Service',
        'version': '2.0.0',
        'health_affairs_enhanced': True,
        'timestamp': datetime.now().isoformat()
    })

@app.route('/select-entity', methods=['POST'])
def select_entity():
    """Select optimal IDR entity with Health Affairs bias detection"""
    try:
        case_details = request.json
        
        if not case_details:
            return jsonify({
                'status': 'error',
                'message': 'Case details required'
            }), 400
        
        selector = HealthAffairsEnhancedEntitySelector()
        result = selector.select_optimal_entity(case_details)
        
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"Entity selection error: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': f"Entity selection failed: {str(e)}"
        }), 500

@app.route('/analyze-bias/<entity_id>', methods=['GET'])
def analyze_entity_bias(entity_id):
    """Analyze specific entity for bias patterns"""
    try:
        selector = HealthAffairsEnhancedEntitySelector()
        entities = selector._get_entity_performance_data()
        
        entity = next((e for e in entities if e['entity_id'] == entity_id), None)
        if not entity:
            return jsonify({
                'status': 'error',
                'message': 'Entity not found'
            }), 404
        
        bias_analysis = selector.bias_detector.analyze_entity_bias(entity)
        
        return jsonify({
            'status': 'success',
            'entity_id': entity_id,
            'entity_name': entity['entity_name'],
            'bias_analysis': bias_analysis,
            'health_affairs_context': {
                'variance_range': '33-99% provider win rates across entities',
                'your_entity_rate': f"{entity['provider_win_rate']*100:.1f}%",
                'bias_interpretation': bias_analysis['recommendation']
            }
        })
        
    except Exception as e:
        logger.error(f"Bias analysis error: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': f"Bias analysis failed: {str(e)}"
        }), 500

@app.route('/predict-qpa/<specialty>', methods=['GET'])
def predict_qpa_multiplier(specialty):
    """Predict QPA multiplier for specialty"""
    try:
        predictor = QPAMultiplierPredictor()
        
        # Use average entity for prediction
        avg_entity = {
            'avg_qpa_multiplier': 3.5,
            'case_volume': 1000
        }
        
        prediction = predictor.predict_multiplier(avg_entity, specialty)
        
        return jsonify({
            'status': 'success',
            'specialty': specialty,
            'qpa_prediction': prediction,
            'health_affairs_context': {
                'general_median': '322-350% of QPA',
                'radiology_median': '500%+ of QPA',
                'surgery_neurology_median': '800%+ of QPA',
                'extreme_cases': '25% of cases >5x QPA, 9% >10x QPA'
            }
        })
        
    except Exception as e:
        logger.error(f"QPA prediction error: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': f"QPA prediction failed: {str(e)}"
        }), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5005, debug=True)
