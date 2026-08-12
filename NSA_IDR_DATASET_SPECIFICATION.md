# NSA/IDR Dataset Specification and Format Requirements

## Overview

The NSA/IDR Healthcare Claims Platform supports comprehensive dataset formats for No Surprises Act Independent Dispute Resolution submissions. This document outlines the required data structures, supported file formats, and validation requirements.

## Supported File Formats

### Primary Formats
- **CSV (Comma-Separated Values)** - Primary format for bulk submissions
- **Excel (.xlsx, .xls)** - Microsoft Excel format support
- **JSON** - API-based submissions
- **XML** - Healthcare industry standard format
- **EDI X12** - Electronic Data Interchange format
- **FHIR R4** - Fast Healthcare Interoperability Resources

### File Size Limits
- **Maximum File Size**: 50MB per upload
- **Maximum Records**: 10,000 records per batch
- **Compression**: ZIP, GZIP supported for large datasets

## NSA/IDR Dataset Schema

### Required Fields

| Field Name | Data Type | Max Length | Required | Description |
|------------|-----------|------------|----------|-------------|
| `claim_id` | String | 50 | Yes | Unique claim identifier |
| `provider_npi` | String | 10 | Yes | National Provider Identifier |
| `provider_name` | String | 255 | Yes | Healthcare provider name |
| `provider_tax_id` | String | 20 | Yes | Provider tax identification |
| `aggregator_id` | String | 50 | Yes | Aggregator identifier |
| `patient_id` | String | 50 | Yes | Patient identifier (anonymized) |
| `service_date` | Date | - | Yes | Date of service (YYYY-MM-DD) |
| `dispute_amount` | Decimal | 15,2 | Yes | Disputed amount in USD |
| `billed_amount` | Decimal | 15,2 | Yes | Original billed amount |
| `paid_amount` | Decimal | 15,2 | No | Amount paid by insurance |
| `dispute_type` | String | 50 | Yes | Type of dispute (see enum) |
| `service_code` | String | 10 | Yes | CPT/HCPCS procedure code |
| `diagnosis_code` | String | 10 | Yes | ICD-10 diagnosis code |
| `place_of_service` | String | 2 | Yes | Place of service code |
| `insurance_type` | String | 50 | Yes | Insurance plan type |
| `network_status` | String | 20 | Yes | In-network/Out-of-network |
| `emergency_indicator` | Boolean | - | Yes | Emergency service flag |
| `idr_entity_preference` | String | 100 | No | Preferred IDR entity |
| `supporting_documents` | Array | - | No | Document references |
| `submission_date` | DateTime | - | Yes | Submission timestamp |
| `priority_level` | String | 10 | Yes | High/Medium/Low |

### Dispute Type Enumeration
- `OUT_OF_NETWORK` - Out-of-network provider dispute
- `BALANCE_BILLING` - Balance billing dispute
- `EMERGENCY_SERVICES` - Emergency services dispute
- `ANCILLARY_SERVICES` - Ancillary services dispute
- `AIR_AMBULANCE` - Air ambulance services dispute

### Network Status Enumeration
- `IN_NETWORK` - Provider is in-network
- `OUT_OF_NETWORK` - Provider is out-of-network
- `UNKNOWN` - Network status unknown

### Insurance Type Enumeration
- `COMMERCIAL` - Commercial insurance
- `MEDICARE_ADVANTAGE` - Medicare Advantage
- `MEDICAID_MANAGED` - Medicaid Managed Care
- `SELF_INSURED` - Self-insured employer plan
- `OTHER` - Other insurance types

## Sample NSA/IDR Dataset

### CSV Format Example
```csv
claim_id,provider_npi,provider_name,provider_tax_id,aggregator_id,patient_id,service_date,dispute_amount,billed_amount,paid_amount,dispute_type,service_code,diagnosis_code,place_of_service,insurance_type,network_status,emergency_indicator,idr_entity_preference,priority_level,submission_date
CLM-2024-001,1234567890,"Metro Emergency Center","12-3456789","AGG-001","PAT-001","2024-01-15",2500.00,3500.00,1000.00,"EMERGENCY_SERVICES","99285","R06.02","23","COMMERCIAL","OUT_OF_NETWORK",true,"Healthcare Resolution LLC","HIGH","2024-01-20T10:30:00Z"
CLM-2024-002,2345678901,"City General Hospital","23-4567890","AGG-001","PAT-002","2024-01-18",1250.00,1750.00,500.00,"OUT_OF_NETWORK","99213","Z00.00","11","MEDICARE_ADVANTAGE","OUT_OF_NETWORK",false,"Medical Dispute Services","MEDIUM","2024-01-20T10:31:00Z"
CLM-2024-003,3456789012,"Suburban Clinic","34-5678901","AGG-002","PAT-003","2024-01-20",850.00,1200.00,350.00,"BALANCE_BILLING","99214","M79.3","11","COMMERCIAL","IN_NETWORK",false,"Independent Medical Review","LOW","2024-01-20T10:32:00Z"
```

### JSON Format Example
```json
{
  "submission_batch": {
    "batch_id": "BATCH-2024-001",
    "aggregator_id": "AGG-001",
    "submission_date": "2024-01-20T10:30:00Z",
    "total_claims": 3,
    "claims": [
      {
        "claim_id": "CLM-2024-001",
        "provider_npi": "1234567890",
        "provider_name": "Metro Emergency Center",
        "provider_tax_id": "12-3456789",
        "aggregator_id": "AGG-001",
        "patient_id": "PAT-001",
        "service_date": "2024-01-15",
        "dispute_amount": 2500.00,
        "billed_amount": 3500.00,
        "paid_amount": 1000.00,
        "dispute_type": "EMERGENCY_SERVICES",
        "service_code": "99285",
        "diagnosis_code": "R06.02",
        "place_of_service": "23",
        "insurance_type": "COMMERCIAL",
        "network_status": "OUT_OF_NETWORK",
        "emergency_indicator": true,
        "idr_entity_preference": "Healthcare Resolution LLC",
        "priority_level": "HIGH",
        "supporting_documents": [
          {
            "document_type": "MEDICAL_RECORDS",
            "document_id": "DOC-001",
            "file_name": "patient_records.pdf"
          }
        ]
      }
    ]
  }
}
```

### FHIR R4 Format Example
```json
{
  "resourceType": "Bundle",
  "id": "nsa-idr-submission-001",
  "type": "collection",
  "entry": [
    {
      "resource": {
        "resourceType": "Claim",
        "id": "CLM-2024-001",
        "status": "active",
        "type": {
          "coding": [
            {
              "system": "http://terminology.hl7.org/CodeSystem/claim-type",
              "code": "professional"
            }
          ]
        },
        "patient": {
          "reference": "Patient/PAT-001"
        },
        "provider": {
          "reference": "Organization/PROV-1234567890"
        },
        "priority": {
          "coding": [
            {
              "system": "http://terminology.hl7.org/CodeSystem/processpriority",
              "code": "urgent"
            }
          ]
        },
        "total": {
          "value": 2500.00,
          "currency": "USD"
        }
      }
    }
  ]
}
```

## Validation Rules

### NSA Compliance Validation
1. **Service Date Validation**: Must be within NSA effective date range (January 1, 2022 onwards)
2. **Dispute Amount Validation**: Must not exceed federal NSA limits
3. **Provider Network Status**: Must be properly classified
4. **Emergency Services**: Must include emergency indicator for applicable services
5. **Timeline Compliance**: Must be within 30-day negotiation period

### Data Quality Validation
1. **NPI Validation**: 10-digit NPI must pass Luhn algorithm check
2. **Tax ID Format**: Must follow valid tax ID patterns
3. **CPT Code Validation**: Must be valid current CPT codes
4. **ICD-10 Validation**: Must be valid ICD-10 diagnosis codes
5. **Date Format**: ISO 8601 format required (YYYY-MM-DD)
6. **Amount Validation**: Must be positive numbers with 2 decimal places

### Business Rule Validation
1. **Duplicate Detection**: No duplicate claim IDs within batch
2. **Provider-Aggregator Mapping**: Provider must be assigned to specified aggregator
3. **Insurance Type Consistency**: Must match provider network agreements
4. **Service Code Compatibility**: Service code must match place of service
5. **Emergency Service Rules**: Emergency services must have appropriate place of service codes

## Error Handling and Reporting

### Error Categories
- **CRITICAL**: Prevents processing (missing required fields, invalid formats)
- **WARNING**: Allows processing but requires attention (unusual amounts, missing optional fields)
- **INFO**: Informational messages (successful validations, processing updates)

### Error Response Format
```json
{
  "validation_results": {
    "total_records": 150,
    "valid_records": 142,
    "invalid_records": 8,
    "warnings": 3,
    "errors": [
      {
        "row": 5,
        "field": "provider_npi",
        "error_code": "INVALID_NPI_FORMAT",
        "message": "NPI must be 10 digits",
        "severity": "CRITICAL"
      },
      {
        "row": 12,
        "field": "dispute_amount",
        "error_code": "AMOUNT_EXCEEDS_NSA_LIMIT",
        "message": "Dispute amount exceeds federal NSA limits",
        "severity": "CRITICAL"
      }
    ],
    "warnings": [
      {
        "row": 8,
        "field": "dispute_amount",
        "warning_code": "HIGH_DISPUTE_AMOUNT",
        "message": "Dispute amount is unusually high for this service type",
        "severity": "WARNING"
      }
    ]
  }
}
```

## Integration Specifications

### API Endpoints
- `POST /api/v1/nsa-idr/bulk-upload` - Bulk file upload
- `GET /api/v1/nsa-idr/validation-schema` - Get validation schema
- `POST /api/v1/nsa-idr/validate` - Validate dataset without submission
- `GET /api/v1/nsa-idr/submission/{batch_id}/status` - Get submission status

### Webhook Notifications
- Real-time status updates via webhooks
- Configurable notification endpoints per aggregator
- Retry logic for failed webhook deliveries

This comprehensive dataset specification ensures full NSA/IDR compliance while providing flexibility for various healthcare data formats and integration requirements.
