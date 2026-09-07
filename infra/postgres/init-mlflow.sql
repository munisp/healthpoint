-- ----------------------------------------------------------------------------
-- Audit P2 (2026-09-05): dedicated MLflow database.
-- The optional MLflow tracking server (docker-compose.yml `mlflow` service,
-- profile `ml-tracking`) uses the shared postgres service as its backend
-- store and needs its own `mlflow` database. Follows the same psql \gexec
-- guard pattern as 02-init-keycloak.sql (CREATE DATABASE cannot run inside
-- a transaction block or a DO $$ ... $$ block). The postgres image's
-- docker-entrypoint-initdb.d executes *.sql files with psql, so \gexec is
-- available here.
-- Idempotent: safe to re-run on existing volumes.
-- ----------------------------------------------------------------------------
SELECT 'CREATE DATABASE mlflow'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'mlflow')\gexec

-- Belt-and-suspenders grant for restores/provisioned volumes (the MLflow
-- container authenticates as POSTGRES_USER, which already owns databases it
-- creates).
SELECT 'GRANT ALL PRIVILEGES ON DATABASE mlflow TO ' || quote_ident(current_user)
WHERE EXISTS (SELECT FROM pg_database WHERE datname = 'mlflow')\gexec
