#!/usr/bin/env python3
"""
Healthcare Claims Platform - Training Data Collection System
Comprehensive system for collecting, generating, and preparing training data for AI/ML/DL models.

Author: Manus AI
Date: October 7, 2025
"""

import pandas as pd
import numpy as np
import asyncio
import asyncpg
import aiohttp
import json
import os
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Tuple
import uuid
import random
from faker import Faker
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.model_selection import train_test_split
import logging
import zipfile
import requests
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Faker for synthetic data generation
fake = Faker()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://claimuser:password@localhost/healthcare_platform")

class TrainingDataCollector:
    """Comprehensive training data collection system"""
    
    def __init__(self, data_dir: str = "/tmp/training_data"):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        
        # Healthcare-specific data generators
        self.diagnosis_codes = self._load_diagnosis_codes()
        self.procedure_codes = self._load_procedure_codes()
        self.provider_specialties = self._load_provider_specialties()
        self.fraud_patterns = self._load_fraud_patterns()
        
    def _load_diagnosis_codes(self) -> List[str]:
        """Load ICD-10 diagnosis codes"""
        # Common ICD-10 codes for healthcare claims
        return [
            "Z00.00", "Z00.01", "Z00.121", "Z00.129", "Z00.2", "Z00.3",
            "I10", "I25.10", "I25.119", "I48.91", "I50.9",
            "E11.9", "E11.65", "E11.40", "E11.69", "E78.5",
            "M79.3", "M25.511", "M25.512", "M54.5", "M17.11",
            "J44.1", "J45.9", "J06.9", "J02.9", "J20.9",
            "N39.0", "N18.6", "N40.1", "N95.1", "N76.0",
            "F32.9", "F41.9", "F43.10", "F06.30", "F17.210",
            "K21.9", "K59.00", "K92.2", "K76.0", "K80.20",
            "R06.02", "R50.9", "R10.9", "R53.83", "R42"
        ]
    
    def _load_procedure_codes(self) -> List[str]:
        """Load CPT procedure codes"""
        # Common CPT codes for healthcare procedures
        return [
            "99213", "99214", "99215", "99212", "99211",
            "99203", "99204", "99205", "99202", "99201",
            "99283", "99284", "99285", "99282", "99281",
            "93000", "93005", "93010", "93015", "93017",
            "80053", "80048", "80061", "85025", "85027",
            "36415", "36416", "36400", "36405", "36406",
            "12001", "12002", "12004", "12005", "12011",
            "29125", "29130", "29131", "29405", "29425",
            "45378", "45380", "45385", "43239", "43235",
            "76700", "76705", "76770", "76775", "76830"
        ]
    
    def _load_provider_specialties(self) -> List[str]:
        """Load healthcare provider specialties"""
        return [
            "Internal Medicine", "Family Medicine", "Cardiology", "Orthopedics",
            "Emergency Medicine", "Radiology", "Anesthesiology", "Pathology",
            "Dermatology", "Psychiatry", "Neurology", "Oncology",
            "Gastroenterology", "Endocrinology", "Pulmonology", "Nephrology",
            "Rheumatology", "Infectious Disease", "Hematology", "Urology"
        ]
    
    def _load_fraud_patterns(self) -> Dict[str, Any]:
        """Load known fraud patterns for synthetic data generation"""
        return {
            "upcoding": {
                "description": "Billing for more expensive procedures than performed",
                "indicators": ["procedure_code_mismatch", "unusual_high_value"]
            },
            "unbundling": {
                "description": "Billing separately for procedures normally billed together",
                "indicators": ["multiple_related_procedures", "same_day_billing"]
            },
            "phantom_billing": {
                "description": "Billing for services never provided",
                "indicators": ["no_patient_contact", "impossible_service_dates"]
            },
            "duplicate_billing": {
                "description": "Billing multiple times for the same service",
                "indicators": ["duplicate_claims", "same_service_multiple_dates"]
            },
            "kickbacks": {
                "description": "Receiving payments for patient referrals",
                "indicators": ["unusual_referral_patterns", "financial_relationships"]
            }
        }
    
    def generate_synthetic_data(self, n_records: int = 100000) -> pd.DataFrame:
        """Generate high-quality synthetic healthcare claims data"""
        logger.info(f"Generating {n_records} synthetic healthcare claims records...")
        
        data = []
        
        for i in range(n_records):
            # Generate base claim data
            claim_id = uuid.uuid4()
            provider_id = f"PRV_{random.randint(100000, 999999)}"
            patient_id = f"PAT_{uuid.uuid4().hex[:8]}"
            
            # Determine if this should be a fraudulent claim
            is_fraud = self._determine_fraud_label()
            
            # Generate claim based on fraud status
            if is_fraud:
                claim_data = self._generate_fraudulent_claim(claim_id, provider_id, patient_id)
            else:
                claim_data = self._generate_legitimate_claim(claim_id, provider_id, patient_id)
            
            data.append(claim_data)
        
        df = pd.DataFrame(data)
        logger.info(f"Generated synthetic dataset with {len(df)} records, {df['is_fraud'].sum()} fraudulent")
        
        return df
    
    def _determine_fraud_label(self) -> bool:
        """Determine fraud label with realistic distribution"""
        # Healthcare fraud rate is typically 3-10% of claims
        return random.random() < 0.08  # 8% fraud rate
    
    def _generate_fraudulent_claim(self, claim_id: uuid.UUID, provider_id: str, patient_id: str) -> Dict[str, Any]:
        """Generate a fraudulent claim with realistic fraud patterns"""
        fraud_type = random.choice(list(self.fraud_patterns.keys()))
        
        base_amount = random.uniform(200, 1500)
        
        if fraud_type == "upcoding":
            # Inflate the claim amount
            claim_amount = base_amount * random.uniform(2.0, 5.0)
            procedure_code = random.choice(["99215", "99205", "99285"])  # High-value codes
        elif fraud_type == "phantom_billing":
            # Normal amount but suspicious patterns
            claim_amount = base_amount
            procedure_code = random.choice(self.procedure_codes)
        elif fraud_type == "duplicate_billing":
            # Multiple similar claims
            claim_amount = base_amount
            procedure_code = random.choice(self.procedure_codes)
        else:
            claim_amount = base_amount * random.uniform(1.5, 3.0)
            procedure_code = random.choice(self.procedure_codes)
        
        return {
            "id": claim_id,
            "claim_number": f"CLAIM-{random.randint(100000, 999999)}",
            "provider_id": provider_id,
            "patient_id": patient_id,
            "tenant_id": f"TENANT-{random.choice(['A', 'B', 'C'])}",
            "total_amount": round(claim_amount, 2),
            "diagnosis_codes": [f"D{random.randint(100, 999)}" for _ in range(random.randint(1, 5))],
            "procedure_codes": [procedure_code],
            "service_date_from": fake.date_between(start_date="-1y", end_date="today"),
            "service_date_to": fake.date_between(start_date="-6m", end_date="today"),
            "submitted_at": fake.date_between(start_date="-3m", end_date="today"),
            "is_fraud": True
        }
    
    def _generate_legitimate_claim(self, claim_id: uuid.UUID, provider_id: str, patient_id: str) -> Dict[str, Any]:
        """Generate a legitimate claim with normal patterns"""
        return {
            "id": claim_id,
            "claim_number": f"CLAIM-{random.randint(100000, 999999)}",
            "provider_id": provider_id,
            "patient_id": patient_id,
            "tenant_id": f"TENANT-{random.choice(['A', 'B', 'C'])}",
            "total_amount": round(random.uniform(50, 1200), 2),
            "diagnosis_codes": [f"D{random.randint(100, 999)}" for _ in range(random.randint(1, 3))],
            "procedure_codes": [random.choice(self.procedure_codes)],
            "service_date_from": fake.date_between(start_date="-1y", end_date="today"),
            "service_date_to": fake.date_between(start_date="-6m", end_date="today"),
            "submitted_at": fake.date_between(start_date="-3m", end_date="today"),
            "is_fraud": False
        }

class DatabaseManager:
    def __init__(self, db_url):
        self.db_url = db_url
        self.pool = None

    async def connect(self):
        """Initialize database connection pool."""
        try:
            self.pool = await asyncpg.create_pool(self.db_url)
            logger.info("Database connection pool established.")
        except Exception as e:
            logger.error(f"Failed to connect to the database: {e}")
            raise

    async def disconnect(self):
        """Close the database connection pool."""
        if self.pool:
            await self.pool.close()
            logger.info("Database connection pool closed.")

    async def create_schema(self):
        """Create the necessary tables for historical claims data."""
        async with self.pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS historical_claims (
                    id UUID PRIMARY KEY,
                    claim_number VARCHAR(255) NOT NULL,
                    provider_id VARCHAR(255) NOT NULL,
                    patient_id VARCHAR(255) NOT NULL,
                    tenant_id VARCHAR(255) NOT NULL,
                    total_amount NUMERIC(10, 2) NOT NULL,
                    diagnosis_codes TEXT[] NOT NULL,
                    procedure_codes TEXT[] NOT NULL,
                    service_date_from TIMESTAMP NOT NULL,
                    service_date_to TIMESTAMP NOT NULL,
                    submitted_at TIMESTAMP NOT NULL,
                    is_fraud BOOLEAN NOT NULL DEFAULT FALSE
                );
            """)
            logger.info('\"historical_claims\" table created or already exists.')

    async def insert_dataframe(self, df: pd.DataFrame, table_name: str):
        """Insert a pandas DataFrame into the specified table."""
        async with self.pool.acquire() as conn:
            for index, row in df.iterrows():
                await conn.execute(f"""
                    INSERT INTO {table_name} (id, claim_number, provider_id, patient_id, tenant_id, total_amount, diagnosis_codes, procedure_codes, service_date_from, service_date_to, submitted_at, is_fraud)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                """, row['id'], row['claim_number'], row['provider_id'], row['patient_id'], row['tenant_id'], row['total_amount'], row['diagnosis_codes'], row['procedure_codes'], row['service_date_from'], row['service_date_to'], row['submitted_at'], row['is_fraud'])
        logger.info(f'\"Inserted {len(df)} records into \"{table_name}\"."')

async def main():
    # Initialize the data collector
    collector = TrainingDataCollector()
    
    # Generate synthetic data
    synthetic_data = collector.generate_synthetic_data(n_records=10000)
    
    # Initialize the database manager
    db_manager = DatabaseManager(DATABASE_URL)
    
    try:
        # Connect to the database
        await db_manager.connect()
        
        # Create the schema
        await db_manager.create_schema()
        
        # Insert the synthetic data into the database
        await db_manager.insert_dataframe(synthetic_data, "historical_claims")
        
    finally:
        # Disconnect from the database
        await db_manager.disconnect()

if __name__ == "__main__":
    asyncio.run(main())

