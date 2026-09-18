-- Wave W4 (compliance content P1): i18n statutory notices, consent expiry,
-- e-signature capture, GFE co-providers.
--
-- 1. fsm_cases.language — notice-consent case language ('en' default; 'es'
--    supported via shared/i18n/notices). Only meaningful for caseType
--    'notice-consent'; harmless default for other FSM case types.
-- 2. consent_signatures — tamper-evident e-signature artifacts captured via
--    the public patient portal flow (patient_access_tokens scope
--    'consent_sign'). artifactHash = sha256 of canonical
--    {caseId, signerName, signatureText, attestation, timestamp, ip?}; the
--    hash is additionally chained into the FSM event log (prevEventHash).

ALTER TABLE fsm_cases
  ADD COLUMN IF NOT EXISTS "language" varchar(8) NOT NULL DEFAULT 'en';

CREATE TABLE IF NOT EXISTS consent_signatures (
  id                  varchar(64) PRIMARY KEY,
  "tenantId"          varchar(128) NOT NULL,
  "caseId"            varchar(128) NOT NULL,
  "signerName"        varchar(255) NOT NULL,
  -- sha256 hex of the typed signature text; the raw text is never persisted.
  "signatureTextHash" varchar(128) NOT NULL,
  attestation         boolean NOT NULL,
  "artifactHash"      varchar(128) NOT NULL,
  -- FSM event-chain tip at signing time (links artifact to the chain).
  "prevEventHash"     varchar(128) NOT NULL,
  ip                  varchar(64),
  "signedAt"          timestamp NOT NULL,
  "createdAt"         timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS consent_signatures_artifact_idx
  ON consent_signatures ("artifactHash");
CREATE INDEX IF NOT EXISTS consent_signatures_case_idx
  ON consent_signatures ("tenantId", "caseId");
CREATE INDEX IF NOT EXISTS consent_signatures_signed_at_idx
  ON consent_signatures ("signedAt");

-- patient_access_tokens.scope gains the 'consent_sign' value (column is a
-- free varchar; no DDL change required). Tokens for consent signing carry
-- the notice-consent case reference in disputeId as 'nc:<caseId>' —
-- documented seam pending a dedicated caseId column.
