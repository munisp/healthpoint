# Good Faith Estimate (GFE) Technical Specifications and API Integration Guide

## Executive Summary

This document provides comprehensive technical specifications for Good Faith Estimate data formats, aggregator integration structures, and API connections to CMS and IDR entities based on current NSA requirements and industry standards.

## 1. Aggregator Data Format Content

### **Primary Healthcare Claims Formats**

Healthcare claims aggregators primarily use standardized EDI (Electronic Data Interchange) formats for data transmission:

#### **X12 837 Healthcare Claim Transaction Set**
- **Format Type:** ANSI ASC X12 EDI Standard
- **Versions:** 5010 (current HIPAA standard)
- **Variants:**
  - **837P:** Professional claims (physician services)
  - **837I:** Institutional claims (hospital services)
  - **837D:** Dental claims

#### **X12 835 Electronic Remittance Advice (ERA)**
- **Purpose:** Payment and remittance information
- **Integration:** Links to 837 claims for payment reconciliation

### **Data Structure Components**

**Hierarchical Structure:**
```
ISA/GS Envelope (Interchange/Group Headers)
├── ST/SE Transaction Set (837 Claim)
    ├── 1000A/B Submitter/Receiver Information
    ├── 2000A Billing Provider Hierarchical Level
    ├── 2000B Subscriber Hierarchical Level
    ├── 2000C Patient Hierarchical Level
    ├── 2300 Claim Information
    └── 2400 Service Line Information
```

**Key Data Elements:**
- Provider identifiers (NPI, taxonomy codes)
- Patient demographics and insurance information
- Diagnosis codes (ICD-10-CM)
- Procedure codes (CPT, HCPCS)
- Service dates and locations
- Charge amounts and units

## 2. GFE Embedding in Aggregator Formats

### **Is GFE Embedded in Aggregator Format?**

**Current State:** GFEs are **NOT directly embedded** in standard X12 837 claim formats because:
- GFEs are pre-service estimates, while 837s are post-service claims
- Different regulatory requirements and timing
- Separate data validation and submission processes

### **GFE Integration Approaches**

#### **Parallel Data Streams:**
- **837 Claims:** Standard post-service billing
- **GFE Data:** Separate pre-service estimate files
- **Linking Mechanism:** Common patient/service identifiers

#### **Enhanced Data Elements:**
Some aggregators are developing enhanced formats that include:
- GFE reference numbers in claim data
- Estimate vs. actual variance tracking
- NSA compliance indicators

#### **Custom API Extensions:**
- RESTful APIs for GFE data exchange
- JSON/XML formats for modern integration
- Real-time estimate generation and validation

## 3. GFE Data Structure Specification

### **Core GFE Data Elements (Based on CMS Sample)**

#### **Patient Information Section:**
```json
{
  "patient": {
    "firstName": "string",
    "middleName": "string", 
    "lastName": "string",
    "dateOfBirth": "YYYY-MM-DD",
    "accountNumber": "string (optional)",
    "mailingAddress": {
      "street": "string",
      "apartment": "string",
      "city": "string", 
      "state": "string",
      "zipCode": "string"
    },
    "phone": "string",
    "email": "string",
    "contactPreference": ["mail", "email", "phone"],
    "primaryDiagnosis": {
      "description": "string",
      "code": "ICD-10-CM code"
    },
    "secondaryDiagnosis": {
      "description": "string", 
      "code": "ICD-10-CM code"
    }
  }
}
```

#### **Primary Service Information:**
```json
{
  "primaryService": {
    "scheduledDate": "YYYY-MM-DD",
    "isScheduled": boolean,
    "serviceDescription": "string",
    "facilityType": "string"
  }
}
```

#### **Provider/Facility Estimates:**
```json
{
  "estimates": [
    {
      "providerFacilityId": "string",
      "providerName": "string",
      "npi": "string",
      "facilityType": "string",
      "services": [
        {
          "serviceDescription": "string",
          "cptCode": "string",
          "quantity": number,
          "estimatedCharge": number,
          "notes": "string"
        }
      ],
      "totalEstimatedCharges": number
    }
  ]
}
```

#### **Separately Scheduled Services:**
```json
{
  "separatelyScheduledServices": [
    {
      "serviceDescription": "string",
      "providerFacilityInstructions": "string",
      "estimatedTimeframe": "string"
    }
  ]
}
```

#### **Disclaimers and Legal Information:**
```json
{
  "disclaimers": {
    "estimateBasis": "string",
    "varianceWarning": "string", 
    "disputeRights": "string",
    "contactInformation": "string"
  }
}
```

### **Complete GFE JSON Schema Example:**
```json
{
  "gfe": {
    "gfeId": "unique-identifier",
    "conveyingProvider": {
      "npi": "string",
      "name": "string",
      "address": "object"
    },
    "creationDate": "YYYY-MM-DD",
    "expirationDate": "YYYY-MM-DD",
    "patient": { /* Patient object as above */ },
    "primaryService": { /* Primary service object as above */ },
    "estimates": [ /* Array of provider estimates as above */ ],
    "separatelyScheduledServices": [ /* Array as above */ ],
    "totalEstimatedAmount": number,
    "disclaimers": { /* Disclaimers object as above */ },
    "nsaCompliance": {
      "version": "string",
      "deliveryMethod": "string",
      "deliveryDate": "YYYY-MM-DD",
      "deliveryConfirmation": boolean
    }
  }
}
```

## 4. CMS and IDR Entity API Connections

### **Current API Landscape**

**Important Note:** CMS and IDR entities currently use **web portal interfaces** rather than public APIs for most submissions. However, technical integration is evolving.

#### **CMS Integration Points:**

**1. Patient-Provider Dispute Resolution (PPDR) Portal**
- **Access Method:** Web-based portal (no public API currently)
- **Data Format:** Form-based submission with file uploads
- **GFE Submission:** PDF or structured document upload
- **Authentication:** Provider credentials and digital certificates

**2. Federal IDR Portal**
- **Access Method:** Secure web portal
- **Data Format:** Structured forms with supporting documentation
- **Integration:** Limited to portal-based submissions
- **File Formats:** PDF, Excel, structured text files

**3. CMS Data Reporting**
- **Method:** Periodic bulk data submissions
- **Format:** CSV, Excel, or structured text files
- **Frequency:** Monthly/quarterly reporting cycles
- **Content:** Aggregate statistics and compliance metrics

### **Emerging API Development**

#### **Planned Technical Enhancements:**
- **RESTful API Development:** CMS is exploring API-based submissions
- **FHIR Integration:** Potential adoption of HL7 FHIR standards
- **Real-time Validation:** API endpoints for data validation
- **Automated Reporting:** Programmatic submission of compliance data

#### **Current Workaround Solutions:**

**1. Screen Scraping and RPA:**
- Robotic Process Automation for portal interactions
- Automated form filling and submission
- Document upload automation

**2. Batch File Processing:**
- Scheduled bulk uploads to CMS portals
- Automated file generation and submission
- Error handling and retry mechanisms

**3. Third-Party Integration Services:**
- Clearinghouse services for CMS submissions
- Aggregator platforms with CMS connectivity
- Compliance management services

### **Technical Implementation Approach**

#### **Platform Integration Architecture:**
```
NSA/IDR Platform
├── GFE Management Service
│   ├── GFE Generation Engine
│   ├── Multi-Provider Coordination
│   └── Accuracy Tracking
├── CMS Integration Layer
│   ├── PPDR Portal Interface
│   ├── Automated Submission Service
│   └── Compliance Reporting
├── IDR Entity Interface
│   ├── Dispute Case Management
│   ├── Evidence Submission
│   └── Outcome Tracking
└── Data Transformation Layer
    ├── X12 EDI Processing
    ├── JSON/XML Conversion
    └── Format Validation
```

#### **API Integration Specifications:**

**1. GFE Service API (Internal):**
```
POST /api/v1/gfe/generate
GET /api/v1/gfe/{gfeId}
PUT /api/v1/gfe/{gfeId}/update
POST /api/v1/gfe/{gfeId}/submit
GET /api/v1/gfe/compliance-report
```

**2. CMS Integration Service:**
```
POST /api/v1/cms/ppdr/submit
GET /api/v1/cms/submission-status/{submissionId}
POST /api/v1/cms/compliance/report
GET /api/v1/cms/validation/gfe
```

**3. IDR Entity Interface:**
```
POST /api/v1/idr/dispute/initiate
PUT /api/v1/idr/dispute/{disputeId}/evidence
GET /api/v1/idr/dispute/{disputeId}/status
POST /api/v1/idr/entity/data-submission
```

### **Security and Authentication Requirements**

#### **CMS Portal Access:**
- **Digital Certificates:** X.509 certificates for provider authentication
- **Multi-Factor Authentication:** Required for portal access
- **Encryption:** TLS 1.3 for data transmission
- **Audit Logging:** Comprehensive access and submission logging

#### **Data Protection:**
- **HIPAA Compliance:** PHI encryption and access controls
- **Data Retention:** Regulatory-compliant storage periods
- **Backup and Recovery:** Secure data backup procedures
- **Incident Response:** Security breach notification protocols

## 5. Implementation Recommendations

### **Phase 1: Current State Integration**
- Implement web portal automation for CMS submissions
- Develop GFE generation and management capabilities
- Create data transformation layers for format conversion
- Establish compliance monitoring and reporting

### **Phase 2: Enhanced Integration**
- Monitor CMS API development and participate in pilot programs
- Implement FHIR-based data exchange capabilities
- Develop real-time validation and submission services
- Enhance automation and error handling

### **Phase 3: Future State**
- Full API integration with CMS and IDR entities
- Real-time data exchange and validation
- Advanced analytics and predictive capabilities
- Comprehensive automation of compliance processes

## Conclusion

The current technical landscape for GFE and NSA compliance requires a hybrid approach combining traditional EDI formats, web portal integration, and emerging API technologies. The NSA/IDR Healthcare Platform must be designed with flexibility to adapt to evolving technical requirements while maintaining robust compliance and data integrity capabilities.
