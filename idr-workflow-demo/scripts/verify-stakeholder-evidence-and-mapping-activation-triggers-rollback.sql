\set ON_ERROR_STOP on
BEGIN;

-- Test-only, self-contained rows. The enclosing transaction is always rolled
-- back, so this verifier never creates production evidence or mappings.
INSERT INTO stakeholder_claim_signing_keys (
  id, "keyId", "subjectIdentity", "displayName", "permittedAttestationKinds",
  algorithm, "publicKeyPem", "publicKeySha256", status, "validFrom", "createdBy"
) VALUES
  ('local-verify-owner-key', 'local-verify-owner-key-id', 'local-owner', 'Local Owner', ARRAY['owner']::stakeholder_claim_attestation_kind[], 'ed25519', '-----BEGIN PUBLIC KEY-----\nLOCAL-OWNER\n-----END PUBLIC KEY-----', repeat('a', 64), 'active', now() - interval '1 day', 'local-trigger-verifier'),
  ('local-verify-reviewer-key', 'local-verify-reviewer-key-id', 'local-reviewer', 'Local Reviewer', ARRAY['independent_reviewer']::stakeholder_claim_attestation_kind[], 'ed25519', '-----BEGIN PUBLIC KEY-----\nLOCAL-REVIEWER\n-----END PUBLIC KEY-----', repeat('b', 64), 'active', now() - interval '1 day', 'local-trigger-verifier');

INSERT INTO stakeholder_claim_evidence_bundles (
  id, "claimId", "claimStatement", "claimType", "schemaVersion", environment,
  "evidenceRootUri", "manifestSha256", "validationReportSha256", "sourceSystem",
  "dataClassification", "completedAt", status
) VALUES (
  'local-verify-evidence-bundle', 'tigerbeetle-finality:local:USD:1',
  'Rollback-only local verification bundle', 'tigerbeetle_finality_mapping', '1.0', 'staging',
  'protected://local-trigger-verification', repeat('c', 64), repeat('d', 64), 'approved-staging-system',
  'confidential_operational', now(), 'pending_review'
);

INSERT INTO stakeholder_claim_evidence_artifacts (
  id, "bundleId", "relativePath", "artifactRole", sha256, "byteSize", "artifactCreatedAt"
) VALUES (
  'local-verify-evidence-artifact', 'local-verify-evidence-bundle', 'evidence/verification.json',
  'tigerbeetle_topology_validation', repeat('e', 64), 1, now()
);

INSERT INTO stakeholder_claim_reviewer_attestations (
  id, "bundleId", kind, "reviewerName", "reviewerRole", "reviewerIdentity", "approvedAt",
  "signingKeyId", "signatureAlgorithm", "signatureBase64", "signedPayloadSha256",
  "cryptographicallyVerifiedAt", "cryptographicVerifierVersion", "attestationSha256", "attestationText"
) VALUES
  ('local-verify-owner-attestation', 'local-verify-evidence-bundle', 'owner', 'Local Owner', 'Finance', 'local-owner', now() - interval '1 minute',
   'local-verify-owner-key', 'ed25519', repeat('A', 88), repeat('f', 64), now(), 'local-trigger-verifier', repeat('1', 64), 'owner'),
  ('local-verify-reviewer-attestation', 'local-verify-evidence-bundle', 'independent_reviewer', 'Local Reviewer', 'Security', 'local-reviewer', now(),
   'local-verify-reviewer-key', 'ed25519', repeat('B', 88), repeat('0', 64), now(), 'local-trigger-verifier', repeat('2', 64), 'reviewer');

UPDATE stakeholder_claim_evidence_bundles
   SET status = 'validated', "validatedBy" = 'local-reviewer', "validatedAt" = now()
 WHERE id = 'local-verify-evidence-bundle';

INSERT INTO tigerbeetle_finality_account_mappings (
  id, provider, currency, "debitAccountId", "creditAccountId", ledger, code, mode,
  "mappingVersion", active, "approvedBy", "approvalReference"
) VALUES (
  'local-verify-mapping', 'local', 'USD', '1001', '1002', 1, 1,
  'single_phase_settlement', 1, false, 'local-owner', 'CHG-local-verify'
);

DO $$
BEGIN
  BEGIN
    UPDATE tigerbeetle_finality_account_mappings
       SET active = true,
           "verifiedAt" = now(),
           "verifiedBy" = 'local-reviewer',
           "verificationEvidenceSha256" = repeat('9', 64),
           "activationEvidenceBundleId" = 'local-verify-evidence-bundle'
     WHERE id = 'local-verify-mapping';
    RAISE EXCEPTION 'expected mapping digest mismatch rejection was not raised';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'TigerBeetle finality mapping verification digest must match activation evidence bundle' THEN
      RAISE;
    END IF;
    RAISE NOTICE 'PASS mapping digest mismatch rejected: sqlstate=% message=%', SQLSTATE, SQLERRM;
  END;
END;
$$;

UPDATE tigerbeetle_finality_account_mappings
   SET active = true,
       "verifiedAt" = now(),
       "verifiedBy" = 'local-reviewer',
       "verificationEvidenceSha256" = repeat('c', 64),
       "activationEvidenceBundleId" = 'local-verify-evidence-bundle'
 WHERE id = 'local-verify-mapping';

DO $$
BEGIN
  BEGIN
    UPDATE tigerbeetle_finality_account_mappings
       SET "verifiedBy" = 'other-reviewer'
     WHERE id = 'local-verify-mapping';
    RAISE EXCEPTION 'expected active mapping evidence immutability rejection was not raised';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'Active TigerBeetle finality mapping verification evidence is immutable' THEN
      RAISE;
    END IF;
    RAISE NOTICE 'PASS active mapping evidence mutation rejected: sqlstate=% message=%', SQLSTATE, SQLERRM;
  END;
END;
$$;

SELECT 'validated_bundle_status=' || status
  FROM stakeholder_claim_evidence_bundles
 WHERE id = 'local-verify-evidence-bundle';
SELECT 'active_mapping=' || active
  FROM tigerbeetle_finality_account_mappings
 WHERE id = 'local-verify-mapping';

ROLLBACK;
