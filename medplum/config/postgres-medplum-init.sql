-- Medplum PostgreSQL initialization script
-- Medplum manages its own schema via TypeORM migrations on first boot.
-- This script only creates required PostgreSQL extensions.

-- Required by Medplum for UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Required by Medplum for full-text search (GIN indexes)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Required by Medplum for JSONB GIN indexing performance
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- Required by Medplum for case-insensitive text (citext columns)
CREATE EXTENSION IF NOT EXISTS citext;

-- Grant all privileges to medplum user
GRANT ALL PRIVILEGES ON DATABASE medplum TO medplum;
GRANT ALL ON SCHEMA public TO medplum;

-- Performance tuning for Medplum's JSONB-heavy workload
ALTER SYSTEM SET gin_fuzzy_search_limit = 0;
ALTER SYSTEM SET gin_pending_list_limit = '64MB';
SELECT pg_reload_conf();
