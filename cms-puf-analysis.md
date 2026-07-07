# CMS Federal IDR PUF Data Structure Analysis

**Source:** CMS Federal Independent Dispute Resolution Public Use Files General Information  
**Document:** https://www.cms.gov/files/document/federal-idr-puf-general-information.pdf  
**Analysis Date:** October 9, 2025

## Key Findings from CMS PUF Documentation

### 1. PUF File Structure Overview

The Federal IDR PUF consists of **three separate tabs**:

1. **Payment Determinations Outcomes Data: OON Emergency and Non-Emergency Items and Services**
   - Line-item level data on payment determinations for OON emergency and non-emergency items
   - Data available: 2023 Q1-Q4, 2024 Q1-Q4

2. **Payment Determinations Outcomes Data: OON Air Ambulance Services**
   - Line-item level data on payment determinations for OON air ambulance services
   - Data available: 2023 Q1-Q4, 2024 Q1-Q4

3. **QPA and Offers Data**
   - Line-item level data on offer amounts and qualifying payment amounts (QPAs)
   - Data available: 2023 Q1-Q4, 2024 Q1-Q4

### 2. Data Granularity and Structure

**Critical Finding:** Data is provided at the **line-item level**
- Single disputes have one line item per dispute
- Bundled disputes may have multiple line items per dispute
- Each line item represents a specific item or service under dispute

**Data Collection Levels:**
- Some variables collected at **dispute level** (same for all line items in dispute)
- Other variables collected at **line-item level** (specific to each service)
- Users must refer to data dictionary for variable level explanations

### 3. Data Source and Timing

**Data Source:** Federal IDR portal submissions by:
- Disputing parties (providers, facilities, health plans)
- Certified IDR entities (arbitrators)

**Reporting Timeline:**
- 2023 IDR PUF: Q1 & Q2 generated 08/31/2023, Q3 & Q4 generated 03/04/2024
- 2024 IDR PUF: Q1 & Q2 generated 12/6/2024, Q3 & Q4 generated 03/18/2025

**Data Lag:** Disputes closed during quarter, with reporting lag for processing

### 4. Key Data Elements (Based on Visible Content)

**Dispute-Level Variables:**
- Initiating party information
- Dispute outcome (eligible/ineligible, payment determination)
- IDR entity information
- Geographic information

**Line-Item Level Variables:**
- Service/item codes
- Offer amounts (provider and payer)
- Qualifying Payment Amount (QPA)
- Payment determination amounts
- Service-specific details

### 5. Data Quality and Limitations

**Exclusions from PUF:**
- Ineligible disputes
- Disputes withdrawn by parties
- Disputes excluded for administrative reasons
- Very small number of disputes with reporting lags

**Bundling Considerations:**
- Single payment to one provider/facility for multiple items must be bundled
- Batched disputes have multiple line items representing multiple services
- Bundled service codes used for grouped services

## Platform Support Assessment

### Current Platform Gaps Identified:

1. **Line-Item Level Processing**
   - Our platform may not fully support line-item granularity
   - Need to handle both single and bundled dispute structures

2. **Multi-Tab Data Integration**
   - Platform should integrate all three PUF tabs
   - Emergency/Non-Emergency vs Air Ambulance separation needed

3. **Variable-Level Data Handling**
   - Need to distinguish dispute-level vs line-item level variables
   - Data dictionary integration required

4. **Temporal Data Management**
   - Quarterly reporting cycles need to be supported
   - Data lag considerations for real-time analytics

### Recommendations for Platform Enhancement:

1. **Implement Line-Item Data Model**
2. **Add Multi-Tab PUF Import Capability**
3. **Enhance Variable-Level Processing**
4. **Improve Temporal Data Handling**
5. **Add Data Dictionary Integration**

## Next Steps

1. Download actual PUF files to analyze detailed variable structure
2. Review data dictionary for complete field definitions
3. Assess platform data model compatibility
4. Implement necessary schema updates
5. Test with real PUF data imports
