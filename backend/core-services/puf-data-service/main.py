#!/usr/bin/env python3
"""
CMS Federal IDR PUF Data Service
Enhanced service for processing and analyzing CMS Federal IDR Public Use Files
Supports multi-tab data structure, dual-level granularity, and complex dispute types
"""

from flask import Flask, request, jsonify
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import logging

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
from typing import Dict, List, Any, Optional, Tuple
import sqlite3
from dataclasses import dataclass
from enum import Enum

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

class DisputeType(Enum):
    SINGLE = "Single"
    BATCHED = "Batched"

class DisputeLineItemType(Enum):
    SINGLE = "Single"
    BUNDLED_ITEM = "Bundled Item or Service"
    COMPONENT_ITEM = "Component Item or Service"
    BATCHED = "Batched"

class HealthPlanType(Enum):
    SELF_INSURED = "Self-insured private group health plan"
    FULLY_INSURED = "Fully insured private group health plan"
    INDIVIDUAL = "Individual health insurance issuer"
    FEHB = "Federal Employees Health Benefits (FEHB) Carrier"
    GOVERNMENT = "Non-federal government plan"
    CHURCH = "Church Plan"

@dataclass
class DisputeRecord:
    """Dispute-level data structure"""
    dispute_number: str
    health_plan_name: str
    health_plan_type: str
    health_plan_email_domain: str
    provider_facility_name: str
    provider_facility_npi: str
    provider_email_domain: str
    type_of_dispute: str
    payment_determination_outcome: str
    length_of_determination: int
    default_decision: bool
    idre_compensation: float
    practice_facility_size: Optional[int] = None
    practice_facility_specialty: Optional[str] = None

@dataclass
class DisputeLineItem:
    """Line-item level data structure"""
    dli_number: str
    dispute_number: str
    service_code: str
    type_of_service_code: str
    dispute_line_item_type: str
    item_service_description: str
    location_of_service: str
    place_of_service_code: str
    qpa: float
    provider_offer: float
    health_plan_offer: float
    prevailing_offer: float
    provider_offer_pct_qpa: float
    health_plan_offer_pct_qpa: float
    prevailing_offer_pct_qpa: float
    offer_selected_from: str
    geographical_region: Optional[str] = None
    air_ambulance_vehicle_type: Optional[str] = None
    air_ambulance_clinical_capacity: Optional[str] = None

class PUFDataProcessor:
    """Enhanced PUF data processor supporting CMS data structure"""
    
    def __init__(self):
        self.db_path = "/tmp/puf_data.db"
        self.init_database()
    
    def init_database(self):
        """Initialize SQLite database with proper schema"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Create disputes table (dispute-level data)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS disputes (
                dispute_number TEXT PRIMARY KEY,
                health_plan_name TEXT,
                health_plan_type TEXT,
                health_plan_email_domain TEXT,
                provider_facility_name TEXT,
                provider_facility_npi TEXT,
                provider_email_domain TEXT,
                type_of_dispute TEXT,
                payment_determination_outcome TEXT,
                length_of_determination INTEGER,
                default_decision BOOLEAN,
                idre_compensation REAL,
                practice_facility_size INTEGER,
                practice_facility_specialty TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Create dispute_line_items table (line-item level data)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS dispute_line_items (
                dli_number TEXT PRIMARY KEY,
                dispute_number TEXT,
                service_code TEXT,
                type_of_service_code TEXT,
                dispute_line_item_type TEXT,
                item_service_description TEXT,
                location_of_service TEXT,
                place_of_service_code TEXT,
                qpa REAL,
                provider_offer REAL,
                health_plan_offer REAL,
                prevailing_offer REAL,
                provider_offer_pct_qpa REAL,
                health_plan_offer_pct_qpa REAL,
                prevailing_offer_pct_qpa REAL,
                offer_selected_from TEXT,
                geographical_region TEXT,
                air_ambulance_vehicle_type TEXT,
                air_ambulance_clinical_capacity TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (dispute_number) REFERENCES disputes (dispute_number)
            )
        """)
        
        # Create indexes for performance
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_disputes_health_plan ON disputes(health_plan_name)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_disputes_provider ON disputes(provider_facility_name)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_dli_service_code ON dispute_line_items(service_code)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_dli_location ON dispute_line_items(location_of_service)")
        
        conn.commit()
        conn.close()
    
    def process_puf_file(self, file_path: str, tab_name: str) -> Dict[str, Any]:
        """Process CMS PUF Excel file with multi-tab support"""
        try:
            # Read the specific tab
            df = pd.read_excel(file_path, sheet_name=tab_name)
            
            # Process based on tab type
            if tab_name in ['Tab1', 'Emergency_NonEmergency']:
                return self._process_emergency_non_emergency_tab(df)
            elif tab_name in ['Tab2', 'Air_Ambulance']:
                return self._process_air_ambulance_tab(df)
            elif tab_name in ['Tab3', 'QPA_Offers']:
                return self._process_qpa_offers_tab(df)
            else:
                raise ValueError(f"Unknown tab name: {tab_name}")
                
        except Exception as e:
            logger.error(f"Error processing PUF file {file_path}, tab {tab_name}: {str(e)}")
            return {"error": str(e), "processed_records": 0}
    
    def _process_emergency_non_emergency_tab(self, df: pd.DataFrame) -> Dict[str, Any]:
        """Process Tab 1: Emergency and Non-Emergency Services"""
        processed_disputes = 0
        processed_line_items = 0
        
        conn = sqlite3.connect(self.db_path)
        
        try:
            # Group by dispute number to handle dispute-level vs line-item level data
            for dispute_num, group in df.groupby('Dispute Number'):
                # Process dispute-level data (same for all line items)
                dispute_row = group.iloc[0]  # Take first row for dispute-level data
                
                dispute_data = {
                    'dispute_number': dispute_num,
                    'health_plan_name': dispute_row.get('Health Plan/Issuer Name', ''),
                    'health_plan_type': dispute_row.get('Health Plan Type', ''),
                    'health_plan_email_domain': dispute_row.get('Health Plan/Issuer Email Domain', ''),
                    'provider_facility_name': dispute_row.get('Provider/Facility Name', ''),
                    'provider_facility_npi': dispute_row.get('Provider/Facility NPI Number', ''),
                    'provider_email_domain': dispute_row.get('Provider Email Domain', ''),
                    'type_of_dispute': dispute_row.get('Type of Dispute', ''),
                    'payment_determination_outcome': dispute_row.get('Payment Determination Outcome', ''),
                    'length_of_determination': dispute_row.get('Length of Time to Make Determination', 0),
                    'default_decision': dispute_row.get('Default Decision', False),
                    'idre_compensation': dispute_row.get('IDRE Compensation', 0.0),
                    'practice_facility_size': dispute_row.get('Practice/Facility Size', None),
                    'practice_facility_specialty': dispute_row.get('Practice/Facility Specialty or Type', '')
                }
                
                # Insert dispute record
                self._insert_dispute(conn, dispute_data)
                processed_disputes += 1
                
                # Process line-item level data
                for _, row in group.iterrows():
                    line_item_data = {
                        'dli_number': row.get('DLI Number', ''),
                        'dispute_number': dispute_num,
                        'service_code': row.get('Service Code', ''),
                        'type_of_service_code': row.get('Type of Service Code', ''),
                        'dispute_line_item_type': row.get('Dispute Line Item Type', ''),
                        'item_service_description': row.get('Item or Service Description', ''),
                        'location_of_service': row.get('Location of Service', ''),
                        'place_of_service_code': row.get('Place of Service Code', ''),
                        'qpa': row.get('QPA', 0.0),
                        'provider_offer': 0.0,  # Not available in Tab 1
                        'health_plan_offer': 0.0,  # Not available in Tab 1
                        'prevailing_offer': 0.0,  # Not available in Tab 1
                        'provider_offer_pct_qpa': row.get('Provider/Facility Offer as % of QPA', 0.0),
                        'health_plan_offer_pct_qpa': row.get('Health Plan/Issuer Offer as % of QPA', 0.0),
                        'prevailing_offer_pct_qpa': row.get('Prevailing Party Offer as % of QPA', 0.0),
                        'offer_selected_from': row.get('Offer Selected from Provider or Issuer', ''),
                        'geographical_region': None,  # Not available in Tab 1
                        'air_ambulance_vehicle_type': None,
                        'air_ambulance_clinical_capacity': None
                    }
                    
                    self._insert_line_item(conn, line_item_data)
                    processed_line_items += 1
            
            conn.commit()
            
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            conn.close()
        
        return {
            "tab": "Emergency_NonEmergency",
            "processed_disputes": processed_disputes,
            "processed_line_items": processed_line_items,
            "status": "success"
        }
    
    def _process_air_ambulance_tab(self, df: pd.DataFrame) -> Dict[str, Any]:
        """Process Tab 2: Air Ambulance Services"""
        # Similar structure to Tab 1 but with air ambulance specific fields
        processed_disputes = 0
        processed_line_items = 0
        
        conn = sqlite3.connect(self.db_path)
        
        try:
            for dispute_num, group in df.groupby('Dispute Number'):
                dispute_row = group.iloc[0]
                
                # Process dispute-level data (no practice/facility size for air ambulance)
                dispute_data = {
                    'dispute_number': dispute_num,
                    'health_plan_name': dispute_row.get('Health Plan/Issuer Name', ''),
                    'health_plan_type': dispute_row.get('Health Plan Type', ''),
                    'health_plan_email_domain': dispute_row.get('Health Plan/Issuer Email Domain', ''),
                    'provider_facility_name': dispute_row.get('Provider/Facility Name', ''),
                    'provider_facility_npi': dispute_row.get('Provider/Facility NPI Number', ''),
                    'provider_email_domain': dispute_row.get('Provider Email Domain', ''),
                    'type_of_dispute': dispute_row.get('Type of Dispute', ''),
                    'payment_determination_outcome': dispute_row.get('Payment Determination Outcome', ''),
                    'length_of_determination': dispute_row.get('Length of Time to Make Determination', 0),
                    'default_decision': dispute_row.get('Default Decision', False),
                    'idre_compensation': dispute_row.get('IDRE Compensation', 0.0),
                    'practice_facility_size': None,  # Not applicable for air ambulance
                    'practice_facility_specialty': None
                }
                
                self._insert_dispute(conn, dispute_data)
                processed_disputes += 1
                
                # Process line-item level data with air ambulance specific fields
                for _, row in group.iterrows():
                    line_item_data = {
                        'dli_number': row.get('DLI Number', ''),
                        'dispute_number': dispute_num,
                        'service_code': row.get('Service Code', ''),
                        'type_of_service_code': row.get('Type of Service Code', ''),
                        'dispute_line_item_type': row.get('Dispute Line Item Type', ''),
                        'item_service_description': row.get('Item or Service Description', ''),
                        'location_of_service': row.get('Location of Service', ''),
                        'place_of_service_code': row.get('Place of Service Code', ''),
                        'qpa': row.get('QPA', 0.0),
                        'provider_offer': 0.0,
                        'health_plan_offer': 0.0,
                        'prevailing_offer': 0.0,
                        'provider_offer_pct_qpa': row.get('Provider/Facility Offer as % of QPA', 0.0),
                        'health_plan_offer_pct_qpa': row.get('Health Plan/Issuer Offer as % of QPA', 0.0),
                        'prevailing_offer_pct_qpa': row.get('Prevailing Party Offer as % of QPA', 0.0),
                        'offer_selected_from': row.get('Offer Selected from Provider or Issuer', ''),
                        'geographical_region': None,
                        'air_ambulance_vehicle_type': row.get('Air Ambulance Vehicle Type', ''),
                        'air_ambulance_clinical_capacity': row.get('Air Ambulance Vehicle Clinical Capacity Level', '')
                    }
                    
                    self._insert_line_item(conn, line_item_data)
                    processed_line_items += 1
            
            conn.commit()
            
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            conn.close()
        
        return {
            "tab": "Air_Ambulance",
            "processed_disputes": processed_disputes,
            "processed_line_items": processed_line_items,
            "status": "success"
        }
    
    def _process_qpa_offers_tab(self, df: pd.DataFrame) -> Dict[str, Any]:
        """Process Tab 3: QPA and Offers Data"""
        processed_line_items = 0
        
        conn = sqlite3.connect(self.db_path)
        
        try:
            # Tab 3 only contains line-item level data with actual offer amounts
            for _, row in df.iterrows():
                # Update existing line items with offer data
                update_data = {
                    'provider_offer': row.get('Provider/Facility Offer', 0.0),
                    'health_plan_offer': row.get('Health Plan/Issuer Offer', 0.0),
                    'prevailing_offer': row.get('Prevailing Offer', 0.0),
                    'geographical_region': row.get('Geographical Region', ''),
                    'qpa': row.get('QPA', 0.0)
                }
                
                # Update line item if it exists
                service_code = row.get('Service Code', '')
                if service_code:
                    cursor = conn.cursor()
                    cursor.execute("""
                        UPDATE dispute_line_items 
                        SET provider_offer = ?, health_plan_offer = ?, 
                            prevailing_offer = ?, geographical_region = ?, qpa = ?
                        WHERE service_code = ?
                    """, (
                        update_data['provider_offer'],
                        update_data['health_plan_offer'],
                        update_data['prevailing_offer'],
                        update_data['geographical_region'],
                        update_data['qpa'],
                        service_code
                    ))
                    processed_line_items += 1
            
            conn.commit()
            
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            conn.close()
        
        return {
            "tab": "QPA_Offers",
            "processed_line_items": processed_line_items,
            "status": "success"
        }
    
    def _insert_dispute(self, conn: sqlite3.Connection, data: Dict[str, Any]):
        """Insert dispute record into database"""
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO disputes 
            (dispute_number, health_plan_name, health_plan_type, health_plan_email_domain,
             provider_facility_name, provider_facility_npi, provider_email_domain,
             type_of_dispute, payment_determination_outcome, length_of_determination,
             default_decision, idre_compensation, practice_facility_size, practice_facility_specialty)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            data['dispute_number'], data['health_plan_name'], data['health_plan_type'],
            data['health_plan_email_domain'], data['provider_facility_name'],
            data['provider_facility_npi'], data['provider_email_domain'],
            data['type_of_dispute'], data['payment_determination_outcome'],
            data['length_of_determination'], data['default_decision'],
            data['idre_compensation'], data['practice_facility_size'],
            data['practice_facility_specialty']
        ))
    
    def _insert_line_item(self, conn: sqlite3.Connection, data: Dict[str, Any]):
        """Insert line item record into database"""
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO dispute_line_items 
            (dli_number, dispute_number, service_code, type_of_service_code,
             dispute_line_item_type, item_service_description, location_of_service,
             place_of_service_code, qpa, provider_offer, health_plan_offer,
             prevailing_offer, provider_offer_pct_qpa, health_plan_offer_pct_qpa,
             prevailing_offer_pct_qpa, offer_selected_from, geographical_region,
             air_ambulance_vehicle_type, air_ambulance_clinical_capacity)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            data['dli_number'], data['dispute_number'], data['service_code'],
            data['type_of_service_code'], data['dispute_line_item_type'],
            data['item_service_description'], data['location_of_service'],
            data['place_of_service_code'], data['qpa'], data['provider_offer'],
            data['health_plan_offer'], data['prevailing_offer'],
            data['provider_offer_pct_qpa'], data['health_plan_offer_pct_qpa'],
            data['prevailing_offer_pct_qpa'], data['offer_selected_from'],
            data['geographical_region'], data['air_ambulance_vehicle_type'],
            data['air_ambulance_clinical_capacity']
        ))

# Initialize processor
puf_processor = PUFDataProcessor()

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "service": "CMS Federal IDR PUF Data Service",
        "timestamp": datetime.now().isoformat(),
        "version": "1.0.0"
    })

@app.route('/puf/upload', methods=['POST'])
def upload_puf_file():
    """Upload and process CMS PUF file"""
    try:
        if 'file' not in request.files:
            return jsonify({"error": "No file provided"}), 400
        
        file = request.files['file']
        tab_name = request.form.get('tab_name', 'Tab1')
        
        if file.filename == '':
            return jsonify({"error": "No file selected"}), 400
        
        # Save uploaded file temporarily
        temp_path = f"/tmp/{file.filename}"
        file.save(temp_path)
        
        # Process the file
        result = puf_processor.process_puf_file(temp_path, tab_name)
        
        # Clean up
        os.remove(temp_path)
        
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"Error uploading PUF file: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/puf/analytics/dispute-types', methods=['GET'])
def get_dispute_type_analytics():
    """Get analytics on dispute types and outcomes"""
    try:
        conn = sqlite3.connect(puf_processor.db_path)
        
        # Dispute type distribution
        dispute_types = pd.read_sql_query("""
            SELECT type_of_dispute, COUNT(*) as count,
                   AVG(length_of_determination) as avg_resolution_days,
                   AVG(idre_compensation) as avg_compensation
            FROM disputes 
            GROUP BY type_of_dispute
        """, conn)
        
        # Payment determination outcomes
        outcomes = pd.read_sql_query("""
            SELECT payment_determination_outcome, COUNT(*) as count,
                   AVG(length_of_determination) as avg_resolution_days
            FROM disputes 
            GROUP BY payment_determination_outcome
        """, conn)
        
        # Line item type distribution
        line_item_types = pd.read_sql_query("""
            SELECT dispute_line_item_type, COUNT(*) as count,
                   AVG(prevailing_offer_pct_qpa) as avg_prevailing_pct_qpa
            FROM dispute_line_items 
            WHERE dispute_line_item_type IS NOT NULL
            GROUP BY dispute_line_item_type
        """, conn)
        
        conn.close()
        
        return jsonify({
            "dispute_types": dispute_types.to_dict('records'),
            "outcomes": outcomes.to_dict('records'),
            "line_item_types": line_item_types.to_dict('records'),
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Error getting dispute type analytics: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/puf/analytics/geographic', methods=['GET'])
def get_geographic_analytics():
    """Get geographic analytics from PUF data"""
    try:
        conn = sqlite3.connect(puf_processor.db_path)
        
        # State-level analysis
        state_analysis = pd.read_sql_query("""
            SELECT location_of_service as state, 
                   COUNT(*) as total_line_items,
                   AVG(prevailing_offer_pct_qpa) as avg_prevailing_pct_qpa,
                   COUNT(DISTINCT dispute_number) as total_disputes
            FROM dispute_line_items 
            WHERE location_of_service IS NOT NULL
            GROUP BY location_of_service
            ORDER BY total_line_items DESC
        """, conn)
        
        # MSA analysis (where available)
        msa_analysis = pd.read_sql_query("""
            SELECT geographical_region, 
                   COUNT(*) as total_line_items,
                   AVG(qpa) as avg_qpa,
                   AVG(prevailing_offer) as avg_prevailing_offer
            FROM dispute_line_items 
            WHERE geographical_region IS NOT NULL
            GROUP BY geographical_region
            ORDER BY total_line_items DESC
            LIMIT 20
        """, conn)
        
        conn.close()
        
        return jsonify({
            "state_analysis": state_analysis.to_dict('records'),
            "msa_analysis": msa_analysis.to_dict('records'),
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Error getting geographic analytics: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/puf/analytics/financial', methods=['GET'])
def get_financial_analytics():
    """Get financial analytics from PUF data"""
    try:
        conn = sqlite3.connect(puf_processor.db_path)
        
        # QPA vs Offers analysis
        financial_summary = pd.read_sql_query("""
            SELECT 
                COUNT(*) as total_line_items,
                AVG(qpa) as avg_qpa,
                AVG(provider_offer) as avg_provider_offer,
                AVG(health_plan_offer) as avg_health_plan_offer,
                AVG(prevailing_offer) as avg_prevailing_offer,
                AVG(provider_offer_pct_qpa) as avg_provider_pct_qpa,
                AVG(health_plan_offer_pct_qpa) as avg_health_plan_pct_qpa,
                AVG(prevailing_offer_pct_qpa) as avg_prevailing_pct_qpa
            FROM dispute_line_items 
            WHERE qpa > 0
        """, conn)
        
        # Service code analysis
        service_code_analysis = pd.read_sql_query("""
            SELECT service_code, type_of_service_code,
                   COUNT(*) as frequency,
                   AVG(prevailing_offer_pct_qpa) as avg_prevailing_pct_qpa,
                   AVG(qpa) as avg_qpa
            FROM dispute_line_items 
            WHERE service_code IS NOT NULL
            GROUP BY service_code, type_of_service_code
            ORDER BY frequency DESC
            LIMIT 50
        """, conn)
        
        conn.close()
        
        return jsonify({
            "financial_summary": financial_summary.to_dict('records')[0],
            "service_code_analysis": service_code_analysis.to_dict('records'),
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Error getting financial analytics: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/puf/data/disputes', methods=['GET'])
def get_disputes():
    """Get dispute records with pagination"""
    try:
        page = int(request.args.get('page', 1))
        per_page = int(request.args.get('per_page', 50))
        offset = (page - 1) * per_page
        
        conn = sqlite3.connect(puf_processor.db_path)
        
        disputes = pd.read_sql_query("""
            SELECT * FROM disputes 
            ORDER BY dispute_number
            LIMIT ? OFFSET ?
        """, conn, params=[per_page, offset])
        
        total_count = pd.read_sql_query("SELECT COUNT(*) as count FROM disputes", conn)
        
        conn.close()
        
        return jsonify({
            "disputes": disputes.to_dict('records'),
            "pagination": {
                "page": page,
                "per_page": per_page,
                "total": total_count.iloc[0]['count']
            },
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Error getting disputes: {str(e)}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5007, debug=True)
