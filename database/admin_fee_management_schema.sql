-- Database schema for the Enhanced Admin Fee Management Service

CREATE TABLE transaction_fees (
    method VARCHAR(50) PRIMARY KEY,
    fee_type VARCHAR(50) NOT NULL,
    flat_fee NUMERIC(10, 2),
    percentage NUMERIC(5, 2),
    description TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE billing_plans (
    plan_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    monthly_cost NUMERIC(10, 2) NOT NULL,
    max_providers INTEGER,
    per_dispute_fee NUMERIC(10, 2) NOT NULL,
    included_transactions INTEGER NOT NULL,
    features TEXT[] NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE volume_discounts (
    tier_name VARCHAR(50) PRIMARY KEY,
    min_transactions INTEGER NOT NULL,
    max_transactions INTEGER,
    discount_percentage NUMERIC(5, 2) NOT NULL,
    applies_to TEXT[] NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE platform_settings (
    setting_key VARCHAR(50) PRIMARY KEY,
    setting_value TEXT NOT NULL,
    setting_type VARCHAR(50) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_logs (
    log_id SERIAL PRIMARY KEY,
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(100) NOT NULL,
    changes JSONB NOT NULL,
    updated_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

