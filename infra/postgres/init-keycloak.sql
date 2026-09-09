-- ----------------------------------------------------------------------------
-- Audit P1 (2026-09-05): dedicated Keycloak database.
-- Keycloak now runs in production mode (KC_DB=postgres) against the shared
-- postgres service instead of dev-mem (in-memory H2). It needs its own
-- database; CREATE DATABASE cannot run inside a transaction block or a
-- DO $$ ... $$ block, so this uses the psql \gexec guard pattern. The
-- postgres image's docker-entrypoint-initdb.d executes *.sql files with
-- psql, so \gexec is available here (but NOT when this file is sourced from
-- another SQL session without psql meta-command support).
-- Idempotent: safe to re-run on existing volumes.
-- ----------------------------------------------------------------------------
SELECT 'CREATE DATABASE keycloak'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'keycloak')\gexec

-- Grant the application user full access to the keycloak database. The
-- Keycloak container authenticates as POSTGRES_USER (KC_DB_USERNAME), which
-- already owns every database it creates; the GRANT below is a belt-and-
-- suspenders guard for restores/provisioned volumes.
SELECT 'GRANT ALL PRIVILEGES ON DATABASE keycloak TO ' || quote_ident(current_user)
WHERE EXISTS (SELECT FROM pg_database WHERE datname = 'keycloak')\gexec
