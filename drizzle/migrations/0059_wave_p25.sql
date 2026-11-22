-- Wave p25 (Phase 25, stage 2): WebAuthn / passkeys for staff authentication.
--
--   * webauthn_credentials: one row per registered passkey (platform
--     authenticator or roaming security key). credential_id is the raw
--     authenticator credential ID (unique globally); public_key is the COSE
--     key. counter is the authenticator signature counter used for clone
--     detection (warn-and-audit policy — see design doc §4.4). No org scoping
--     and no DB-level FK, matching totp_secrets / outcome_segment_sketches
--     precedent (users.id is varchar(64), globally unique; tenant isolation is
--     enforced at the procedure layer).

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id                      varchar(64) PRIMARY KEY,
  user_id                 varchar(64) NOT NULL,
  credential_id           bytea NOT NULL,
  public_key              bytea NOT NULL,
  counter                 bigint NOT NULL DEFAULT 0,
  transports              text,
  aaguid                  varchar(64),
  name                    varchar(128) NOT NULL DEFAULT 'Passkey',
  backed_up               boolean NOT NULL DEFAULT false,
  device_type             varchar(32) NOT NULL DEFAULT 'singleDevice',
  created_at              timestamp NOT NULL DEFAULT now(),
  last_used_at            timestamp,
  last_counter_anomaly_at timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS webauthn_credentials_cred_uniq ON webauthn_credentials (credential_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS webauthn_credentials_user_idx ON webauthn_credentials (user_id);
