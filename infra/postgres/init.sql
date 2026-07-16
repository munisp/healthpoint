-- HealthPoint IDR — PostgreSQL initialization
-- Enables extensions needed for the full middleware stack

-- Audit logging extension
CREATE EXTENSION IF NOT EXISTS pgaudit;

-- UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Full-text search improvements
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Logical replication for CDC to Kafka
ALTER SYSTEM SET wal_level = logical;
ALTER SYSTEM SET max_replication_slots = 10;
ALTER SYSTEM SET max_wal_senders = 10;

-- Permify schema (separate from app schema)
CREATE SCHEMA IF NOT EXISTS permify;

-- Temporal schema
CREATE SCHEMA IF NOT EXISTS temporal;

-- Grant permissions
GRANT ALL PRIVILEGES ON SCHEMA public TO idr_user;
GRANT ALL PRIVILEGES ON SCHEMA permify TO idr_user;
GRANT ALL PRIVILEGES ON SCHEMA temporal TO idr_user;

-- Create replication slot for Kafka CDC
SELECT pg_create_logical_replication_slot('idr_kafka_slot', 'pgoutput')
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_replication_slots WHERE slot_name = 'idr_kafka_slot'
  );
