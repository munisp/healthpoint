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

-- Audit P1-9: the init-time `pg_create_logical_replication_slot`
-- ('idr_kafka_slot') was REMOVED. An init-created slot with no consumer
-- pins WAL forever and grows pg_wal without bound. The CDC consumer owns
-- slot lifecycle and must create the slot when it connects.

-- ----------------------------------------------------------------------------
-- Audit P1-9: instance tuning via ALTER SYSTEM (persists to
-- postgresql.auto.conf; applied on first boot, takes effect after restart).
-- Values assume a 4GB container; adjust proportionally for other sizes.
-- ----------------------------------------------------------------------------
ALTER SYSTEM SET shared_buffers = '1GB';              -- ~25% of 4GB
ALTER SYSTEM SET effective_cache_size = '3GB';        -- ~75% of 4GB
ALTER SYSTEM SET work_mem = '16MB';
ALTER SYSTEM SET max_parallel_workers_per_gather = 4;
ALTER SYSTEM SET wal_compression = 'on';
ALTER SYSTEM SET checkpoint_timeout = '15min';
ALTER SYSTEM SET max_wal_size = '2GB';
ALTER SYSTEM SET random_page_cost = 1.1;              -- SSD-backed volumes
