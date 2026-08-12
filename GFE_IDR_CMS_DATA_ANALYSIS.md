# Good Faith Estimate (GFE) Role in IDR Disputes and CMS Data Requirements

## Executive Summary

Based on research of current CMS guidance and No Surprises Act requirements, this document outlines the critical role of Good Faith Estimates in the Independent Dispute Resolution (IDR) process and the specific data submission requirements to CMS and IDR entities.

## 1. GFE Submission in IDR Disputes

### **Does the Aggregator Submit GFE as Part of the Dispute?**

**YES - GFEs are submitted as evidence in specific dispute scenarios:**

#### **Provider-Plan IDR Disputes:**
- **GFEs are NOT directly submitted** in provider-plan IDR disputes
- Provider-plan disputes focus on **Qualifying Payment Amount (QPA)** vs. provider charges
- GFEs may be referenced as **supporting evidence** for cost justification

#### **Patient-Provider Dispute Resolution (PPDR):**
- **GFEs are REQUIRED** as primary evidence in PPDR cases
- **Trigger Threshold:** Patient can dispute if billed $400+ over the GFE amount
- **Evidence Role:** GFE serves as baseline for determining billing accuracy
- **Submission Process:** Patient submits GFE along with actual bill for comparison

### **Aggregator Role in GFE Submission:**
- **Claims Aggregators** may submit GFEs on behalf of providers in PPDR cases
- **IDR Entities** receive GFEs as part of evidence packages
- **CMS Portal** requires GFE upload for certain dispute types

## 2. GFE Data Sources and Derivation

### **Where is the GFE Derived From?**

#### **Primary Data Sources:**
1. **Provider Fee Schedules**
   - Internal pricing structures
   - Contracted rates with other payers
   - Historical charge data

2. **Facility Charges**
   - Hospital/facility fees
   - Equipment and room charges
   - Ancillary service costs

3. **Co-Provider Coordination**
   - Anesthesia provider rates
   - Radiology/pathology charges
   - Consulting physician fees

4. **Geographic Adjustments**
   - Regional cost variations
   - Market-specific pricing
   - Local wage indices

#### **Calculation Methodology:**
- **Convening Provider** coordinates multi-provider estimates
- **Standard Charges** from hospital price transparency files
- **Historical Data** from similar procedures/services
- **Payer Mix Analysis** for uninsured/self-pay rates

## 3. CMS Expectations for GFE Submission

### **Does CMS Expect GFE Submission?**

**YES - CMS has specific GFE submission requirements:**

#### **Direct CMS Submission:**
- **PPDR Cases:** GFEs submitted through CMS PPDR portal
- **Compliance Monitoring:** Random audits may request GFE documentation
- **Quality Reporting:** GFE accuracy metrics for provider performance

#### **IDR Entity Submission:**
- **Evidence Packages:** IDR entities collect GFEs for relevant disputes
- **Decision Documentation:** GFEs included in arbitration records
- **Reporting Requirements:** IDR entities report GFE-related dispute outcomes

#### **Public Reporting:**
- **Aggregate Data:** CMS publishes GFE accuracy statistics
- **Transparency Reports:** Provider-level GFE compliance metrics
- **Trend Analysis:** GFE variance patterns by specialty/region

## 4. Datasets Submitted to CMS and IDR Entities

### **CMS Data Submission Requirements:**

#### **Provider-Level Data:**
```
- Provider NPI and taxonomy
- GFE generation volume and frequency
- Estimate accuracy rates vs. actual charges
- Variance analysis (over/under estimates)
- Compliance with 72-hour delivery requirement
- Patient notification methods and delivery confirmation
```

#### **Dispute-Related Data:**
```
- PPDR case volumes and outcomes
- GFE variance amounts triggering disputes
- Resolution timeframes and methods
- Patient satisfaction scores
- Provider response rates to disputes
```

#### **Financial Data:**
```
- Total estimated amounts in GFEs
- Actual billed amounts vs. estimates
- Collection rates for GFE-covered services
- Bad debt related to GFE variances
- Charity care provided post-GFE disputes
```

### **IDR Entity Data Submission Requirements:**

#### **Case Management Data:**
```
- Dispute initiation details and parties
- Evidence submitted (including GFEs when applicable)
- Arbitration timeline and milestones
- Decision rationale and supporting factors
- Payment determination amounts
```

#### **Operational Metrics:**
```
- Case processing times by dispute type
- Arbitrator assignment and conflict disclosures
- Communication logs between parties
- Technical platform usage statistics
- Quality assurance and audit results
```

#### **Financial Reporting:**
```
- Disputed amounts by case type
- Final payment determinations
- Fee collections from disputing parties
- Administrative costs and efficiency metrics
- Payment compliance and enforcement actions
```

### **Public Use File (PUF) Data Elements:**

#### **CMS Publishes Aggregate Data:**
```
- Total IDR cases by state and specialty
- Average disputed amounts and final determinations
- Case resolution timeframes
- Provider and plan participation rates
- GFE-related dispute outcomes (when applicable)
```

## 5. Platform Integration Requirements

### **NSA/IDR Healthcare Platform Data Flows:**

#### **GFE Management System:**
- **Generation Tracking:** Monitor GFE creation and delivery
- **Accuracy Monitoring:** Compare estimates to actual charges
- **Dispute Integration:** Link GFEs to PPDR cases
- **CMS Reporting:** Automated data submission to CMS

#### **IDR Case Management:**
- **Evidence Collection:** Gather GFEs for relevant disputes
- **Data Submission:** Submit required datasets to IDR entities
- **Outcome Tracking:** Monitor dispute resolutions and payments
- **Compliance Reporting:** Ensure timely data submission to CMS

#### **Analytics and Reporting:**
- **Performance Metrics:** GFE accuracy and compliance rates
- **Trend Analysis:** Dispute patterns and resolution outcomes
- **Regulatory Reporting:** Automated CMS and IDR entity submissions
- **Quality Improvement:** Identify areas for GFE accuracy enhancement

## 6. Compliance Considerations

### **Key Requirements:**
- **72-Hour Rule:** GFEs must be provided at least 3 business days before service
- **$400 Threshold:** Patients can dispute bills exceeding GFE by $400+
- **30-Day Reporting:** IDR entities must submit data within 30 business days
- **Public Transparency:** CMS publishes aggregate dispute and GFE data

### **Risk Management:**
- **Accurate GFEs:** Reduce dispute risk through precise estimates
- **Documentation:** Maintain comprehensive GFE and dispute records
- **Timely Submission:** Ensure compliance with CMS reporting deadlines
- **Quality Assurance:** Regular audits of GFE accuracy and dispute outcomes

## Conclusion

Good Faith Estimates play a crucial role in the NSA/IDR ecosystem, serving as both a patient protection mechanism and a key data element in dispute resolution processes. The platform must ensure comprehensive GFE management, accurate data collection, and timely submission to CMS and IDR entities to maintain compliance and support effective dispute resolution.
