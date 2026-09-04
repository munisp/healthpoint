import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { attestationPayload, verifyAttestation } from "./stakeholder-attestation-crypto.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const { publicKey: ownerPublic, privateKey: ownerPrivate } = generateKeyPairSync("ed25519");
const { publicKey: reviewerPublic, privateKey: reviewerPrivate } = generateKeyPairSync("ed25519");
const trustStore = {
  keys: [
    { keyId: "owner-key", subjectIdentity: "owner-user", status: "active", permittedAttestationKinds: ["owner"], validFrom: "2020-01-01T00:00:00.000Z", publicKeyPem: ownerPublic.export({ type: "spki", format: "pem" }) },
    { keyId: "reviewer-key", subjectIdentity: "reviewer-user", status: "active", permittedAttestationKinds: ["independent_reviewer"], validFrom: "2020-01-01T00:00:00.000Z", publicKeyPem: reviewerPublic.export({ type: "spki", format: "pem" }) },
  ],
};

function signedManifest() {
  const manifest = {
    claimId: "tigerbeetle-finality:provider:USD:1",
    claimStatement: "TigerBeetle mapping is verified in staging.",
    claimType: "tigerbeetle_finality_mapping",
    environment: "staging",
    completedAt: "2026-09-02T00:00:00.000Z",
    artifacts: [{ path: "evidence/topology.json", sha256: "a".repeat(64), role: "tigerbeetle_topology_validation" }],
    requirements: [{ requirement: "topology", artifactRefs: ["evidence/topology.json"] }],
    owner: { name: "Owner", role: "Finance", reviewerIdentity: "owner-user", approvedAt: "2026-09-02T00:00:00.000Z", signingKeyId: "owner-key" },
    independentReviewer: { name: "Reviewer", role: "Security", reviewerIdentity: "reviewer-user", approvedAt: "2026-09-02T00:01:00.000Z", signingKeyId: "reviewer-key" },
  };
  for (const [kind, key, field] of [["owner", ownerPrivate, "owner"], ["independent_reviewer", reviewerPrivate, "independentReviewer"]]) {
    const payload = attestationPayload(manifest, kind);
    manifest[field].signedPayloadSha256 = hash(payload);
    manifest[field].signatureBase64 = sign(null, payload, key).toString("base64");
  }
  return manifest;
}

test("verifies valid canonical owner and independent Ed25519 attestations", () => {
  const manifest = signedManifest();
  assert.equal(verifyAttestation({ manifest, kind: "owner", trustStore }).verified, true);
  assert.equal(verifyAttestation({ manifest, kind: "independent_reviewer", trustStore }).verified, true);
});

test("rejects a tampered canonical payload", () => {
  const manifest = signedManifest();
  manifest.claimStatement = "tampered";
  assert.equal(verifyAttestation({ manifest, kind: "owner", trustStore }).verified, false);
});

test("rejects an expired signing key", () => {
  const manifest = signedManifest();
  const expired = structuredClone(trustStore);
  expired.keys[0].validUntil = "2020-01-02T00:00:00.000Z";
  assert.equal(verifyAttestation({ manifest, kind: "owner", trustStore: expired }).verified, false);
});

test("rejects a key that is not permitted for the requested attestation kind", () => {
  const manifest = signedManifest();
  manifest.owner.signingKeyId = "reviewer-key";
  assert.equal(verifyAttestation({ manifest, kind: "owner", trustStore }).verified, false);
});

test("rejects a malformed signing-key validFrom timestamp rather than treating it as unbounded", () => {
  const manifest = signedManifest();
  const malformed = structuredClone(trustStore);
  malformed.keys[0].validFrom = "not-an-iso-timestamp";
  const result = verifyAttestation({ manifest, kind: "owner", trustStore: malformed });
  assert.equal(result.verified, false);
  assert.ok(result.errors.includes("signing key validFrom is not a valid timestamp"));
});

test("rejects a malformed signing-key validUntil timestamp rather than treating it as unbounded", () => {
  const manifest = signedManifest();
  const malformed = structuredClone(trustStore);
  malformed.keys[0].validUntil = "not-an-iso-timestamp";
  const result = verifyAttestation({ manifest, kind: "owner", trustStore: malformed });
  assert.equal(result.verified, false);
  assert.ok(result.errors.includes("signing key validUntil is not a valid timestamp"));
});
