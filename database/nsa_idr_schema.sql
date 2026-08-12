-- NSA/IDR Database Schema
-- Tables for No Surprises Act Independent Dispute Resolution

-- NSA Disputes table
CREATE TABLE IF NOT EXISTS nsa_disputes (
    dispute_id VARCHAR(255) PRIMARY KEY,
    initiating_party JSONB NOT NULL,
    non_initiating_party JSONB NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    total_items INTEGER NOT NULL DEFAULT 0,
    total_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    batch_identifier VARCHAR(255),
    negotiation_start_date TIMESTAMP,
    negotiation_end_date TIMESTAMP,
    idr_initiation_deadline TIMESTAMP,
    idr_initiated_date TIMESTAMP,
    idr_entity_id VARCHAR(255),
    cms_reference_number VARCHAR(255),
    administrative_fee_paid DECIMAL(10,2) DEFAULT 115.00,
    final_decision_amount DECIMAL(15,2),
    decision_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Qualified IDR Items table
CREATE TABLE IF NOT EXISTS qualified_idr_items (
    item_id SERIAL PRIMARY KEY,
    dispute_id VARCHAR(255) REFERENCES nsa_disputes(dispute_id),
    service_date TIMESTAMP NOT NULL,
    service_location VARCHAR(500) NOT NULL,
    service_type VARCHAR(50) NOT NULL,
    service_codes JSONB NOT NULL,
    place_of_service_code VARCHAR(10),
    claim_number VARCHAR(255) NOT NULL,
    item_service_type VARCHAR(20) DEFAULT 'individual',
    billed_amount DECIMAL(15,2) NOT NULL,
    initial_payment DECIMAL(15,2),
    final_payment DECIMAL(15,2),
    eob_reference VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- NSA Negotiations table (for 30-day negotiation period tracking)
CREATE TABLE IF NOT EXISTS nsa_negotiations (
    negotiation_id SERIAL PRIMARY KEY,
    claim_id VARCHAR(255) NOT NULL,
    dispute_id VARCHAR(255) REFERENCES nsa_disputes(dispute_id),
    negotiation_start TIMESTAMP NOT NULL,
    negotiation_end TIMESTAMP NOT NULL,
    status VARCHAR(50) DEFAULT 'active',
    settlement_amount DECIMAL(15,2),
    settlement_date TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Certified IDR Entities table
CREATE TABLE IF NOT EXISTS certified_idr_entities (
    entity_id VARCHAR(255) PRIMARY KEY,
    entity_name VARCHAR(500) NOT NULL,
    certification_number VARCHAR(255) UNIQUE NOT NULL,
    contact_email VARCHAR(255) NOT NULL,
    contact_phone VARCHAR(50),
    address JSONB,
    specialties JSONB,
    is_available BOOLEAN DEFAULT true,
    certification_date TIMESTAMP,
    expiration_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Enhanced Claims table (extends existing claims with NSA support)
CREATE TABLE IF NOT EXISTS enhanced_claims (
    claim_id VARCHAR(255) PRIMARY KEY,
    patient_id VARCHAR(255) NOT NULL,
    provider_id VARCHAR(255) NOT NULL,
    facility_id VARCHAR(255),
    payer_id VARCHAR(255) NOT NULL,
    network_status VARCHAR(50) NOT NULL,
    service_category VARCHAR(50) NOT NULL,
    total_billed DECIMAL(15,2) NOT NULL,
    total_allowed DECIMAL(15,2),
    total_paid DECIMAL(15,2),
    status VARCHAR(50) NOT NULL,
    nsa_eligibility JSONB,
    dispute_id VARCHAR(255) REFERENCES nsa_disputes(dispute_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Claim Items table
CREATE TABLE IF NOT EXISTS claim_items (
    item_id SERIAL PRIMARY KEY,
    claim_id VARCHAR(255) REFERENCES enhanced_claims(claim_id),
    service_date TIMESTAMP NOT NULL,
    service_code VARCHAR(20) NOT NULL,
    service_description TEXT,
    billed_amount DECIMAL(15,2) NOT NULL,
    allowed_amount DECIMAL(15,2),
    paid_amount DECIMAL(15,2),
    denial_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- IDR Documents table (for supporting documentation)
CREATE TABLE IF NOT EXISTS idr_documents (
    document_id VARCHAR(255) PRIMARY KEY,
    dispute_id VARCHAR(255) REFERENCES nsa_disputes(dispute_id),
    document_type VARCHAR(100) NOT NULL,
    file_name VARCHAR(500) NOT NULL,
    file_path VARCHAR(1000) NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type VARCHAR(100),
    uploaded_by VARCHAR(255),
    is_encrypted BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- IDR Timeline Events table (for audit trail)
CREATE TABLE IF NOT EXISTS idr_timeline_events (
    event_id SERIAL PRIMARY KEY,
    dispute_id VARCHAR(255) REFERENCES nsa_disputes(dispute_id),
    event_type VARCHAR(100) NOT NULL,
    event_description TEXT NOT NULL,
    event_data JSONB,
    created_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- CMS Submissions table (for tracking submissions to CMS portal)
CREATE TABLE IF NOT EXISTS cms_submissions (
    submission_id VARCHAR(255) PRIMARY KEY,
    dispute_id VARCHAR(255) REFERENCES nsa_disputes(dispute_id),
    submission_type VARCHAR(50) NOT NULL,
    cms_reference_number VARCHAR(255),
    submission_data JSONB NOT NULL,
    response_data JSONB,
    status VARCHAR(50) DEFAULT 'pending',
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    response_received_at TIMESTAMP
);

-- Bulk Processing Jobs table
CREATE TABLE IF NOT EXISTS bulk_processing_jobs (
    job_id VARCHAR(255) PRIMARY KEY,
    job_type VARCHAR(50) NOT NULL,
    dispute_ids JSONB NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    total_items INTEGER NOT NULL DEFAULT 0,
    processed_items INTEGER DEFAULT 0,
    failed_items INTEGER DEFAULT 0,
    error_log JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_nsa_disputes_status ON nsa_disputes(status);
CREATE INDEX IF NOT EXISTS idx_nsa_disputes_created_at ON nsa_disputes(created_at);
CREATE INDEX IF NOT EXISTS idx_nsa_disputes_cms_ref ON nsa_disputes(cms_reference_number);

CREATE INDEX IF NOT EXISTS idx_qualified_items_dispute_id ON qualified_idr_items(dispute_id);
CREATE INDEX IF NOT EXISTS idx_qualified_items_service_date ON qualified_idr_items(service_date);
CREATE INDEX IF NOT EXISTS idx_qualified_items_claim_number ON qualified_idr_items(claim_number);

CREATE INDEX IF NOT EXISTS idx_negotiations_claim_id ON nsa_negotiations(claim_id);
CREATE INDEX IF NOT EXISTS idx_negotiations_status ON nsa_negotiations(status);
CREATE INDEX IF NOT EXISTS idx_negotiations_end_date ON nsa_negotiations(negotiation_end);

CREATE INDEX IF NOT EXISTS idx_enhanced_claims_status ON enhanced_claims(status);
CREATE INDEX IF NOT EXISTS idx_enhanced_claims_patient_id ON enhanced_claims(patient_id);
CREATE INDEX IF NOT EXISTS idx_enhanced_claims_provider_id ON enhanced_claims(provider_id);
CREATE INDEX IF NOT EXISTS idx_enhanced_claims_network_status ON enhanced_claims(network_status);

CREATE INDEX IF NOT EXISTS idx_claim_items_claim_id ON claim_items(claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_items_service_date ON claim_items(service_date);

CREATE INDEX IF NOT EXISTS idx_idr_documents_dispute_id ON idr_documents(dispute_id);
CREATE INDEX IF NOT EXISTS idx_timeline_events_dispute_id ON idr_timeline_events(dispute_id);
CREATE INDEX IF NOT EXISTS idx_cms_submissions_dispute_id ON cms_submissions(dispute_id);
CREATE INDEX IF NOT EXISTS idx_bulk_jobs_status ON bulk_processing_jobs(status);

-- Sample data for certified IDR entities
INSERT INTO certified_idr_entities (
    entity_id, entity_name, certification_number, contact_email,
    specialties, certification_date, expiration_date
) VALUES 
(
    'idr-001',
    'Healthcare Dispute Resolution LLC',
    'HDR-2024-001',
    'disputes@hdr-llc.com',
    '["emergency_services", "post_stabilization"]',
    '2024-01-01',
    '2026-12-31'
),
(
    'idr-002',
    'Medical Arbitration Services',
    'MAS-2024-002',
    'cases@med-arbitration.com',
    '["air_ambulance", "non_emergency_oon"]',
    '2024-01-01',
    '2026-12-31'
),
(
    'idr-003',
    'Independent Healthcare Mediators',
    'IHM-2024-003',
    'mediations@ihm-services.com',
    '["emergency_services", "post_stabilization", "air_ambulance", "non_emergency_oon"]',
    '2024-01-01',
    '2026-12-31'
)
ON CONFLICT (entity_id) DO NOTHING;

-- Create views for common queries
CREATE OR REPLACE VIEW nsa_dispute_summary AS
SELECT 
    d.dispute_id,
    d.status,
    d.total_items,
    d.total_amount,
    d.negotiation_end_date,
    d.idr_initiation_deadline,
    d.cms_reference_number,
    COUNT(qi.item_id) as actual_items,
    SUM(qi.billed_amount) as actual_amount,
    d.created_at
FROM nsa_disputes d
LEFT JOIN qualified_idr_items qi ON d.dispute_id = qi.dispute_id
GROUP BY d.dispute_id, d.status, d.total_items, d.total_amount, 
         d.negotiation_end_date, d.idr_initiation_deadline, 
         d.cms_reference_number, d.created_at;

CREATE OR REPLACE VIEW active_negotiations AS
SELECT 
    n.*,
    d.dispute_id,
    d.status as dispute_status,
    CASE 
        WHEN n.negotiation_end < CURRENT_TIMESTAMP THEN 'expired'
        WHEN n.settlement_date IS NOT NULL THEN 'settled'
        ELSE 'active'
    END as current_status
FROM nsa_negotiations n
LEFT JOIN nsa_disputes d ON n.dispute_id = d.dispute_id
WHERE n.status = 'active';

-- Trigger to update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_nsa_disputes_updated_at 
    BEFORE UPDATE ON nsa_disputes 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_nsa_negotiations_updated_at 
    BEFORE UPDATE ON nsa_negotiations 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_enhanced_claims_updated_at 
    BEFORE UPDATE ON enhanced_claims 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_certified_idr_entities_updated_at 
    BEFORE UPDATE ON certified_idr_entities 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
