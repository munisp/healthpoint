#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import postgres from "postgres";
import { verifyAttestation } from "./lib/stakeholder-attestation-crypto.mjs";

const args = process.argv.slice(2);
const arg = name => args.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
const verifyOnly = args.includes("--verify-only");
const fail = message => { console.error(`TIGERBEETLE_EVIDENCE_IMPORT_REFUSED: ${message}`); process.exit(2); };
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const hashPattern = /^[a-f0-9]{64}$/;
const marker = /\b(?:mock|synthetic|fixture|placeholder|replace[_ -]?with|example[_ -]?only|test[_ -]?only|dummy|sample[_ -]?data)\b/i;
const isInside = (base, target) => {
  const path = relative(base, target);
  return path !== "" && !path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path);
};

if (process.env.EVIDENCE_EXECUTION !== "protected") fail("EVIDENCE_EXECUTION=protected is required");
if (process.env.NODE_ENV === "test" || process.env.ALLOW_MOCK_FIXTURES === "true") fail("test/mock execution is prohibited");
const mappingId = arg("--mapping-id");
const evidenceRootArg = arg("--evidence-root");
const trustStoreArg = arg("--trust-store");
const expectedClaimId = arg("--expected-claim-id");
const databaseUrl = process.env.EXTERNAL_POSTGRES_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!/^[0-9a-f-]{36}$/i.test(mappingId ?? "")) fail("--mapping-id must be a UUID");
if (verifyOnly && (!expectedClaimId || !/^tigerbeetle-finality:[A-Za-z0-9._-]+:[A-Z]{3}:[1-9][0-9]*$/.test(expectedClaimId))) fail("--verify-only requires a canonical --expected-claim-id");
if (!verifyOnly) {
  if (!databaseUrl || !/^(postgres|postgresql):\/\//.test(databaseUrl)) fail("a protected PostgreSQL URL is required");
  let databaseHost;
  try { databaseHost = new URL(databaseUrl).hostname; } catch { fail("PostgreSQL URL is invalid"); }
  if (!databaseHost || /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|::1)$/i.test(databaseHost)) fail("loopback PostgreSQL targets are prohibited");
}
if (!evidenceRootArg || !trustStoreArg) fail("--evidence-root and --trust-store are required");
const evidenceRoot = resolve(evidenceRootArg);
const trustStorePath = resolve(trustStoreArg);
if (!existsSync(evidenceRoot) || !statSync(evidenceRoot).isDirectory()) fail("evidence root is not an existing directory");
if (!existsSync(trustStorePath) || !statSync(trustStorePath).isFile() || isInside(evidenceRoot, trustStorePath)) fail("trust store must be an existing file outside the evidence root");
if (marker.test(evidenceRoot) || marker.test(trustStorePath)) fail("test/mock/placeholder paths are prohibited");
const manifestPath = resolve(evidenceRoot, "manifest.json");
if (!existsSync(manifestPath)) fail("manifest.json is required in evidence root");
let manifest, trustStore;
try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); trustStore = JSON.parse(readFileSync(trustStorePath, "utf8")); } catch { fail("manifest or trust store is not valid JSON"); }
if (manifest?.schemaVersion !== "1.0" || manifest?.environment !== "staging") fail("manifest schemaVersion=1.0 and environment=staging are required");
if (manifest?.claimType !== "tigerbeetle_finality_mapping") fail("manifest claimType must be tigerbeetle_finality_mapping");
if (!manifest?.realDataAttestation?.nonSynthetic || !manifest?.realDataAttestation?.notMock || marker.test(String(manifest?.realDataAttestation?.sourceSystem ?? ""))) fail("manifest must attest nonSynthetic=true, notMock=true, and non-test source system");
if (!manifest?.completedAt || Number.isNaN(Date.parse(manifest.completedAt))) fail("manifest completedAt must be an ISO timestamp");
if (!Array.isArray(manifest?.artifacts) || !manifest.artifacts.length) fail("manifest must list hashed evidence artifacts");
const requiredRoles = new Set(["tigerbeetle_account_verification", "tigerbeetle_mtls_readiness", "tigerbeetle_topology_validation", "tigerbeetle_finality_sandbox_result"]);
const roles = new Set();
const artifactRolesByPath = new Map();
const verifiedArtifacts = [];
for (const artifact of manifest.artifacts) {
  if (!artifact?.path || typeof artifact.path !== "string" || isAbsolute(artifact.path) || artifact.path.includes("..")) fail("every artifact path must be safe and relative");
  if (!hashPattern.test(artifact.sha256 ?? "")) fail(`invalid artifact SHA-256 for ${artifact.path}`);
  const artifactPath = resolve(evidenceRoot, artifact.path);
  if (!isInside(evidenceRoot, artifactPath) || !existsSync(artifactPath) || !statSync(artifactPath).isFile()) fail(`artifact is missing or outside evidence root: ${artifact.path}`);
  const bytes = readFileSync(artifactPath);
  if (sha256(bytes) !== artifact.sha256) fail(`artifact SHA-256 mismatch: ${artifact.path}`);
  if (marker.test(artifact.path) || marker.test(bytes.subarray(0, 1024).toString("utf8"))) fail(`artifact contains a prohibited marker: ${artifact.path}`);
  const role = artifact.role ?? artifact.artifactRole;
  if (typeof role !== "string" || !role) fail(`artifact role is required: ${artifact.path}`);
  if (artifactRolesByPath.has(artifact.path)) fail(`duplicate artifact path is prohibited: ${artifact.path}`);
  roles.add(role);
  artifactRolesByPath.set(artifact.path, role);
  verifiedArtifacts.push({ relativePath: artifact.path, artifactRole: role, sha256: artifact.sha256, byteSize: bytes.length, artifactCreatedAt: artifact.createdAt && !Number.isNaN(Date.parse(artifact.createdAt)) ? new Date(artifact.createdAt) : new Date(statSync(artifactPath).mtimeMs) });
}
for (const role of requiredRoles) if (!roles.has(role)) fail(`required finality evidence role is absent: ${role}`);
if (!Array.isArray(manifest.requirements) || !manifest.requirements.length) fail("manifest must bind evidence artifacts to one or more requirements");
const referencedArtifactPaths = new Set();
const coveredRequiredRoles = new Set();
for (const requirement of manifest.requirements) {
  if (!requirement || typeof requirement.requirement !== "string" || !requirement.requirement.trim()) fail("every requirement must have a non-empty requirement identifier");
  if (!Array.isArray(requirement.artifactRefs) || !requirement.artifactRefs.length) fail(`requirement must reference one or more artifacts: ${requirement.requirement}`);
  const refsForRequirement = new Set();
  for (const artifactRef of requirement.artifactRefs) {
    if (typeof artifactRef !== "string" || !artifactRef || isAbsolute(artifactRef) || artifactRef.includes("..")) fail(`requirement has an unsafe artifact reference: ${requirement.requirement}`);
    if (refsForRequirement.has(artifactRef)) fail(`requirement has a duplicate artifact reference: ${requirement.requirement}`);
    const role = artifactRolesByPath.get(artifactRef);
    if (!role) fail(`requirement references an unlisted artifact: ${artifactRef}`);
    refsForRequirement.add(artifactRef);
    referencedArtifactPaths.add(artifactRef);
    if (requiredRoles.has(role)) coveredRequiredRoles.add(role);
  }
}
for (const role of requiredRoles) if (!coveredRequiredRoles.has(role)) fail(`required finality evidence role is not bound to a requirement: ${role}`);
for (const artifactPath of artifactRolesByPath.keys()) if (!referencedArtifactPaths.has(artifactPath)) fail(`listed evidence artifact is not bound to a requirement: ${artifactPath}`);
const owner = verifyAttestation({ manifest, kind: "owner", trustStore });
const reviewer = verifyAttestation({ manifest, kind: "independent_reviewer", trustStore });
if (!owner.verified) fail(`owner attestation verification failed: ${owner.errors.join("; ")}`);
if (!reviewer.verified) fail(`independent reviewer attestation verification failed: ${reviewer.errors.join("; ")}`);
if (owner.keyId === reviewer.keyId || owner.signerIdentity === reviewer.signerIdentity) fail("owner and independent reviewer signing identities and keys must differ");
const manifestSha256 = sha256(readFileSync(manifestPath));
const validationReportSha256 = sha256(JSON.stringify({ version: "tigerbeetle-finality-evidence-import-v1", mappingId, manifestSha256, artifactHashes: verifiedArtifacts.map(item => item.sha256).sort(), ownerKeyId: owner.keyId, reviewerKeyId: reviewer.keyId }));
if (verifyOnly) {
  if (manifest.claimId !== expectedClaimId) fail("manifest claimId does not match --expected-claim-id");
  console.log(JSON.stringify({ verified: true, persisted: false, mappingId, expectedClaimId, manifestSha256, validationReportSha256, artifactCount: verifiedArtifacts.length, ownerKeyId: owner.keyId, reviewerKeyId: reviewer.keyId }, null, 2));
  process.exit(0);
}

const sql = postgres(databaseUrl, { max: 1, idle_timeout: 5, connect_timeout: 10 });
try {
  await sql.begin(async tx => {
    const mappings = await tx`SELECT "id", "provider", "currency", "mappingVersion", "active", "approvedBy" FROM "tigerbeetle_finality_account_mappings" WHERE "id" = ${mappingId} FOR UPDATE`;
    const mapping = mappings[0];
    if (!mapping || mapping.active) fail("mapping draft does not exist or is already active");
    const expectedClaimId = `tigerbeetle-finality:${mapping.provider}:${mapping.currency}:${mapping.mappingVersion}`;
    if (manifest.claimId !== expectedClaimId) fail("manifest claimId does not match the mapping draft");
    if (manifest.owner?.reviewerIdentity !== mapping.approvedBy) fail("owner attestation identity must match mapping draft approver");
    const keyRows = await tx`SELECT "id", "keyId", "status", "subjectIdentity" FROM "stakeholder_claim_signing_keys" WHERE "keyId" IN (${owner.keyId}, ${reviewer.keyId}) FOR UPDATE`;
    if (keyRows.length !== 2 || keyRows.some(key => key.status !== "active")) fail("both signing keys must be registered and active in PostgreSQL");
    if (!keyRows.some(key => key.keyId === owner.keyId && key.subjectIdentity === owner.signerIdentity) || !keyRows.some(key => key.keyId === reviewer.keyId && key.subjectIdentity === reviewer.signerIdentity)) fail("database signing-key identities do not match verified attestations");
    const existing = await tx`SELECT "id" FROM "stakeholder_claim_evidence_bundles" WHERE "claimId" = ${expectedClaimId} AND "manifestSha256" = ${manifestSha256} FOR UPDATE`;
    if (existing[0]) fail("this manifest has already been imported");
    const bundleId = crypto.randomUUID();
    await tx`INSERT INTO "stakeholder_claim_evidence_bundles" ("id","claimId","claimStatement","claimType","schemaVersion","environment","evidenceRootUri","manifestSha256","validationReportSha256","sourceSystem","dataClassification","collectionStartedAt","collectionEndedAt","completedAt","status") VALUES (${bundleId},${expectedClaimId},${String(manifest.claimStatement ?? "TigerBeetle finality mapping evidence")},'tigerbeetle_finality_mapping','1.0','staging',${String(manifest.evidenceRootUri ?? "protected://tigerbeetle-finality-evidence")},${manifestSha256},${validationReportSha256},${String(manifest.realDataAttestation.sourceSystem)},${String(manifest.dataClassification ?? "confidential_operational")},${manifest.collectionStartedAt ? new Date(manifest.collectionStartedAt) : null},${manifest.collectionEndedAt ? new Date(manifest.collectionEndedAt) : null},${new Date(manifest.completedAt)},'pending_review')`;
    for (const artifact of verifiedArtifacts) await tx`INSERT INTO "stakeholder_claim_evidence_artifacts" ("id","bundleId","relativePath","artifactRole","sha256","byteSize","artifactCreatedAt","metadata") VALUES (${crypto.randomUUID()},${bundleId},${artifact.relativePath},${artifact.artifactRole},${artifact.sha256},${artifact.byteSize},${artifact.artifactCreatedAt},{})`;
    for (const [kind, result, party] of [["owner", owner, manifest.owner], ["independent_reviewer", reviewer, manifest.independentReviewer]]) {
      const dbKey = keyRows.find(key => key.keyId === result.keyId);
      await tx`INSERT INTO "stakeholder_claim_reviewer_attestations" ("id","bundleId","kind","reviewerName","reviewerRole","reviewerIdentity","approvedAt","signingKeyId","signatureAlgorithm","signatureBase64","signedPayloadSha256","cryptographicallyVerifiedAt","cryptographicVerifierVersion","attestationSha256","attestationText") VALUES (${crypto.randomUUID()},${bundleId},${kind},${String(party.name)},${String(party.role)},${result.signerIdentity},${new Date(party.approvedAt)},${dbKey.id},'ed25519',${party.signatureBase64},${result.signedPayloadSha256},now(),'tigerbeetle-finality-evidence-import-v1',${sha256(JSON.stringify(party))},${String(party.attestationText ?? `${kind} attestation`)})`;
    }
    await tx`UPDATE "stakeholder_claim_evidence_bundles" SET "status" = 'validated', "validatedBy" = ${reviewer.signerIdentity}, "validatedAt" = now() WHERE "id" = ${bundleId} AND "status" = 'pending_review'`;
    console.log(JSON.stringify({ imported: true, bundleId, mappingId, manifestSha256, validationReportSha256, artifactCount: verifiedArtifacts.length }, null, 2));
  });
} finally {
  await sql.end({ timeout: 5 });
}
