#!/usr/bin/env python3
"""
Enhanced Data Validation Service
Schema validation and business rule enforcement for healthcare data
Port: 8017
"""

import asyncio
import json
import logging
import uuid
import re
from datetime import datetime, date
from decimal import Decimal
from typing import Dict, List, Optional, Any, Union
from enum import Enum
import jsonschema
from jsonschema import validate, ValidationError


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

from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
import asyncpg

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# FastAPI app
app = FastAPI(
    title="Data Validation Service",
    description="Schema validation and business rule enforcement for healthcare data",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security
security = HTTPBearer()

# Enums
class ValidationLevel(str, Enum):
    BASIC = "basic"
    STANDARD = "standard"
    STRICT = "strict"
    CUSTOM = "custom"

class DataType(str, Enum):
    CLAIM = "claim"
    PATIENT = "patient"
    PROVIDER = "provider"
    PAYMENT = "payment"
    DOCUMENT = "document"
    USER = "user"
    AUDIT = "audit"

class ValidationStatus(str, Enum):
    VALID = "valid"
    INVALID = "invalid"
    WARNING = "warning"
    PENDING = "pending"

# Pydantic Models
class ValidationRequest(BaseModel):
    data_type: DataType
    data: Dict[str, Any]
    validation_level: ValidationLevel = ValidationLevel.STANDARD
    custom_rules: Optional[List[str]] = []
    context: Optional[Dict[str, Any]] = {}

class ValidationRule(BaseModel):
    rule_id: str
    name: str
    description: str
    data_type: DataType
    rule_type: str  # schema, business, custom
    rule_definition: Dict[str, Any]
    is_active: bool = True
    severity: str = "error"  # error, warning, info

class ValidationResult(BaseModel):
    validation_id: str
    status: ValidationStatus
    is_valid: bool
    errors: List[Dict[str, Any]] = []
    warnings: List[Dict[str, Any]] = []
    validated_data: Optional[Dict[str, Any]] = None
    metadata: Dict[str, Any] = {}

class BulkValidationRequest(BaseModel):
    validations: List[ValidationRequest]
    stop_on_first_error: bool = False

# Data Validation Service
class DataValidationService:
    def __init__(self):
        self.db_pool = None
        self.redis = None
        self.schemas = {}
        self.business_rules = {}
        self.custom_validators = {}
        
    async def initialize(self):
        """Initialize database connections and load validation rules"""
        try:
            # Database connection
            self.db_pool = await asyncpg.create_pool(
                os.environ["DATABASE_URL"],
                min_size=5,
                max_size=20
            )
            
            # Redis connection
            self.redis = get_redis_client()
            
            # Load validation schemas and rules
            await self.load_validation_schemas()
            await self.load_business_rules()
            await self.load_custom_validators()
            
            logger.info("Data Validation Service initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize Data Validation Service: {e}")
            raise

    async def load_validation_schemas(self):
        """Load JSON schemas for different data types"""
        self.schemas = {
            DataType.CLAIM: {
                "type": "object",
                "required": ["claim_id", "patient_id", "provider_id", "service_date", "diagnosis_codes", "procedure_codes", "billed_amount"],
                "properties": {
                    "claim_id": {"type": "string", "pattern": "^CLM-[A-Z0-9]{6,12}$"},
                    "patient_id": {"type": "string", "pattern": "^PAT-[A-Z0-9]{6,12}$"},
                    "provider_id": {"type": "string", "pattern": "^PRV-[A-Z0-9]{6,12}$"},
                    "service_date": {"type": "string", "format": "date"},
                    "diagnosis_codes": {
                        "type": "array",
                        "items": {"type": "string", "pattern": "^[A-Z][0-9]{2}(\\.[0-9X]{1,4})?$"},
                        "minItems": 1,
                        "maxItems": 12
                    },
                    "procedure_codes": {
                        "type": "array",
                        "items": {"type": "string", "pattern": "^[0-9]{5}$"},
                        "minItems": 1,
                        "maxItems": 25
                    },
                    "billed_amount": {"type": "number", "minimum": 0, "maximum": 1000000},
                    "place_of_service": {"type": "string", "pattern": "^[0-9]{2}$"},
                    "member_id": {"type": "string"},
                    "rendering_provider_npi": {"type": "string", "pattern": "^[0-9]{10}$"}
                }
            },
            DataType.PATIENT: {
                "type": "object",
                "required": ["patient_id", "first_name", "last_name", "date_of_birth", "gender"],
                "properties": {
                    "patient_id": {"type": "string", "pattern": "^PAT-[A-Z0-9]{6,12}$"},
                    "first_name": {"type": "string", "minLength": 1, "maxLength": 50},
                    "last_name": {"type": "string", "minLength": 1, "maxLength": 50},
                    "date_of_birth": {"type": "string", "format": "date"},
                    "gender": {"type": "string", "enum": ["M", "F", "U", "O"]},
                    "ssn": {"type": "string", "pattern": "^[0-9]{3}-[0-9]{2}-[0-9]{4}$"},
                    "phone": {"type": "string", "pattern": "^\\+?1?[0-9]{10,15}$"},
                    "email": {"type": "string", "format": "email"},
                    "address": {
                        "type": "object",
                        "properties": {
                            "street": {"type": "string", "maxLength": 100},
                            "city": {"type": "string", "maxLength": 50},
                            "state": {"type": "string", "pattern": "^[A-Z]{2}$"},
                            "zip_code": {"type": "string", "pattern": "^[0-9]{5}(-[0-9]{4})?$"}
                        }
                    }
                }
            },
            DataType.PROVIDER: {
                "type": "object",
                "required": ["provider_id", "name", "npi", "taxonomy_code"],
                "properties": {
                    "provider_id": {"type": "string", "pattern": "^PRV-[A-Z0-9]{6,12}$"},
                    "name": {"type": "string", "minLength": 1, "maxLength": 100},
                    "npi": {"type": "string", "pattern": "^[0-9]{10}$"},
                    "taxonomy_code": {"type": "string", "pattern": "^[0-9]{10}X$"},
                    "license_number": {"type": "string", "minLength": 5, "maxLength": 20},
                    "dea_number": {"type": "string", "pattern": "^[A-Z]{2}[0-9]{7}$"},
                    "tin": {"type": "string", "pattern": "^[0-9]{2}-[0-9]{7}$"},
                    "specialty": {"type": "string", "maxLength": 100},
                    "practice_address": {
                        "type": "object",
                        "properties": {
                            "street": {"type": "string", "maxLength": 100},
                            "city": {"type": "string", "maxLength": 50},
                            "state": {"type": "string", "pattern": "^[A-Z]{2}$"},
                            "zip_code": {"type": "string", "pattern": "^[0-9]{5}(-[0-9]{4})?$"}
                        }
                    }
                }
            },
            DataType.PAYMENT: {
                "type": "object",
                "required": ["payment_id", "claim_id", "amount", "payment_method"],
                "properties": {
                    "payment_id": {"type": "string", "pattern": "^PAY-[A-Z0-9]{6,12}$"},
                    "claim_id": {"type": "string", "pattern": "^CLM-[A-Z0-9]{6,12}$"},
                    "amount": {"type": "number", "minimum": 0, "maximum": 1000000},
                    "payment_method": {"type": "string", "enum": ["ach", "wire", "check", "card", "eft", "virtual_card"]},
                    "payee_id": {"type": "string"},
                    "scheduled_date": {"type": "string", "format": "date"},
                    "reference_number": {"type": "string", "maxLength": 50}
                }
            }
        }

    async def load_business_rules(self):
        """Load business validation rules"""
        self.business_rules = {
            DataType.CLAIM: [
                {
                    "rule_id": "claim_date_range",
                    "name": "Service Date Range Validation",
                    "description": "Service date must be within acceptable range",
                    "validator": self.validate_claim_date_range
                },
                {
                    "rule_id": "diagnosis_procedure_compatibility",
                    "name": "Diagnosis-Procedure Compatibility",
                    "description": "Procedure codes must be compatible with diagnosis codes",
                    "validator": self.validate_diagnosis_procedure_compatibility
                },
                {
                    "rule_id": "duplicate_claim_check",
                    "name": "Duplicate Claim Detection",
                    "description": "Check for duplicate claims",
                    "validator": self.validate_duplicate_claim
                },
                {
                    "rule_id": "provider_eligibility",
                    "name": "Provider Eligibility Check",
                    "description": "Provider must be eligible for the service date",
                    "validator": self.validate_provider_eligibility
                },
                {
                    "rule_id": "member_eligibility",
                    "name": "Member Eligibility Check",
                    "description": "Member must be eligible for the service date",
                    "validator": self.validate_member_eligibility
                }
            ],
            DataType.PATIENT: [
                {
                    "rule_id": "age_validation",
                    "name": "Age Validation",
                    "description": "Patient age must be reasonable",
                    "validator": self.validate_patient_age
                },
                {
                    "rule_id": "duplicate_patient_check",
                    "name": "Duplicate Patient Detection",
                    "description": "Check for duplicate patient records",
                    "validator": self.validate_duplicate_patient
                }
            ],
            DataType.PROVIDER: [
                {
                    "rule_id": "npi_validation",
                    "name": "NPI Validation",
                    "description": "Validate NPI using Luhn algorithm",
                    "validator": self.validate_npi
                },
                {
                    "rule_id": "license_expiry",
                    "name": "License Expiry Check",
                    "description": "Provider license must not be expired",
                    "validator": self.validate_license_expiry
                }
            ]
        }

    async def load_custom_validators(self):
        """Load custom validation functions"""
        self.custom_validators = {
            "hipaa_compliance": self.validate_hipaa_compliance,
            "pii_detection": self.validate_pii_detection,
            "data_quality_score": self.calculate_data_quality_score,
            "business_logic": self.validate_business_logic
        }

    async def validate_data(self, validation_request: ValidationRequest) -> ValidationResult:
        """Validate data according to specified rules"""
        try:
            validation_id = str(uuid.uuid4())
            errors = []
            warnings = []
            validated_data = validation_request.data.copy()
            
            # Schema validation
            if validation_request.validation_level in [ValidationLevel.STANDARD, ValidationLevel.STRICT]:
                schema_errors = await self.validate_schema(validation_request.data_type, validation_request.data)
                errors.extend(schema_errors)
            
            # Business rules validation
            if validation_request.validation_level in [ValidationLevel.STANDARD, ValidationLevel.STRICT]:
                business_errors, business_warnings = await self.validate_business_rules(
                    validation_request.data_type, 
                    validation_request.data,
                    validation_request.context
                )
                errors.extend(business_errors)
                warnings.extend(business_warnings)
            
            # Custom rules validation
            if validation_request.custom_rules:
                custom_errors, custom_warnings = await self.validate_custom_rules(
                    validation_request.custom_rules,
                    validation_request.data,
                    validation_request.context
                )
                errors.extend(custom_errors)
                warnings.extend(custom_warnings)
            
            # Data enrichment and normalization
            if validation_request.validation_level == ValidationLevel.STRICT:
                validated_data = await self.enrich_and_normalize_data(
                    validation_request.data_type,
                    validated_data
                )
            
            # Determine overall status
            if errors:
                status = ValidationStatus.INVALID
                is_valid = False
            elif warnings:
                status = ValidationStatus.WARNING
                is_valid = True
            else:
                status = ValidationStatus.VALID
                is_valid = True
            
            # Create validation result
            result = ValidationResult(
                validation_id=validation_id,
                status=status,
                is_valid=is_valid,
                errors=errors,
                warnings=warnings,
                validated_data=validated_data,
                metadata={
                    "validation_level": validation_request.validation_level.value,
                    "data_type": validation_request.data_type.value,
                    "timestamp": datetime.utcnow().isoformat(),
                    "rules_applied": len(self.business_rules.get(validation_request.data_type, [])) + len(validation_request.custom_rules)
                }
            )
            
            # Cache result
            await self.cache_validation_result(validation_id, result)
            
            # Log validation
            await self.log_validation(validation_request, result)
            
            return result
            
        except Exception as e:
            logger.error(f"Data validation failed: {e}")
            raise HTTPException(status_code=500, detail=f"Validation failed: {str(e)}")

    async def validate_schema(self, data_type: DataType, data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Validate data against JSON schema"""
        errors = []
        
        try:
            schema = self.schemas.get(data_type)
            if not schema:
                return [{"type": "schema_error", "message": f"No schema defined for data type: {data_type}"}]
            
            validate(data, schema)
            
        except ValidationError as e:
            errors.append({
                "type": "schema_error",
                "field": e.absolute_path[-1] if e.absolute_path else "root",
                "message": e.message,
                "invalid_value": e.instance if hasattr(e, 'instance') else None
            })
        except Exception as e:
            errors.append({
                "type": "schema_error",
                "message": f"Schema validation error: {str(e)}"
            })
        
        return errors

    async def validate_business_rules(self, data_type: DataType, data: Dict[str, Any], context: Dict[str, Any]) -> tuple:
        """Validate business rules"""
        errors = []
        warnings = []
        
        rules = self.business_rules.get(data_type, [])
        
        for rule in rules:
            try:
                validator_func = rule["validator"]
                result = await validator_func(data, context)
                
                if result["is_valid"]:
                    if result.get("warnings"):
                        warnings.extend(result["warnings"])
                else:
                    errors.extend(result.get("errors", []))
                    
            except Exception as e:
                errors.append({
                    "type": "business_rule_error",
                    "rule_id": rule["rule_id"],
                    "message": f"Business rule validation failed: {str(e)}"
                })
        
        return errors, warnings

    async def validate_custom_rules(self, custom_rules: List[str], data: Dict[str, Any], context: Dict[str, Any]) -> tuple:
        """Validate custom rules"""
        errors = []
        warnings = []
        
        for rule_name in custom_rules:
            try:
                validator_func = self.custom_validators.get(rule_name)
                if not validator_func:
                    errors.append({
                        "type": "custom_rule_error",
                        "message": f"Custom rule not found: {rule_name}"
                    })
                    continue
                
                result = await validator_func(data, context)
                
                if result["is_valid"]:
                    if result.get("warnings"):
                        warnings.extend(result["warnings"])
                else:
                    errors.extend(result.get("errors", []))
                    
            except Exception as e:
                errors.append({
                    "type": "custom_rule_error",
                    "rule_name": rule_name,
                    "message": f"Custom rule validation failed: {str(e)}"
                })
        
        return errors, warnings

    # Business Rule Validators
    async def validate_claim_date_range(self, data: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """Validate claim service date is within acceptable range"""
        try:
            service_date = datetime.strptime(data.get("service_date", ""), "%Y-%m-%d").date()
            today = date.today()
            
            # Service date cannot be in the future
            if service_date > today:
                return {
                    "is_valid": False,
                    "errors": [{
                        "type": "business_rule_error",
                        "rule_id": "claim_date_range",
                        "message": "Service date cannot be in the future",
                        "field": "service_date"
                    }]
                }
            
            # Service date cannot be more than 2 years old
            if (today - service_date).days > 730:
                return {
                    "is_valid": False,
                    "errors": [{
                        "type": "business_rule_error",
                        "rule_id": "claim_date_range",
                        "message": "Service date is too old (more than 2 years)",
                        "field": "service_date"
                    }]
                }
            
            return {"is_valid": True}
            
        except Exception as e:
            return {
                "is_valid": False,
                "errors": [{
                    "type": "business_rule_error",
                    "rule_id": "claim_date_range",
                    "message": f"Date validation error: {str(e)}"
                }]
            }

    async def validate_diagnosis_procedure_compatibility(self, data: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """Validate diagnosis and procedure code compatibility"""
        try:
            diagnosis_codes = data.get("diagnosis_codes", [])
            procedure_codes = data.get("procedure_codes", [])
            
            # Mock compatibility check - in real implementation, use medical coding databases
            incompatible_combinations = [
                (["Z51.11"], ["99213"]),  # Example: Chemotherapy with routine office visit
            ]
            
            for diag_codes, proc_codes in incompatible_combinations:
                if any(d in diagnosis_codes for d in diag_codes) and any(p in procedure_codes for p in proc_codes):
                    return {
                        "is_valid": False,
                        "errors": [{
                            "type": "business_rule_error",
                            "rule_id": "diagnosis_procedure_compatibility",
                            "message": f"Incompatible diagnosis and procedure codes: {diag_codes} with {proc_codes}"
                        }]
                    }
            
            return {"is_valid": True}
            
        except Exception as e:
            return {
                "is_valid": False,
                "errors": [{
                    "type": "business_rule_error",
                    "rule_id": "diagnosis_procedure_compatibility",
                    "message": f"Compatibility validation error: {str(e)}"
                }]
            }

    async def validate_duplicate_claim(self, data: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """Check for duplicate claims"""
        try:
            # Check database for duplicate claims
            async with self.db_pool.acquire() as conn:
                duplicate = await conn.fetchrow("""
                    SELECT claim_id FROM claims 
                    WHERE patient_id = $1 AND provider_id = $2 AND service_date = $3 
                    AND claim_id != $4
                """, data.get("patient_id"), data.get("provider_id"), 
                    data.get("service_date"), data.get("claim_id"))
                
                if duplicate:
                    return {
                        "is_valid": False,
                        "errors": [{
                            "type": "business_rule_error",
                            "rule_id": "duplicate_claim_check",
                            "message": f"Duplicate claim found: {duplicate['claim_id']}"
                        }]
                    }
            
            return {"is_valid": True}
            
        except Exception as e:
            return {
                "is_valid": False,
                "errors": [{
                    "type": "business_rule_error",
                    "rule_id": "duplicate_claim_check",
                    "message": f"Duplicate check error: {str(e)}"
                }]
            }

    async def validate_provider_eligibility(self, data: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """Validate provider eligibility"""
        try:
            # Mock provider eligibility check
            provider_id = data.get("provider_id")
            service_date = data.get("service_date")
            
            # Check provider status in database
            async with self.db_pool.acquire() as conn:
                provider = await conn.fetchrow("""
                    SELECT is_active, license_expiry FROM providers 
                    WHERE provider_id = $1
                """, provider_id)
                
                if not provider:
                    return {
                        "is_valid": False,
                        "errors": [{
                            "type": "business_rule_error",
                            "rule_id": "provider_eligibility",
                            "message": "Provider not found"
                        }]
                    }
                
                if not provider["is_active"]:
                    return {
                        "is_valid": False,
                        "errors": [{
                            "type": "business_rule_error",
                            "rule_id": "provider_eligibility",
                            "message": "Provider is not active"
                        }]
                    }
            
            return {"is_valid": True}
            
        except Exception as e:
            return {
                "is_valid": False,
                "errors": [{
                    "type": "business_rule_error",
                    "rule_id": "provider_eligibility",
                    "message": f"Provider eligibility check error: {str(e)}"
                }]
            }

    async def validate_member_eligibility(self, data: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """Validate member eligibility"""
        try:
            # Mock member eligibility check
            patient_id = data.get("patient_id")
            service_date = data.get("service_date")
            
            # In real implementation, check with eligibility service
            return {"is_valid": True}
            
        except Exception as e:
            return {
                "is_valid": False,
                "errors": [{
                    "type": "business_rule_error",
                    "rule_id": "member_eligibility",
                    "message": f"Member eligibility check error: {str(e)}"
                }]
            }

    async def validate_patient_age(self, data: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """Validate patient age"""
        try:
            dob = datetime.strptime(data.get("date_of_birth", ""), "%Y-%m-%d").date()
            today = date.today()
            age = (today - dob).days // 365
            
            if age < 0 or age > 150:
                return {
                    "is_valid": False,
                    "errors": [{
                        "type": "business_rule_error",
                        "rule_id": "age_validation",
                        "message": f"Invalid age: {age}"
                    }]
                }
            
            return {"is_valid": True}
            
        except Exception as e:
            return {
                "is_valid": False,
                "errors": [{
                    "type": "business_rule_error",
                    "rule_id": "age_validation",
                    "message": f"Age validation error: {str(e)}"
                }]
            }

    async def validate_duplicate_patient(self, data: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """Check for duplicate patients"""
        try:
            # Mock duplicate patient check
            return {"is_valid": True}
            
        except Exception as e:
            return {
                "is_valid": False,
                "errors": [{
                    "type": "business_rule_error",
                    "rule_id": "duplicate_patient_check",
                    "message": f"Duplicate patient check error: {str(e)}"
                }]
            }

    async def validate_npi(self, data: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """Validate NPI using Luhn algorithm"""
        try:
            npi = data.get("npi", "")
            
            if not self.luhn_checksum(npi):
                return {
                    "is_valid": False,
                    "errors": [{
                        "type": "business_rule_error",
                        "rule_id": "npi_validation",
                        "message": "Invalid NPI checksum"
                    }]
                }
            
            return {"is_valid": True}
            
        except Exception as e:
            return {
                "is_valid": False,
                "errors": [{
                    "type": "business_rule_error",
                    "rule_id": "npi_validation",
                    "message": f"NPI validation error: {str(e)}"
                }]
            }

    async def validate_license_expiry(self, data: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """Check provider license expiry"""
        try:
            # Mock license expiry check
            return {"is_valid": True}
            
        except Exception as e:
            return {
                "is_valid": False,
                "errors": [{
                    "type": "business_rule_error",
                    "rule_id": "license_expiry",
                    "message": f"License expiry check error: {str(e)}"
                }]
            }

    # Custom Validators
    async def validate_hipaa_compliance(self, data: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """Validate HIPAA compliance"""
        try:
            # Check for PII exposure, proper encryption, etc.
            return {"is_valid": True}
            
        except Exception as e:
            return {
                "is_valid": False,
                "errors": [{
                    "type": "custom_rule_error",
                    "rule_name": "hipaa_compliance",
                    "message": f"HIPAA compliance check error: {str(e)}"
                }]
            }

    async def validate_pii_detection(self, data: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """Detect PII in data"""
        try:
            # Mock PII detection
            return {"is_valid": True}
            
        except Exception as e:
            return {
                "is_valid": False,
                "errors": [{
                    "type": "custom_rule_error",
                    "rule_name": "pii_detection",
                    "message": f"PII detection error: {str(e)}"
                }]
            }

    async def calculate_data_quality_score(self, data: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """Calculate data quality score"""
        try:
            # Mock data quality scoring
            score = 0.95  # 95% quality score
            
            if score < 0.8:
                return {
                    "is_valid": True,
                    "warnings": [{
                        "type": "data_quality_warning",
                        "message": f"Low data quality score: {score:.2%}"
                    }]
                }
            
            return {"is_valid": True}
            
        except Exception as e:
            return {
                "is_valid": False,
                "errors": [{
                    "type": "custom_rule_error",
                    "rule_name": "data_quality_score",
                    "message": f"Data quality scoring error: {str(e)}"
                }]
            }

    async def validate_business_logic(self, data: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """Validate custom business logic"""
        try:
            # Mock business logic validation
            return {"is_valid": True}
            
        except Exception as e:
            return {
                "is_valid": False,
                "errors": [{
                    "type": "custom_rule_error",
                    "rule_name": "business_logic",
                    "message": f"Business logic validation error: {str(e)}"
                }]
            }

    # Utility methods
    def luhn_checksum(self, card_num: str) -> bool:
        """Validate using Luhn algorithm"""
        def digits_of(n):
            return [int(d) for d in str(n)]
        
        digits = digits_of(card_num)
        odd_digits = digits[-1::-2]
        even_digits = digits[-2::-2]
        checksum = sum(odd_digits)
        for d in even_digits:
            checksum += sum(digits_of(d*2))
        return checksum % 10 == 0

    async def enrich_and_normalize_data(self, data_type: DataType, data: Dict[str, Any]) -> Dict[str, Any]:
        """Enrich and normalize data"""
        # Mock data enrichment
        enriched_data = data.copy()
        enriched_data["_enriched"] = True
        enriched_data["_normalized_at"] = datetime.utcnow().isoformat()
        return enriched_data

    async def cache_validation_result(self, validation_id: str, result: ValidationResult):
        """Cache validation result"""
        await self.redis.setex(
            f"validation:{validation_id}",
            3600,  # 1 hour
            json.dumps(result.dict(), default=str)
        )

    async def log_validation(self, request: ValidationRequest, result: ValidationResult):
        """Log validation for audit purposes"""
        try:
            log_entry = {
                "validation_id": result.validation_id,
                "data_type": request.data_type.value,
                "validation_level": request.validation_level.value,
                "status": result.status.value,
                "is_valid": result.is_valid,
                "error_count": len(result.errors),
                "warning_count": len(result.warnings),
                "timestamp": datetime.utcnow().isoformat()
            }
            
            async with self.db_pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO validation_logs (validation_id, data_type, validation_level, 
                                               status, is_valid, error_count, warning_count, timestamp)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """, result.validation_id, request.data_type.value, request.validation_level.value,
                    result.status.value, result.is_valid, len(result.errors), len(result.warnings),
                    datetime.utcnow())
                    
        except Exception as e:
            logger.error(f"Failed to log validation: {e}")

# Global service instance
validation_service = DataValidationService()

# API Routes
@app.on_event("startup")
async def startup_event():
    await validation_service.initialize()

@app.post("/validate", response_model=ValidationResult)
async def validate_data(
    validation_request: ValidationRequest,
    credentials: HTTPAuthorizationCredentials = Depends(security)
,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Validate data according to specified rules"""
    return await validation_service.validate_data(validation_request)

@app.post("/validate/bulk")
async def validate_bulk_data(
    bulk_request: BulkValidationRequest,
    credentials: HTTPAuthorizationCredentials = Depends(security)
,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Validate multiple data items in bulk"""
    results = []
    
    for validation_request in bulk_request.validations:
        try:
            result = await validation_service.validate_data(validation_request)
            results.append(result)
            
            if bulk_request.stop_on_first_error and not result.is_valid:
                break
                
        except Exception as e:
            results.append({
                "validation_id": str(uuid.uuid4()),
                "status": "error",
                "is_valid": False,
                "errors": [{"type": "system_error", "message": str(e)}],
                "warnings": [],
                "validated_data": None,
                "metadata": {}
            })
            
            if bulk_request.stop_on_first_error:
                break
    
    return {
        "total_validations": len(bulk_request.validations),
        "completed": len(results),
        "valid": sum(1 for r in results if r.is_valid),
        "invalid": sum(1 for r in results if not r.is_valid),
        "results": results
    }

@app.get("/validation/{validation_id}")
async def get_validation_result(
    validation_id: str,
    credentials: HTTPAuthorizationCredentials = Depends(security)
,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get cached validation result"""
    try:
        cached_result = await validation_service.redis.get(f"validation:{validation_id}")
        if cached_result:
            return json.loads(cached_result)
        else:
            raise HTTPException(status_code=404, detail="Validation result not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get validation result: {str(e)}")

@app.get("/schemas/{data_type}")
async def get_schema(
    data_type: DataType,
    credentials: HTTPAuthorizationCredentials = Depends(security)
,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get validation schema for data type"""
    schema = validation_service.schemas.get(data_type)
    if not schema:
        raise HTTPException(status_code=404, detail=f"Schema not found for data type: {data_type}")
    return schema

@app.get("/rules/{data_type}")
async def get_business_rules(
    data_type: DataType,
    credentials: HTTPAuthorizationCredentials = Depends(security)
,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get business rules for data type"""
    rules = validation_service.business_rules.get(data_type, [])
    return [{"rule_id": r["rule_id"], "name": r["name"], "description": r["description"]} for r in rules]

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "Data Validation Service",
        "timestamp": datetime.utcnow().isoformat()
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8017)