import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { attestationPayload } from "./lib/stakeholder-attestation-crypto.mjs";

const script = resolve("scripts/import-tigerbeetle-finality-evidence.mjs");
const baseEnv = { ...process.env, NODE_ENV: "test" };
function invoke(env, args = []) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { ...baseEnv, ...env } });
}

test("refuses before I/O unless protected evidence execution is explicitly selected", () => {
  const result = invoke({ EVIDENCE_EXECUTION: "", DATABASE_URL: "postgresql://127.0.0.1/forbidden" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /EVIDENCE_EXECUTION=protected is required/);
});

test("verify-only mode requires an independently supplied canonical expected claim before filesystem access", () => {
  const result = spawnSync(process.execPath, [script, "--verify-only", "--mapping-id=00000000-0000-4000-8000-000000000001"], {
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "production", EVIDENCE_EXECUTION: "protected", EXTERNAL_POSTGRES_URL: "", DATABASE_URL: "" },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /canonical --expected-claim-id/);
});

test("refuses test-mode protected execution before opening a database connection", () => {
  const result = invoke({ EVIDENCE_EXECUTION: "protected", DATABASE_URL: "postgresql://private-db.internal/finality" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /test\/mock execution is prohibited/);
});

test("refuses a loopback PostgreSQL target in non-test protected execution", () => {
  const result = spawnSync(process.execPath, [script, "--mapping-id=00000000-0000-4000-8000-000000000001", "--evidence-root=/protected/evidence", "--trust-store=/protected/keys.json"], {
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "production", EVIDENCE_EXECUTION: "protected", EXTERNAL_POSTGRES_URL: "", DATABASE_URL: "postgresql://127.0.0.1/forbidden" },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /loopback PostgreSQL targets are prohibited/);
});

const sha256 = value => createHash("sha256").update(value).digest("hex");

function buildSignedVerificationOnlyFixture({ omitRequirementForRole, addSupplementalArtifact = false, reuseReviewerIdentity = false, reuseReviewerKey = false, mutateManifest } = {}) {
  const evidenceRoot = mkdtempSync(join(tmpdir(), "hp-evidence-"));
  const trustRoot = mkdtempSync(join(tmpdir(), "hp-trust-"));
  mkdirSync(join(evidenceRoot, "evidence"));
  const roles = [
    "tigerbeetle_account_verification",
    "tigerbeetle_mtls_readiness",
    "tigerbeetle_topology_validation",
    "tigerbeetle_finality_sandbox_result",
  ];
  const artifacts = roles.map((role, index) => {
    const path = `evidence/${index + 1}.json`;
    const bytes = Buffer.from(JSON.stringify({ role, result: "observed" }));
    writeFileSync(join(evidenceRoot, path), bytes);
    return { path, sha256: sha256(bytes), role, createdAt: "2026-09-02T00:00:00.000Z" };
  });
  if (addSupplementalArtifact) {
    const path = "evidence/supplemental.json";
    const bytes = Buffer.from(JSON.stringify({ result: "observed" }));
    writeFileSync(join(evidenceRoot, path), bytes);
    artifacts.push({ path, sha256: sha256(bytes), role: "supplemental_operational_log", createdAt: "2026-09-02T00:00:00.000Z" });
  }
  const { publicKey: ownerPublicKey, privateKey: ownerPrivateKey } = generateKeyPairSync("ed25519");
  const { publicKey: reviewerPublicKey, privateKey: reviewerPrivateKey } = generateKeyPairSync("ed25519");
  const manifest = {
    schemaVersion: "1.0",
    environment: "staging",
    claimId: "tigerbeetle-finality:providerx:USD:1",
    claimStatement: "Approved staging mapping evidence.",
    claimType: "tigerbeetle_finality_mapping",
    completedAt: "2026-09-02T00:00:00.000Z",
    realDataAttestation: { nonSynthetic: true, notMock: true, sourceSystem: "approved-staging-system" },
    artifacts,
    requirements: artifacts
      .filter(artifact => artifact.role !== omitRequirementForRole)
      .map(artifact => ({ requirement: artifact.role, artifactRefs: [artifact.path] })),
    owner: { name: "Owner", role: "Finance", reviewerIdentity: "owner-user", approvedAt: "2026-09-02T00:00:00.000Z", signingKeyId: "owner-key" },
    independentReviewer: {
      name: "Reviewer",
      role: "Security",
      reviewerIdentity: reuseReviewerIdentity || reuseReviewerKey ? "owner-user" : "reviewer-user",
      approvedAt: "2026-09-02T00:01:00.000Z",
      signingKeyId: reuseReviewerKey ? "owner-key" : "reviewer-key",
    },
  };
  if (typeof mutateManifest === "function") mutateManifest(manifest);
  for (const [kind, partyKey, partyField] of [["owner", ownerPrivateKey, "owner"], ["independent_reviewer", reuseReviewerKey ? ownerPrivateKey : reviewerPrivateKey, "independentReviewer"]]) {
    const payload = attestationPayload(manifest, kind);
    manifest[partyField].signedPayloadSha256 = sha256(payload);
    manifest[partyField].signatureBase64 = sign(null, payload, partyKey).toString("base64");
  }
  writeFileSync(join(evidenceRoot, "manifest.json"), JSON.stringify(manifest));
  const trustStorePath = join(trustRoot, "trusted-keys.json");
  writeFileSync(trustStorePath, JSON.stringify({ keys: [
    { keyId: "owner-key", subjectIdentity: "owner-user", status: "active", permittedAttestationKinds: reuseReviewerKey ? ["owner", "independent_reviewer"] : ["owner"], validFrom: "2020-01-01T00:00:00.000Z", publicKeyPem: ownerPublicKey.export({ type: "spki", format: "pem" }) },
    { keyId: "reviewer-key", subjectIdentity: reuseReviewerIdentity ? "owner-user" : "reviewer-user", status: "active", permittedAttestationKinds: ["independent_reviewer"], validFrom: "2020-01-01T00:00:00.000Z", publicKeyPem: reviewerPublicKey.export({ type: "spki", format: "pem" }) },
  ] }));
  return { evidenceRoot, trustRoot, trustStorePath };
}

function invokeVerificationOnlyFixture(fixture) {
  return spawnSync(process.execPath, [script, "--verify-only", "--mapping-id=00000000-0000-4000-8000-000000000001", "--expected-claim-id=tigerbeetle-finality:providerx:USD:1", `--evidence-root=${fixture.evidenceRoot}`, `--trust-store=${fixture.trustStorePath}`], {
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "production", EVIDENCE_EXECUTION: "protected", EXTERNAL_POSTGRES_URL: "", DATABASE_URL: "" },
  });
}

test("verify-only protected importer accepts a fully requirement-bound and dual-signed finality bundle without database I/O", () => {
  const fixture = buildSignedVerificationOnlyFixture();
  try {
    const result = invokeVerificationOnlyFixture(fixture);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /"verified": true/);
    assert.match(result.stdout, /"persisted": false/);
    assert.equal(result.stderr, "");
  } finally {
    rmSync(fixture.evidenceRoot, { recursive: true, force: true });
    rmSync(fixture.trustRoot, { recursive: true, force: true });
  }
});

test("verify-only protected importer rejects a required finality artifact that is not bound to any requirement before attestation persistence", () => {
  const fixture = buildSignedVerificationOnlyFixture({ omitRequirementForRole: "tigerbeetle_finality_sandbox_result" });
  try {
    const result = invokeVerificationOnlyFixture(fixture);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /required finality evidence role is not bound to a requirement: tigerbeetle_finality_sandbox_result/);
  } finally {
    rmSync(fixture.evidenceRoot, { recursive: true, force: true });
    rmSync(fixture.trustRoot, { recursive: true, force: true });
  }
});

for (const graphCase of [
  {
    name: "an absent requirement graph",
    options: { mutateManifest: manifest => { manifest.requirements = []; } },
    expected: /manifest must bind evidence artifacts to one or more requirements/,
  },
  {
    name: "an unreferenced supplemental artifact",
    options: { addSupplementalArtifact: true, omitRequirementForRole: "supplemental_operational_log" },
    expected: /listed evidence artifact is not bound to a requirement: evidence\/supplemental\.json/,
  },
  {
    name: "a duplicate listed artifact path",
    options: { mutateManifest: manifest => { manifest.artifacts.push({ ...manifest.artifacts[0] }); } },
    expected: /duplicate artifact path is prohibited/,
  },
  {
    name: "a duplicate artifact reference within one requirement",
    options: { mutateManifest: manifest => { manifest.requirements[0].artifactRefs.push(manifest.requirements[0].artifactRefs[0]); } },
    expected: /requirement has a duplicate artifact reference/,
  },
  {
    name: "an unknown artifact reference",
    options: { mutateManifest: manifest => { manifest.requirements[0].artifactRefs = ["evidence/unlisted.json"]; } },
    expected: /requirement references an unlisted artifact/,
  },
]) {
  test(`verify-only protected importer rejects ${graphCase.name} before persistence`, () => {
    const fixture = buildSignedVerificationOnlyFixture(graphCase.options);
    try {
      const result = invokeVerificationOnlyFixture(fixture);
      assert.equal(result.status, 2);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, graphCase.expected);
    } finally {
      rmSync(fixture.evidenceRoot, { recursive: true, force: true });
      rmSync(fixture.trustRoot, { recursive: true, force: true });
    }
  });
}

for (const reuseCase of [
  { name: "reused signer identity across distinct key IDs", options: { reuseReviewerIdentity: true } },
  { name: "reused signing key across both attestation kinds", options: { reuseReviewerKey: true } },
]) {
  test(`verify-only protected importer rejects ${reuseCase.name} after individual cryptographic verification`, () => {
    const fixture = buildSignedVerificationOnlyFixture(reuseCase.options);
    try {
      const result = invokeVerificationOnlyFixture(fixture);
      assert.equal(result.status, 2);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /owner and independent reviewer signing identities and keys must differ/);
    } finally {
      rmSync(fixture.evidenceRoot, { recursive: true, force: true });
      rmSync(fixture.trustRoot, { recursive: true, force: true });
    }
  });
}
