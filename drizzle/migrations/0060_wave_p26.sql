-- Wave p26 (Phase 26, adversarial finding O6): out-of-band email confirmation
-- for FIRST-factor enrollment (forced-enrollment backdoor closure).
--
--   * webauthn_credentials.confirmed_at: NULL = enrollment ceremony completed
--     but the factor is NOT yet active (pending email confirmation). Existing
--     rows are backfilled to created_at (grandfathered as confirmed).
--   * factor_enrollment_confirmations: single-use, hash-at-rest confirmation
--     tokens (TTL-bound) AND the TOTP confirmation-state companion table
--     (totp_secrets cannot gain a column — it is managed by the frozen
--     server/routers.ts / drizzle/schema.ts). factor_fingerprint is the
--     md5() of the TOTP secret envelope at issuance: totp.setup replaces the
--     envelope, so a re-setup invalidates prior confirmations. md5() is core
--     PostgreSQL (no pgcrypto dependency); the fingerprint is a
--     change-detector, not credential hashing.
--   * Grandfather backfill: every pre-existing ACTIVE totp_secrets row gets a
--     confirmed companion row so current users are not locked out. Guarded by
--     NOT EXISTS so re-running the migration is a no-op.

ALTER TABLE webauthn_credentials ADD COLUMN IF NOT EXISTS confirmed_at timestamp;
--> statement-breakpoint
UPDATE webauthn_credentials SET confirmed_at = created_at WHERE confirmed_at IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS factor_enrollment_confirmations (
  id                  varchar(64) PRIMARY KEY,
  user_id             varchar(64) NOT NULL,
  factor_type         varchar(16) NOT NULL,
  factor_id           varchar(64) NOT NULL,
  factor_fingerprint  varchar(64),
  token_hash          varchar(64) NOT NULL,
  label               varchar(128),
  request_ip          varchar(64),
  request_user_agent  varchar(256),
  created_at          timestamp NOT NULL DEFAULT now(),
  expires_at          timestamp NOT NULL,
  consumed_at         timestamp,
  confirmed_at        timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS factor_enroll_confirm_token_uniq ON factor_enrollment_confirmations (token_hash);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS factor_enroll_confirm_user_idx ON factor_enrollment_confirmations (user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS factor_enroll_confirm_factor_idx ON factor_enrollment_confirmations (factor_type, factor_id);
--> statement-breakpoint
INSERT INTO factor_enrollment_confirmations
  (id, user_id, factor_type, factor_id, factor_fingerprint, token_hash, label, created_at, expires_at, consumed_at, confirmed_at)
SELECT
  md5(random()::text || clock_timestamp()::text || s.id),
  s."userId",
  'totp',
  s.id,
  md5(s.secret),
  md5('grandfathered-' || s.id || '-' || random()::text || clock_timestamp()::text),
  'pre-p26 enrollment (grandfathered)',
  now(),
  now(),
  now(),
  COALESCE(s."enabledAt", now())
FROM totp_secrets s
WHERE s.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM factor_enrollment_confirmations c
    WHERE c.factor_type = 'totp' AND c.factor_id = s.id AND c.confirmed_at IS NOT NULL
  );
