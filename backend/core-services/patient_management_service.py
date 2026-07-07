"""
Healthcare Claims Platform - Patient Management Service
FHIR-compliant patient management with comprehensive healthcare data support.

Author: Manus AI
Date: October 8, 2025
Port: 8004
"""


# ── Shared HealthPoint infrastructure ─────────────────────────────────────────
import sys, os as _os
_repo_root = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)
from backend.shared.database import fetch, fetchrow, execute, fetchval, transaction, bootstrap_schema, get_pool
from backend.shared.cache import get_client as get_redis_client, rate_limit_check, set_json, get_json
from backend.shared.auth import get_current_user, require_role, require_admin, require_provider, security_headers_middleware, TokenPayload
from backend.shared.messaging import publish, Topics
# ─────────────────────────────────────────────────────────────────────────────

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks, status, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator, EmailStr
from typing import List, Optional, Dict, Any, Union
from datetime import datetime, date, timedelta
from enum import Enum
import uuid
import logging
import asyncio
import asyncpg

import json
import os
from contextlib import asynccontextmanager
import httpx
from decimal import Decimal
import re

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.environ["DATABASE_URL"]
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

class Gender(str, Enum):
    MALE = "male"
    FEMALE = "female"
    OTHER = "other"
    UNKNOWN = "unknown"

class MaritalStatus(str, Enum):
    SINGLE = "single"
    MARRIED = "married"
    DIVORCED = "divorced"
    WIDOWED = "widowed"
    SEPARATED = "separated"
    UNKNOWN = "unknown"

class PatientStatus(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    DECEASED = "deceased"
    SUSPENDED = "suspended"

class ContactType(str, Enum):
    EMERGENCY = "emergency"
    NEXT_OF_KIN = "next_of_kin"
    GUARDIAN = "guardian"
    CAREGIVER = "caregiver"
    EMPLOYER = "employer"

class IdentifierType(str, Enum):
    SSN = "ssn"
    DRIVERS_LICENSE = "drivers_license"
    PASSPORT = "passport"
    MEDICAL_RECORD = "medical_record"
    INSURANCE_MEMBER_ID = "insurance_member_id"
    PATIENT_ID = "patient_id"

class AllergyStatus(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    RESOLVED = "resolved"

class AllergySeverity(str, Enum):
    MILD = "mild"
    MODERATE = "moderate"
    SEVERE = "severe"
    LIFE_THREATENING = "life_threatening"

# Pydantic Models
class Address(BaseModel):
    line1: str
    line2: Optional[str] = None
    city: str
    state: str
    postal_code: str
    country: str = "US"
    type: str = "home"  # home, work, billing, etc.

class ContactInfo(BaseModel):
    phone_primary: Optional[str] = None
    phone_secondary: Optional[str] = None
    email_primary: Optional[EmailStr] = None
    email_secondary: Optional[EmailStr] = None
    preferred_contact_method: str = "phone"

class PatientIdentifier(BaseModel):
    type: IdentifierType
    value: str
    issuer: Optional[str] = None
    is_primary: bool = False

class EmergencyContact(BaseModel):
    name: str
    relationship: str
    contact_type: ContactType
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    address: Optional[Address] = None

class InsuranceInfo(BaseModel):
    insurance_id: str
    plan_name: str
    group_number: Optional[str] = None
    member_id: str
    subscriber_id: Optional[str] = None
    relationship_to_subscriber: str = "self"
    effective_date: date
    termination_date: Optional[date] = None
    copay_amount: Optional[Decimal] = None
    deductible_amount: Optional[Decimal] = None
    is_primary: bool = True

class Allergy(BaseModel):
    id: Optional[str] = None
    allergen: str
    reaction: str
    severity: AllergySeverity
    status: AllergyStatus = AllergyStatus.ACTIVE
    onset_date: Optional[date] = None
    notes: Optional[str] = None

class MedicalCondition(BaseModel):
    id: Optional[str] = None
    condition_code: str  # ICD-10 code
    condition_name: str
    diagnosis_date: Optional[date] = None
    status: str = "active"
    severity: Optional[str] = None
    notes: Optional[str] = None

class Medication(BaseModel):
    id: Optional[str] = None
    medication_name: str
    dosage: str
    frequency: str
    prescribed_by: Optional[str] = None
    prescribed_date: Optional[date] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: str = "active"
    notes: Optional[str] = None

class Patient(BaseModel):
    id: Optional[str] = None
    identifiers: List[PatientIdentifier] = []
    first_name: str
    middle_name: Optional[str] = None
    last_name: str
    date_of_birth: date
    gender: Gender
    marital_status: Optional[MaritalStatus] = None
    ssn: Optional[str] = None
    addresses: List[Address] = []
    contact_info: ContactInfo
    emergency_contacts: List[EmergencyContact] = []
    insurance_info: List[InsuranceInfo] = []
    allergies: List[Allergy] = []
    medical_conditions: List[MedicalCondition] = []
    medications: List[Medication] = []
    primary_care_provider: Optional[str] = None
    preferred_language: str = "en"
    status: PatientStatus = PatientStatus.ACTIVE
    tenant_id: str
    created_by: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

class PatientUpdate(BaseModel):
    first_name: Optional[str] = None
    middle_name: Optional[str] = None
    last_name: Optional[str] = None
    gender: Optional[Gender] = None
    marital_status: Optional[MaritalStatus] = None
    addresses: Optional[List[Address]] = None
    contact_info: Optional[ContactInfo] = None
    emergency_contacts: Optional[List[EmergencyContact]] = None
    insurance_info: Optional[List[InsuranceInfo]] = None
    allergies: Optional[List[Allergy]] = None
    medical_conditions: Optional[List[MedicalCondition]] = None
    medications: Optional[List[Medication]] = None
    primary_care_provider: Optional[str] = None
    preferred_language: Optional[str] = None
    status: Optional[PatientStatus] = None
    updated_by: str

class PatientSearch(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    date_of_birth: Optional[date] = None
    ssn: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    identifier_value: Optional[str] = None
    tenant_id: Optional[str] = None

class VitalSigns(BaseModel):
    patient_id: str
    recorded_at: datetime
    height: Optional[float] = None  # cm
    weight: Optional[float] = None  # kg
    bmi: Optional[float] = None
    blood_pressure_systolic: Optional[int] = None
    blood_pressure_diastolic: Optional[int] = None
    heart_rate: Optional[int] = None  # bpm
    temperature: Optional[float] = None  # celsius
    respiratory_rate: Optional[int] = None  # per minute
    oxygen_saturation: Optional[float] = None  # percentage
    recorded_by: str

# Database Manager
class DatabaseManager:
    def __init__(self):
        self.pool = None

    async def connect(self):
        self.pool = await asyncpg.create_pool(DATABASE_URL)
        await self._create_tables()

    async def disconnect(self):
        if self.pool:
            await self.pool.close()

    async def _create_tables(self):
        async with self.pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS patients (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    first_name VARCHAR(100) NOT NULL,
                    middle_name VARCHAR(100),
                    last_name VARCHAR(100) NOT NULL,
                    date_of_birth DATE NOT NULL,
                    gender VARCHAR(20) NOT NULL,
                    marital_status VARCHAR(20),
                    ssn VARCHAR(11),
                    primary_care_provider VARCHAR(255),
                    preferred_language VARCHAR(10) DEFAULT 'en',
                    status VARCHAR(20) DEFAULT 'active',
                    tenant_id VARCHAR(255) NOT NULL,
                    created_by VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_by VARCHAR(255),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS patient_identifiers (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    patient_id UUID NOT NULL,
                    identifier_type VARCHAR(50) NOT NULL,
                    identifier_value VARCHAR(255) NOT NULL,
                    issuer VARCHAR(255),
                    is_primary BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS patient_addresses (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    patient_id UUID NOT NULL,
                    line1 VARCHAR(255) NOT NULL,
                    line2 VARCHAR(255),
                    city VARCHAR(100) NOT NULL,
                    state VARCHAR(50) NOT NULL,
                    postal_code VARCHAR(20) NOT NULL,
                    country VARCHAR(10) DEFAULT 'US',
                    address_type VARCHAR(20) DEFAULT 'home',
                    created_at TIMESTAMP DEFAULT NOW(),
                    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS patient_contact_info (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    patient_id UUID NOT NULL,
                    phone_primary VARCHAR(20),
                    phone_secondary VARCHAR(20),
                    email_primary VARCHAR(255),
                    email_secondary VARCHAR(255),
                    preferred_contact_method VARCHAR(20) DEFAULT 'phone',
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS patient_emergency_contacts (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    patient_id UUID NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    relationship VARCHAR(100) NOT NULL,
                    contact_type VARCHAR(20) NOT NULL,
                    phone VARCHAR(20),
                    email VARCHAR(255),
                    address JSONB,
                    created_at TIMESTAMP DEFAULT NOW(),
                    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS patient_insurance (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    patient_id UUID NOT NULL,
                    insurance_id VARCHAR(255) NOT NULL,
                    plan_name VARCHAR(255) NOT NULL,
                    group_number VARCHAR(100),
                    member_id VARCHAR(100) NOT NULL,
                    subscriber_id VARCHAR(100),
                    relationship_to_subscriber VARCHAR(50) DEFAULT 'self',
                    effective_date DATE NOT NULL,
                    termination_date DATE,
                    copay_amount DECIMAL(10,2),
                    deductible_amount DECIMAL(10,2),
                    is_primary BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS patient_allergies (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    patient_id UUID NOT NULL,
                    allergen VARCHAR(255) NOT NULL,
                    reaction VARCHAR(500),
                    severity VARCHAR(20) NOT NULL,
                    status VARCHAR(20) DEFAULT 'active',
                    onset_date DATE,
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS patient_medical_conditions (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    patient_id UUID NOT NULL,
                    condition_code VARCHAR(20) NOT NULL,
                    condition_name VARCHAR(255) NOT NULL,
                    diagnosis_date DATE,
                    status VARCHAR(20) DEFAULT 'active',
                    severity VARCHAR(20),
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS patient_medications (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    patient_id UUID NOT NULL,
                    medication_name VARCHAR(255) NOT NULL,
                    dosage VARCHAR(100),
                    frequency VARCHAR(100),
                    prescribed_by VARCHAR(255),
                    prescribed_date DATE,
                    start_date DATE,
                    end_date DATE,
                    status VARCHAR(20) DEFAULT 'active',
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
                );
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS patient_vital_signs (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    patient_id UUID NOT NULL,
                    recorded_at TIMESTAMP NOT NULL,
                    height DECIMAL(5,2),
                    weight DECIMAL(5,2),
                    bmi DECIMAL(4,1),
                    blood_pressure_systolic INTEGER,
                    blood_pressure_diastolic INTEGER,
                    heart_rate INTEGER,
                    temperature DECIMAL(4,1),
                    respiratory_rate INTEGER,
                    oxygen_saturation DECIMAL(4,1),
                    recorded_by VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
                );
            """)
            
            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(last_name, first_name);
                CREATE INDEX IF NOT EXISTS idx_patients_dob ON patients(date_of_birth);
                CREATE INDEX IF NOT EXISTS idx_patients_ssn ON patients(ssn);
                CREATE INDEX IF NOT EXISTS idx_patients_tenant ON patients(tenant_id);
                CREATE INDEX IF NOT EXISTS idx_patient_identifiers_value ON patient_identifiers(identifier_value);
                CREATE INDEX IF NOT EXISTS idx_patient_contact_phone ON patient_contact_info(phone_primary);
                CREATE INDEX IF NOT EXISTS idx_patient_contact_email ON patient_contact_info(email_primary);
                CREATE INDEX IF NOT EXISTS idx_patient_vital_signs_recorded ON patient_vital_signs(patient_id, recorded_at);
            """)

db_manager = DatabaseManager()

# Patient Manager
class PatientManager:
    def __init__(self):
        self.redis_client = None

    async def _get_redis_client(self):
        if not self.redis_client:
            self.redis_client = get_redis_client()
        return self.redis_client

    async def create_patient(self, patient: Patient) -> str:
        """Create a new patient record"""
        patient.id = str(uuid.uuid4())
        patient.created_at = datetime.utcnow()
        patient.updated_at = patient.created_at
        
        async with db_manager.pool.acquire() as conn:
            async with conn.transaction():
                # Insert patient
                await conn.execute("""
                    INSERT INTO patients 
                    (id, first_name, middle_name, last_name, date_of_birth, gender,
                     marital_status, ssn, primary_care_provider, preferred_language,
                     status, tenant_id, created_by, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                """, patient.id, patient.first_name, patient.middle_name, patient.last_name,
                    patient.date_of_birth, patient.gender.value, 
                    patient.marital_status.value if patient.marital_status else None,
                    patient.ssn, patient.primary_care_provider, patient.preferred_language,
                    patient.status.value, patient.tenant_id, patient.created_by,
                    patient.created_at, patient.updated_at)
                
                # Insert identifiers
                for identifier in patient.identifiers:
                    await conn.execute("""
                        INSERT INTO patient_identifiers 
                        (patient_id, identifier_type, identifier_value, issuer, is_primary)
                        VALUES ($1, $2, $3, $4, $5)
                    """, patient.id, identifier.type.value, identifier.value,
                        identifier.issuer, identifier.is_primary)
                
                # Insert addresses
                for address in patient.addresses:
                    await conn.execute("""
                        INSERT INTO patient_addresses 
                        (patient_id, line1, line2, city, state, postal_code, country, address_type)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    """, patient.id, address.line1, address.line2, address.city,
                        address.state, address.postal_code, address.country, address.type)
                
                # Insert contact info
                if patient.contact_info:
                    await conn.execute("""
                        INSERT INTO patient_contact_info 
                        (patient_id, phone_primary, phone_secondary, email_primary, 
                         email_secondary, preferred_contact_method)
                        VALUES ($1, $2, $3, $4, $5, $6)
                    """, patient.id, patient.contact_info.phone_primary,
                        patient.contact_info.phone_secondary, patient.contact_info.email_primary,
                        patient.contact_info.email_secondary, patient.contact_info.preferred_contact_method)
                
                # Insert emergency contacts
                for contact in patient.emergency_contacts:
                    await conn.execute("""
                        INSERT INTO patient_emergency_contacts 
                        (patient_id, name, relationship, contact_type, phone, email, address)
                        VALUES ($1, $2, $3, $4, $5, $6, $7)
                    """, patient.id, contact.name, contact.relationship, contact.contact_type.value,
                        contact.phone, contact.email, 
                        json.dumps(contact.address.dict()) if contact.address else None)
                
                # Insert insurance info
                for insurance in patient.insurance_info:
                    await conn.execute("""
                        INSERT INTO patient_insurance 
                        (patient_id, insurance_id, plan_name, group_number, member_id,
                         subscriber_id, relationship_to_subscriber, effective_date,
                         termination_date, copay_amount, deductible_amount, is_primary)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                    """, patient.id, insurance.insurance_id, insurance.plan_name,
                        insurance.group_number, insurance.member_id, insurance.subscriber_id,
                        insurance.relationship_to_subscriber, insurance.effective_date,
                        insurance.termination_date, insurance.copay_amount,
                        insurance.deductible_amount, insurance.is_primary)
                
                # Insert allergies
                for allergy in patient.allergies:
                    allergy.id = str(uuid.uuid4())
                    await conn.execute("""
                        INSERT INTO patient_allergies 
                        (id, patient_id, allergen, reaction, severity, status, onset_date, notes)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    """, allergy.id, patient.id, allergy.allergen, allergy.reaction,
                        allergy.severity.value, allergy.status.value, allergy.onset_date, allergy.notes)
                
                # Insert medical conditions
                for condition in patient.medical_conditions:
                    condition.id = str(uuid.uuid4())
                    await conn.execute("""
                        INSERT INTO patient_medical_conditions 
                        (id, patient_id, condition_code, condition_name, diagnosis_date, 
                         status, severity, notes)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    """, condition.id, patient.id, condition.condition_code, condition.condition_name,
                        condition.diagnosis_date, condition.status, condition.severity, condition.notes)
                
                # Insert medications
                for medication in patient.medications:
                    medication.id = str(uuid.uuid4())
                    await conn.execute("""
                        INSERT INTO patient_medications 
                        (id, patient_id, medication_name, dosage, frequency, prescribed_by,
                         prescribed_date, start_date, end_date, status, notes)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                    """, medication.id, patient.id, medication.medication_name, medication.dosage,
                        medication.frequency, medication.prescribed_by, medication.prescribed_date,
                        medication.start_date, medication.end_date, medication.status, medication.notes)
        
        logger.info(f"Created patient: {patient.id}")
        return patient.id

    async def get_patient(self, patient_id: str, tenant_id: str) -> Optional[Patient]:
        """Get patient by ID"""
        async with db_manager.pool.acquire() as conn:
            # Get patient basic info
            patient_row = await conn.fetchrow("""
                SELECT * FROM patients WHERE id = $1 AND tenant_id = $2
            """, patient_id, tenant_id)
            
            if not patient_row:
                return None
            
            patient_data = dict(patient_row)
            
            # Get identifiers
            identifiers = await conn.fetch("""
                SELECT * FROM patient_identifiers WHERE patient_id = $1
            """, patient_id)
            
            # Get addresses
            addresses = await conn.fetch("""
                SELECT * FROM patient_addresses WHERE patient_id = $1
            """, patient_id)
            
            # Get contact info
            contact_row = await conn.fetchrow("""
                SELECT * FROM patient_contact_info WHERE patient_id = $1
            """, patient_id)
            
            # Get emergency contacts
            emergency_contacts = await conn.fetch("""
                SELECT * FROM patient_emergency_contacts WHERE patient_id = $1
            """, patient_id)
            
            # Get insurance info
            insurance_info = await conn.fetch("""
                SELECT * FROM patient_insurance WHERE patient_id = $1
            """, patient_id)
            
            # Get allergies
            allergies = await conn.fetch("""
                SELECT * FROM patient_allergies WHERE patient_id = $1
            """, patient_id)
            
            # Get medical conditions
            conditions = await conn.fetch("""
                SELECT * FROM patient_medical_conditions WHERE patient_id = $1
            """, patient_id)
            
            # Get medications
            medications = await conn.fetch("""
                SELECT * FROM patient_medications WHERE patient_id = $1
            """, patient_id)
            
            # Build patient object
            patient = Patient(
                id=patient_data['id'],
                first_name=patient_data['first_name'],
                middle_name=patient_data['middle_name'],
                last_name=patient_data['last_name'],
                date_of_birth=patient_data['date_of_birth'],
                gender=Gender(patient_data['gender']),
                marital_status=MaritalStatus(patient_data['marital_status']) if patient_data['marital_status'] else None,
                ssn=patient_data['ssn'],
                primary_care_provider=patient_data['primary_care_provider'],
                preferred_language=patient_data['preferred_language'],
                status=PatientStatus(patient_data['status']),
                tenant_id=patient_data['tenant_id'],
                created_by=patient_data['created_by'],
                created_at=patient_data['created_at'],
                updated_at=patient_data['updated_at'],
                identifiers=[PatientIdentifier(
                    type=IdentifierType(row['identifier_type']),
                    value=row['identifier_value'],
                    issuer=row['issuer'],
                    is_primary=row['is_primary']
                ) for row in identifiers],
                addresses=[Address(
                    line1=row['line1'],
                    line2=row['line2'],
                    city=row['city'],
                    state=row['state'],
                    postal_code=row['postal_code'],
                    country=row['country'],
                    type=row['address_type']
                ) for row in addresses],
                contact_info=ContactInfo(**dict(contact_row)) if contact_row else ContactInfo(),
                emergency_contacts=[EmergencyContact(
                    name=row['name'],
                    relationship=row['relationship'],
                    contact_type=ContactType(row['contact_type']),
                    phone=row['phone'],
                    email=row['email'],
                    address=Address(**json.loads(row['address'])) if row['address'] else None
                ) for row in emergency_contacts],
                insurance_info=[InsuranceInfo(
                    insurance_id=row['insurance_id'],
                    plan_name=row['plan_name'],
                    group_number=row['group_number'],
                    member_id=row['member_id'],
                    subscriber_id=row['subscriber_id'],
                    relationship_to_subscriber=row['relationship_to_subscriber'],
                    effective_date=row['effective_date'],
                    termination_date=row['termination_date'],
                    copay_amount=row['copay_amount'],
                    deductible_amount=row['deductible_amount'],
                    is_primary=row['is_primary']
                ) for row in insurance_info],
                allergies=[Allergy(
                    id=row['id'],
                    allergen=row['allergen'],
                    reaction=row['reaction'],
                    severity=AllergySeverity(row['severity']),
                    status=AllergyStatus(row['status']),
                    onset_date=row['onset_date'],
                    notes=row['notes']
                ) for row in allergies],
                medical_conditions=[MedicalCondition(
                    id=row['id'],
                    condition_code=row['condition_code'],
                    condition_name=row['condition_name'],
                    diagnosis_date=row['diagnosis_date'],
                    status=row['status'],
                    severity=row['severity'],
                    notes=row['notes']
                ) for row in conditions],
                medications=[Medication(
                    id=row['id'],
                    medication_name=row['medication_name'],
                    dosage=row['dosage'],
                    frequency=row['frequency'],
                    prescribed_by=row['prescribed_by'],
                    prescribed_date=row['prescribed_date'],
                    start_date=row['start_date'],
                    end_date=row['end_date'],
                    status=row['status'],
                    notes=row['notes']
                ) for row in medications]
            )
            
            return patient

    async def search_patients(self, search: PatientSearch, limit: int = 50) -> List[Dict[str, Any]]:
        """Search for patients"""
        query = """
            SELECT p.*, 
                   ci.phone_primary, ci.email_primary,
                   array_agg(DISTINCT pi.identifier_value) as identifiers
            FROM patients p
            LEFT JOIN patient_contact_info ci ON p.id = ci.patient_id
            LEFT JOIN patient_identifiers pi ON p.id = pi.patient_id
            WHERE 1=1
        """
        params = []
        param_count = 0
        
        if search.tenant_id:
            param_count += 1
            query += f" AND p.tenant_id = ${param_count}"
            params.append(search.tenant_id)
        
        if search.first_name:
            param_count += 1
            query += f" AND p.first_name ILIKE ${param_count}"
            params.append(f"%{search.first_name}%")
        
        if search.last_name:
            param_count += 1
            query += f" AND p.last_name ILIKE ${param_count}"
            params.append(f"%{search.last_name}%")
        
        if search.date_of_birth:
            param_count += 1
            query += f" AND p.date_of_birth = ${param_count}"
            params.append(search.date_of_birth)
        
        if search.ssn:
            param_count += 1
            query += f" AND p.ssn = ${param_count}"
            params.append(search.ssn)
        
        if search.phone:
            param_count += 1
            query += f" AND ci.phone_primary LIKE ${param_count}"
            params.append(f"%{search.phone}%")
        
        if search.email:
            param_count += 1
            query += f" AND ci.email_primary ILIKE ${param_count}"
            params.append(f"%{search.email}%")
        
        if search.identifier_value:
            param_count += 1
            query += f" AND pi.identifier_value = ${param_count}"
            params.append(search.identifier_value)
        
        query += f"""
            GROUP BY p.id, ci.phone_primary, ci.email_primary
            ORDER BY p.last_name, p.first_name
            LIMIT ${param_count + 1}
        """
        params.append(limit)
        
        async with db_manager.pool.acquire() as conn:
            rows = await conn.fetch(query, *params)
            return [dict(row) for row in rows]

    async def record_vital_signs(self, vital_signs: VitalSigns) -> str:
        """Record patient vital signs"""
        vital_id = str(uuid.uuid4())
        
        # Calculate BMI if height and weight are provided
        bmi = None
        if vital_signs.height and vital_signs.weight:
            height_m = vital_signs.height / 100  # convert cm to meters
            bmi = vital_signs.weight / (height_m ** 2)
            vital_signs.bmi = round(bmi, 1)
        
        async with db_manager.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO patient_vital_signs 
                (id, patient_id, recorded_at, height, weight, bmi, blood_pressure_systolic,
                 blood_pressure_diastolic, heart_rate, temperature, respiratory_rate,
                 oxygen_saturation, recorded_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            """, vital_id, vital_signs.patient_id, vital_signs.recorded_at,
                vital_signs.height, vital_signs.weight, vital_signs.bmi,
                vital_signs.blood_pressure_systolic, vital_signs.blood_pressure_diastolic,
                vital_signs.heart_rate, vital_signs.temperature, vital_signs.respiratory_rate,
                vital_signs.oxygen_saturation, vital_signs.recorded_by)
        
        logger.info(f"Recorded vital signs for patient: {vital_signs.patient_id}")
        return vital_id

patient_manager = PatientManager()

# Lifespan manager
@asynccontextmanager
async def lifespan(app: FastAPI):
    await db_manager.connect()
    yield
    await db_manager.disconnect()

app = FastAPI(

app.middleware("http")(security_headers_middleware)
    title="Healthcare Claims Platform - Patient Management Service",
    description="FHIR-compliant patient management with comprehensive healthcare data support",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Endpoints
@app.post("/patients", status_code=status.HTTP_201_CREATED)
async def create_patient(patient: Patient):
    """Create a new patient record"""
    patient_id = await patient_manager.create_patient(patient)
    return {"patient_id": patient_id}

@app.get("/patients/{patient_id}")
async def get_patient(patient_id: str, tenant_id: str = Query(...)):
    """Get patient by ID"""
    patient = await patient_manager.get_patient(patient_id, tenant_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    return patient

@app.put("/patients/{patient_id}")
async def update_patient(patient_id: str, update: PatientUpdate, tenant_id: str = Query(...)):
    """Update patient information"""
    # Get existing patient
    existing_patient = await patient_manager.get_patient(patient_id, tenant_id)
    if not existing_patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    
    # Update fields
    update_data = update.dict(exclude_unset=True)
    
    async with db_manager.pool.acquire() as conn:
        # Build dynamic update query
        set_clauses = []
        params = []
        param_count = 0
        
        for field, value in update_data.items():
            if field == 'updated_by':
                continue
            param_count += 1
            if field == 'gender':
                set_clauses.append(f"gender = ${param_count}")
                params.append(value.value if value else None)
            elif field == 'marital_status':
                set_clauses.append(f"marital_status = ${param_count}")
                params.append(value.value if value else None)
            elif field == 'status':
                set_clauses.append(f"status = ${param_count}")
                params.append(value.value if value else None)
            elif field not in ['addresses', 'contact_info', 'emergency_contacts', 
                              'insurance_info', 'allergies', 'medical_conditions', 'medications']:
                set_clauses.append(f"{field} = ${param_count}")
                params.append(value)
        
        if set_clauses:
            param_count += 1
            set_clauses.append(f"updated_by = ${param_count}")
            params.append(update.updated_by)
            
            param_count += 1
            set_clauses.append(f"updated_at = ${param_count}")
            params.append(datetime.utcnow())
            
            param_count += 1
            params.append(patient_id)
            
            param_count += 1
            params.append(tenant_id)
            
            query = f"""
                UPDATE patients 
                SET {', '.join(set_clauses)}
                WHERE id = ${param_count - 1} AND tenant_id = ${param_count}
            """
            
            await conn.execute(query, *params)
    
    return {"message": "Patient updated successfully"}

@app.post("/patients/search")
async def search_patients(search: PatientSearch, limit: int = Query(50, le=100)):
    """Search for patients"""
    patients = await patient_manager.search_patients(search, limit)
    return {"patients": patients, "count": len(patients)}

@app.post("/patients/{patient_id}/vital-signs", status_code=status.HTTP_201_CREATED)
async def record_vital_signs(patient_id: str, vital_signs: VitalSigns):
    """Record patient vital signs"""
    vital_signs.patient_id = patient_id
    vital_id = await patient_manager.record_vital_signs(vital_signs)
    return {"vital_signs_id": vital_id}

@app.get("/patients/{patient_id}/vital-signs")
async def get_vital_signs(patient_id: str, 
                         start_date: Optional[datetime] = None,
                         end_date: Optional[datetime] = None,
                         limit: int = Query(50, le=100)):
    """Get patient vital signs history"""
    query = "SELECT * FROM patient_vital_signs WHERE patient_id = $1"
    params = [patient_id]
    
    if start_date:
        query += " AND recorded_at >= $2"
        params.append(start_date)
    
    if end_date:
        param_num = len(params) + 1
        query += f" AND recorded_at <= ${param_num}"
        params.append(end_date)
    
    query += f" ORDER BY recorded_at DESC LIMIT ${len(params) + 1}"
    params.append(limit)
    
    async with db_manager.pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
        return {"vital_signs": [dict(row) for row in rows]}

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "patient-management"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8004)
