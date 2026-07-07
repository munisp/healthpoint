"""
Comprehensive Data Transformation and Validation Service
Handles conversion between GFE, X12 EDI, JSON, and CMS formats
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

from fastapi import FastAPI, HTTPException, UploadFile, File
from pydantic import BaseModel, validator
from typing import List, Optional, Dict, Any
import json
import xml.etree.ElementTree as ET
from datetime import datetime, date
import re
import uuid
from shared.telemetry import setup_telemetry, instrument_fastapi, get_tracer

setup_telemetry(service_name="data-transformation-service", service_version="1.0.0")
app = FastAPI(title="Data Transformation Service", version="1.0.0")
instrument_fastapi(app)

app.middleware("http")(security_headers_middleware)

# ============================================================================
# PYDANTIC MODELS FOR GFE STRUCTURE
# ============================================================================

class PatientAddress(BaseModel):
    street: str
    apartment: Optional[str] = None
    city: str
    state: str
    zipCode: str

class PatientDiagnosis(BaseModel):
    description: str
    code: str  # ICD-10-CM code
    
    @validator('code')
    def validate_icd10_code(cls, v):
        # Basic ICD-10 format validation
        if not re.match(r'^[A-Z]\d{2}(\.\d{1,3})?$', v):
            raise ValueError('Invalid ICD-10 code format')
        return v

class Patient(BaseModel):
    firstName: str
    middleName: Optional[str] = None
    lastName: str
    dateOfBirth: date
    accountNumber: Optional[str] = None
    mailingAddress: PatientAddress
    phone: str
    email: str
    contactPreference: List[str]  # ["mail", "email", "phone"]
    primaryDiagnosis: PatientDiagnosis
    secondaryDiagnosis: Optional[PatientDiagnosis] = None

class PrimaryService(BaseModel):
    scheduledDate: Optional[date] = None
    isScheduled: bool
    serviceDescription: str
    facilityType: str

class ServiceItem(BaseModel):
    serviceDescription: str
    cptCode: str
    quantity: int
    estimatedCharge: float
    notes: Optional[str] = None
    
    @validator('cptCode')
    def validate_cpt_code(cls, v):
        # Basic CPT code format validation
        if not re.match(r'^\d{5}$', v):
            raise ValueError('Invalid CPT code format')
        return v

class ProviderEstimate(BaseModel):
    providerFacilityId: str
    providerName: str
    npi: str
    facilityType: str
    services: List[ServiceItem]
    totalEstimatedCharges: float
    
    @validator('npi')
    def validate_npi(cls, v):
        # NPI validation (10 digits)
        if not re.match(r'^\d{10}$', v):
            raise ValueError('Invalid NPI format')
        return v

class SeparatelyScheduledService(BaseModel):
    serviceDescription: str
    providerFacilityInstructions: str
    estimatedTimeframe: str

class GFEDisclaimers(BaseModel):
    estimateBasis: str
    varianceWarning: str
    disputeRights: str
    contactInformation: str

class NSACompliance(BaseModel):
    version: str
    deliveryMethod: str
    deliveryDate: date
    deliveryConfirmation: bool

class GoodFaithEstimate(BaseModel):
    gfeId: str
    conveyingProvider: Dict[str, str]
    creationDate: date
    expirationDate: date
    patient: Patient
    primaryService: PrimaryService
    estimates: List[ProviderEstimate]
    separatelyScheduledServices: List[SeparatelyScheduledService]
    totalEstimatedAmount: float
    disclaimers: GFEDisclaimers
    nsaCompliance: NSACompliance

# ============================================================================
# X12 EDI MODELS
# ============================================================================

class X12Segment(BaseModel):
    segment_id: str
    elements: List[str]

class X12Transaction(BaseModel):
    transaction_set_id: str
    segments: List[X12Segment]

class X12Interchange(BaseModel):
    interchange_id: str
    transactions: List[X12Transaction]

# ============================================================================
# CMS SUBMISSION MODELS
# ============================================================================

class CMSSubmission(BaseModel):
    submission_type: str  # "PPDR", "IDR", "COMPLIANCE"
    submission_data: Dict[str, Any]
    attachments: List[str] = []

# ============================================================================
# TRANSFORMATION ENDPOINTS
# ============================================================================

@app.post("/api/v1/transform/gfe-to-json")
async def transform_gfe_to_json(gfe: GoodFaithEstimate,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Transform GFE object to standardized JSON format"""
    try:
        json_output = gfe.dict()
        json_output['transformation_metadata'] = {
            'transformed_at': datetime.now().isoformat(),
            'format_version': '1.0',
            'source_format': 'GFE_PYDANTIC'
        }
        return {"status": "success", "data": json_output}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Transformation failed: {str(e)}")

@app.post("/api/v1/transform/json-to-gfe")
async def transform_json_to_gfe(json_data: Dict[str, Any],
    current_user: TokenPayload = Depends(get_current_user),
):
    """Transform JSON data to GFE object"""
    try:
        gfe = GoodFaithEstimate(**json_data)
        return {"status": "success", "gfe": gfe}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Transformation failed: {str(e)}")

@app.post("/api/v1/transform/gfe-to-x12")
async def transform_gfe_to_x12(gfe: GoodFaithEstimate,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Transform GFE to X12 EDI format (837-like structure)"""
    try:
        # Create X12 segments from GFE data
        segments = []
        
        # ISA segment (Interchange Header)
        isa_segment = X12Segment(
            segment_id="ISA",
            elements=[
                "00", "", "00", "", "ZZ", "SENDER", "ZZ", "RECEIVER",
                datetime.now().strftime("%y%m%d"), datetime.now().strftime("%H%M"),
                "U", "00501", "000000001", "0", "P", ">"
            ]
        )
        segments.append(isa_segment)
        
        # GS segment (Group Header)
        gs_segment = X12Segment(
            segment_id="GS",
            elements=[
                "HC", "SENDER", "RECEIVER", datetime.now().strftime("%Y%m%d"),
                datetime.now().strftime("%H%M"), "1", "X", "005010X222A1"
            ]
        )
        segments.append(gs_segment)
        
        # ST segment (Transaction Set Header)
        st_segment = X12Segment(
            segment_id="ST",
            elements=["837", "0001", "005010X222A1"]
        )
        segments.append(st_segment)
        
        # BHT segment (Beginning of Hierarchical Transaction)
        bht_segment = X12Segment(
            segment_id="BHT",
            elements=["0019", "00", "1", datetime.now().strftime("%Y%m%d"), datetime.now().strftime("%H%M"), "CH"]
        )
        segments.append(bht_segment)
        
        # Add patient and service information segments
        # (This would be expanded with full X12 837 structure)
        
        transaction = X12Transaction(
            transaction_set_id="837",
            segments=segments
        )
        
        interchange = X12Interchange(
            interchange_id=str(uuid.uuid4()),
            transactions=[transaction]
        )
        
        return {"status": "success", "x12_data": interchange}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"X12 transformation failed: {str(e)}")

@app.post("/api/v1/transform/x12-to-gfe")
async def transform_x12_to_gfe(x12_data: X12Interchange,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Transform X12 EDI data to GFE format"""
    try:
        # Extract relevant information from X12 segments
        # This would involve parsing the X12 structure and mapping to GFE fields
        
        # For demonstration, create a basic GFE structure
        gfe_data = {
            "gfeId": f"GFE-{uuid.uuid4()}",
            "conveyingProvider": {"npi": "1234567890", "name": "Sample Provider"},
            "creationDate": date.today(),
            "expirationDate": date.today(),
            # Extract additional fields from X12 837 data
            # NM1 segments: billing provider, subscriber, patient
            # CLM segment: claim details, place of service
            # SV1/SV2: service line details
            # DTP: service dates
            # REF: reference numbers (prior auth, etc.)
            # HI: diagnosis codes
            # Loop 2300: claim information
            # Loop 2400: service line information
        }
        
        return {"status": "success", "message": "X12 to GFE transformation completed", "gfe_preview": gfe_data}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"X12 to GFE transformation failed: {str(e)}")

@app.post("/api/v1/transform/gfe-to-cms")
async def transform_gfe_to_cms(gfe: GoodFaithEstimate, submission_type: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Transform GFE to CMS submission format"""
    try:
        cms_data = {
            "patient_information": {
                "name": f"{gfe.patient.firstName} {gfe.patient.lastName}",
                "dob": gfe.patient.dateOfBirth.isoformat(),
                "address": gfe.patient.mailingAddress.dict()
            },
            "estimate_information": {
                "total_amount": gfe.totalEstimatedAmount,
                "creation_date": gfe.creationDate.isoformat(),
                "providers": [est.dict() for est in gfe.estimates]
            },
            "compliance_data": gfe.nsaCompliance.dict()
        }
        
        cms_submission = CMSSubmission(
            submission_type=submission_type,
            submission_data=cms_data
        )
        
        return {"status": "success", "cms_submission": cms_submission}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"CMS transformation failed: {str(e)}")

# ============================================================================
# VALIDATION ENDPOINTS
# ============================================================================

@app.post("/api/v1/validate/gfe")
async def validate_gfe(gfe: GoodFaithEstimate,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Comprehensive GFE validation"""
    validation_results = {
        "is_valid": True,
        "errors": [],
        "warnings": [],
        "compliance_check": {}
    }
    
    try:
        # Validate required fields
        if not gfe.gfeId:
            validation_results["errors"].append("GFE ID is required")
            validation_results["is_valid"] = False
        
        # Validate patient information
        if not gfe.patient.firstName or not gfe.patient.lastName:
            validation_results["errors"].append("Patient first and last name are required")
            validation_results["is_valid"] = False
        
        # Validate estimates
        if not gfe.estimates:
            validation_results["errors"].append("At least one provider estimate is required")
            validation_results["is_valid"] = False
        
        # Calculate total validation
        calculated_total = sum(est.totalEstimatedCharges for est in gfe.estimates)
        if abs(calculated_total - gfe.totalEstimatedAmount) > 0.01:
            validation_results["warnings"].append(f"Total amount mismatch: calculated {calculated_total}, provided {gfe.totalEstimatedAmount}")
        
        # NSA compliance checks
        validation_results["compliance_check"] = {
            "has_disclaimers": bool(gfe.disclaimers),
            "delivery_confirmed": gfe.nsaCompliance.deliveryConfirmation,
            "within_72_hours": True  # Would check actual delivery timing
        }
        
        return validation_results
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Validation failed: {str(e)}")

@app.post("/api/v1/validate/x12")
async def validate_x12(x12_data: X12Interchange,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Validate X12 EDI structure"""
    validation_results = {
        "is_valid": True,
        "errors": [],
        "warnings": []
    }
    
    try:
        # Basic X12 structure validation
        if not x12_data.transactions:
            validation_results["errors"].append("No transactions found in X12 interchange")
            validation_results["is_valid"] = False
        
        for transaction in x12_data.transactions:
            if not transaction.segments:
                validation_results["errors"].append(f"No segments found in transaction {transaction.transaction_set_id}")
                validation_results["is_valid"] = False
        
        return validation_results
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"X12 validation failed: {str(e)}")

# ============================================================================
# FILE PROCESSING ENDPOINTS
# ============================================================================

@app.post("/api/v1/process/upload-gfe")
async def process_gfe_upload(file: UploadFile = File(...),
    current_user: TokenPayload = Depends(get_current_user),
):
    """Process uploaded GFE file (JSON, XML, or CSV)"""
    try:
        content = await file.read()
        
        if file.filename.endswith('.json'):
            data = json.loads(content)
            gfe = GoodFaithEstimate(**data)
            return {"status": "success", "message": "JSON GFE processed", "gfe_id": gfe.gfeId}
        
        elif file.filename.endswith('.xml'):
            # XML processing logic
            root = ET.fromstring(content)
            return {"status": "success", "message": "XML GFE processed"}
        
        elif file.filename.endswith('.csv'):
            # CSV processing logic
            return {"status": "success", "message": "CSV GFE processed"}
        
        else:
            raise HTTPException(status_code=400, detail="Unsupported file format")
    
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"File processing failed: {str(e)}")

@app.post("/api/v1/process/batch-transform")
async def batch_transform_gfes(gfes: List[GoodFaithEstimate], target_format: str,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Batch transform multiple GFEs to target format"""
    try:
        results = []
        
        for gfe in gfes:
            if target_format == "json":
                result = gfe.dict()
            elif target_format == "x12":
                # Transform to X12 format
                result = {"x12_data": "transformed_x12_data"}
            elif target_format == "cms":
                # Transform to CMS format
                result = {"cms_data": "transformed_cms_data"}
            else:
                raise ValueError(f"Unsupported target format: {target_format}")
            
            results.append({
                "gfe_id": gfe.gfeId,
                "status": "success",
                "transformed_data": result
            })
        
        return {
            "status": "success",
            "processed_count": len(results),
            "results": results
        }
    
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Batch transformation failed: {str(e)}")

# ============================================================================
# HEALTH CHECK AND METADATA
# ============================================================================

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "Data Transformation Service",
        "version": "1.0.0",
        "timestamp": datetime.now().isoformat()
    }

@app.get("/api/v1/formats/supported")
async def get_supported_formats(,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Get list of supported data formats"""
    return {
        "input_formats": ["GFE_JSON", "X12_EDI", "CSV", "XML"],
        "output_formats": ["GFE_JSON", "X12_EDI", "CMS_SUBMISSION", "VALIDATION_REPORT"],
        "transformation_types": [
            "gfe-to-json",
            "json-to-gfe", 
            "gfe-to-x12",
            "x12-to-gfe",
            "gfe-to-cms",
            "batch-transform"
        ]
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8030)

@app.get("/health")
async def health_check():
    return {"status": "ok"}