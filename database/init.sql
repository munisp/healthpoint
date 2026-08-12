-- Healthcare Claims Platform Database Schema
-- This script initializes the database with all required tables

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- Create schemas
CREATE SCHEMA IF NOT EXISTS healthcare;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS ml_models;

-- Set search path
SET search_path TO healthcare, public;

-- Users and Authentication
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    role VARCHAR(50) NOT NULL DEFAULT 'user',
    is_active BOOLEAN DEFAULT TRUE,
    is_verified BOOLEAN DEFAULT FALSE,
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Patients
CREATE TABLE IF NOT EXISTS patients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id VARCHAR(50) UNIQUE NOT NULL,
    first_name VARCHAR(255) NOT NULL,
    last_name VARCHAR(255) NOT NULL,
    date_of_birth DATE NOT NULL,
    gender VARCHAR(10),
    ssn VARCHAR(11),
    phone VARCHAR(20),
    email VARCHAR(255),
    address JSONB,
    insurance_info JSONB,
    medical_history JSONB,
    emergency_contact JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Providers
CREATE TABLE IF NOT EXISTS providers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(100) NOT NULL, -- hospital, clinic, individual, etc.
    specialty VARCHAR(255),
    npi VARCHAR(10) UNIQUE,
    tax_id VARCHAR(20),
    license_number VARCHAR(50),
    phone VARCHAR(20),
    email VARCHAR(255),
    address JSONB,
    network_status VARCHAR(50) DEFAULT 'in_network',
    contract_details JSONB,
    performance_metrics JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Claims
CREATE TABLE IF NOT EXISTS claims (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    claim_id VARCHAR(50) UNIQUE NOT NULL,
    patient_id UUID REFERENCES patients(id),
    provider_id UUID REFERENCES providers(id),
    claim_type VARCHAR(50) NOT NULL, -- medical, dental, pharmacy, etc.
    service_date DATE NOT NULL,
    submission_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    total_amount DECIMAL(12, 2) NOT NULL,
    covered_amount DECIMAL(12, 2),
    patient_responsibility DECIMAL(12, 2),
    status VARCHAR(50) DEFAULT 'submitted', -- submitted, processing, approved, denied, paid
    denial_reason TEXT,
    diagnosis_codes JSONB, -- ICD-10 codes
    procedure_codes JSONB, -- CPT codes
    line_items JSONB, -- detailed breakdown
    prior_authorization VARCHAR(50),
    risk_score DECIMAL(5, 2),
    risk_level VARCHAR(20), -- low, medium, high, critical
    fraud_flags JSONB,
    processing_notes TEXT,
    adjudication_date TIMESTAMP WITH TIME ZONE,
    payment_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Fraud Detection Results
CREATE TABLE IF NOT EXISTS fraud_detections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    claim_id UUID REFERENCES claims(id),
    detection_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    model_version VARCHAR(50),
    fraud_score DECIMAL(5, 4) NOT NULL,
    risk_level VARCHAR(20) NOT NULL,
    detection_method VARCHAR(100), -- rule_based, ml_model, ensemble, etc.
    flags JSONB, -- specific fraud indicators
    confidence_score DECIMAL(5, 4),
    investigation_status VARCHAR(50) DEFAULT 'pending',
    investigator_notes TEXT,
    resolution VARCHAR(50), -- confirmed_fraud, false_positive, under_review
    resolution_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Documents
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id VARCHAR(50) UNIQUE NOT NULL,
    claim_id UUID REFERENCES claims(id),
    patient_id UUID REFERENCES patients(id),
    provider_id UUID REFERENCES providers(id),
    document_type VARCHAR(100) NOT NULL, -- claim_form, medical_record, invoice, etc.
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size BIGINT,
    mime_type VARCHAR(100),
    checksum VARCHAR(64),
    encryption_key VARCHAR(255),
    extracted_text TEXT,
    extracted_data JSONB,
    ocr_confidence DECIMAL(5, 4),
    version INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE,
    uploaded_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Workflows
CREATE TABLE IF NOT EXISTS workflows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    workflow_type VARCHAR(100), -- claim_processing, fraud_investigation, etc.
    definition JSONB NOT NULL, -- BPMN or workflow definition
    version INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Workflow Instances
CREATE TABLE IF NOT EXISTS workflow_instances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    instance_id VARCHAR(50) UNIQUE NOT NULL,
    workflow_id UUID REFERENCES workflows(id),
    entity_id UUID, -- claim_id, patient_id, etc.
    entity_type VARCHAR(50),
    status VARCHAR(50) DEFAULT 'running', -- running, completed, failed, suspended
    current_step VARCHAR(255),
    variables JSONB,
    start_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    notification_id VARCHAR(50) UNIQUE NOT NULL,
    recipient_id UUID REFERENCES users(id),
    notification_type VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    priority VARCHAR(20) DEFAULT 'normal', -- low, normal, high, urgent
    channel VARCHAR(50) DEFAULT 'in_app', -- in_app, email, sms, push
    status VARCHAR(50) DEFAULT 'pending', -- pending, sent, delivered, failed
    metadata JSONB,
    scheduled_at TIMESTAMP WITH TIME ZONE,
    sent_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Configuration
CREATE TABLE IF NOT EXISTS configurations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    config_key VARCHAR(255) UNIQUE NOT NULL,
    config_value JSONB NOT NULL,
    description TEXT,
    category VARCHAR(100),
    is_encrypted BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Audit Schema Tables
SET search_path TO audit, public;

-- Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    table_name VARCHAR(255) NOT NULL,
    record_id UUID NOT NULL,
    action VARCHAR(20) NOT NULL, -- INSERT, UPDATE, DELETE
    old_values JSONB,
    new_values JSONB,
    changed_fields TEXT[],
    user_id UUID,
    session_id VARCHAR(255),
    ip_address INET,
    user_agent TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Compliance Events
CREATE TABLE IF NOT EXISTS compliance_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) NOT NULL, -- info, warning, error, critical
    description TEXT NOT NULL,
    entity_type VARCHAR(50),
    entity_id UUID,
    compliance_framework VARCHAR(100), -- HIPAA, SOX, etc.
    rule_violated VARCHAR(255),
    remediation_required BOOLEAN DEFAULT FALSE,
    remediation_notes TEXT,
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ML Models Schema
SET search_path TO ml_models, public;

-- Model Registry
CREATE TABLE IF NOT EXISTS model_registry (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_name VARCHAR(255) NOT NULL,
    model_version VARCHAR(50) NOT NULL,
    model_type VARCHAR(100) NOT NULL, -- fraud_detection, risk_assessment, etc.
    algorithm VARCHAR(100), -- random_forest, neural_network, etc.
    framework VARCHAR(50), -- scikit-learn, pytorch, tensorflow
    model_path VARCHAR(500),
    metrics JSONB, -- accuracy, precision, recall, etc.
    hyperparameters JSONB,
    training_data_info JSONB,
    is_active BOOLEAN DEFAULT FALSE,
    deployment_status VARCHAR(50) DEFAULT 'staging',
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(model_name, model_version)
);

-- Model Predictions
CREATE TABLE IF NOT EXISTS model_predictions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id UUID REFERENCES model_registry(id),
    entity_id UUID NOT NULL, -- claim_id, patient_id, etc.
    entity_type VARCHAR(50) NOT NULL,
    input_features JSONB NOT NULL,
    prediction JSONB NOT NULL,
    confidence_score DECIMAL(5, 4),
    prediction_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    feedback_score DECIMAL(5, 4), -- actual outcome for model improvement
    feedback_date TIMESTAMP WITH TIME ZONE
);

-- Reset search path
SET search_path TO healthcare, public;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_claims_patient_id ON claims(patient_id);
CREATE INDEX IF NOT EXISTS idx_claims_provider_id ON claims(provider_id);
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_risk_level ON claims(risk_level);
CREATE INDEX IF NOT EXISTS idx_claims_service_date ON claims(service_date);
CREATE INDEX IF NOT EXISTS idx_claims_submission_date ON claims(submission_date);

CREATE INDEX IF NOT EXISTS idx_fraud_detections_claim_id ON fraud_detections(claim_id);
CREATE INDEX IF NOT EXISTS idx_fraud_detections_risk_level ON fraud_detections(risk_level);
CREATE INDEX IF NOT EXISTS idx_fraud_detections_detection_date ON fraud_detections(detection_date);

CREATE INDEX IF NOT EXISTS idx_patients_patient_id ON patients(patient_id);
CREATE INDEX IF NOT EXISTS idx_providers_provider_id ON providers(provider_id);
CREATE INDEX IF NOT EXISTS idx_providers_npi ON providers(npi);

CREATE INDEX IF NOT EXISTS idx_documents_claim_id ON documents(claim_id);
CREATE INDEX IF NOT EXISTS idx_documents_patient_id ON documents(patient_id);
CREATE INDEX IF NOT EXISTS idx_documents_document_type ON documents(document_type);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_id ON notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_scheduled_at ON notifications(scheduled_at);

-- Audit schema indexes
CREATE INDEX IF NOT EXISTS idx_audit_log_table_name ON audit.audit_log(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_log_record_id ON audit.audit_log(record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit.audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit.audit_log(user_id);

-- ML models schema indexes
CREATE INDEX IF NOT EXISTS idx_model_predictions_entity_id ON ml_models.model_predictions(entity_id);
CREATE INDEX IF NOT EXISTS idx_model_predictions_model_id ON ml_models.model_predictions(model_id);
CREATE INDEX IF NOT EXISTS idx_model_predictions_prediction_time ON ml_models.model_predictions(prediction_time);

-- Create triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to tables with updated_at columns
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_patients_updated_at BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_providers_updated_at BEFORE UPDATE ON providers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_claims_updated_at BEFORE UPDATE ON claims FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_documents_updated_at BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_workflows_updated_at BEFORE UPDATE ON workflows FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_workflow_instances_updated_at BEFORE UPDATE ON workflow_instances FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_configurations_updated_at BEFORE UPDATE ON configurations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default configurations
INSERT INTO configurations (config_key, config_value, description, category) VALUES
('fraud_detection.risk_threshold', '0.75', 'Risk score threshold for flagging claims as high risk', 'fraud_detection'),
('fraud_detection.auto_flag_enabled', 'true', 'Automatically flag high-risk claims', 'fraud_detection'),
('fraud_detection.notification_enabled', 'true', 'Send notifications for fraud detections', 'fraud_detection'),
('claims_processing.auto_approval_threshold', '1000.00', 'Auto-approve claims below this amount if low risk', 'claims_processing'),
('notifications.email_enabled', 'true', 'Enable email notifications', 'notifications'),
('notifications.sms_enabled', 'false', 'Enable SMS notifications', 'notifications'),
('audit.retention_days', '2555', 'Number of days to retain audit logs (7 years)', 'audit'),
('backup.frequency_hours', '24', 'Backup frequency in hours', 'backup'),
('monitoring.alert_threshold_cpu', '80', 'CPU usage threshold for alerts (%)', 'monitoring'),
('monitoring.alert_threshold_memory', '85', 'Memory usage threshold for alerts (%)', 'monitoring')
ON CONFLICT (config_key) DO NOTHING;

-- Insert sample data for testing
INSERT INTO users (username, email, password_hash, first_name, last_name, role) VALUES
('admin', 'admin@healthcare.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/VJBzwESWy', 'System', 'Administrator', 'admin'),
('analyst', 'analyst@healthcare.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/VJBzwESWy', 'Fraud', 'Analyst', 'analyst'),
('processor', 'processor@healthcare.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/VJBzwESWy', 'Claims', 'Processor', 'processor')
ON CONFLICT (username) DO NOTHING;

-- Grant permissions
GRANT USAGE ON SCHEMA healthcare TO PUBLIC;
GRANT USAGE ON SCHEMA audit TO PUBLIC;
GRANT USAGE ON SCHEMA ml_models TO PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA healthcare TO PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA audit TO PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ml_models TO PUBLIC;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA healthcare TO PUBLIC;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA audit TO PUBLIC;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ml_models TO PUBLIC;
