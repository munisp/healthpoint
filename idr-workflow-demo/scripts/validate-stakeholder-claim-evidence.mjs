#!/usr/bin/env node
import { createHash } from "node:crypto";
import { verifyAttestation } from "./lib/stakeholder-attestation-crypto.mjs";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const root = process.cwd();
const args = process.argv.slice(2);
const argValue = name =>
  args.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1);
const registerPath = resolve(
  root,
  argValue("--register") ?? "docs/stakeholder-deck-claim-register.json"
);
const evidenceArg = argValue("--evidence-root");
const trustStoreArg = argValue("--trust-store");
const outputPath = resolve(
  root,
  argValue("--output") ?? "artifacts/stakeholder-claim-evidence-validation.json"
);

const fail = (error, exitCode = 2) => {
  console.error(JSON.stringify({ valid: false, error }, null, 2));
  process.exit(exitCode);
};
if (process.env.EVIDENCE_EXECUTION !== "protected") {
  fail(
    "EVIDENCE_EXECUTION=protected is required; local, mock, and ad-hoc evidence validation is prohibited."
  );
}
if (!evidenceArg) fail("--evidence-root=<protected directory> is required.");
if (!trustStoreArg)
  fail("--trust-store=<protected trusted key registry> is required.");
const evidenceRoot = isAbsolute(evidenceArg)
  ? evidenceArg
  : resolve(root, evidenceArg);
if (!existsSync(registerPath)) fail(`Missing claim register: ${registerPath}`);
if (!existsSync(evidenceRoot) || !statSync(evidenceRoot).isDirectory())
  fail(`Evidence root must be an existing directory: ${evidenceRoot}`);
const trustStorePath = isAbsolute(trustStoreArg)
  ? trustStoreArg
  : resolve(root, trustStoreArg);
if (!existsSync(trustStorePath) || !statSync(trustStorePath).isFile())
  fail(
    `Trusted signing-key registry must be an existing file: ${trustStorePath}`
  );
const isInside = (base, target) => {
  const rel = relative(base, target);
  return (
    rel !== "" &&
    !rel.startsWith(`..${sep}`) &&
    rel !== ".." &&
    !isAbsolute(rel)
  );
};
if (isInside(evidenceRoot, trustStorePath))
  fail(
    "Trusted signing-key registry must be managed outside the evidence root."
  );
let trustStore;
try {
  trustStore = JSON.parse(readFileSync(trustStorePath, "utf8"));
} catch {
  fail("Trusted signing-key registry is not valid JSON.");
}

const register = JSON.parse(readFileSync(registerPath, "utf8"));
const blockedClaims = register.claims.filter(
  claim => claim.status === "blocked"
);
const markerPattern =
  /\b(?:mock|synthetic|fixture|placeholder|replace[_ -]?with|example[_ -]?only|test[_ -]?only|dummy|sample[_ -]?data)\b/i;
const sha256Pattern = /^[a-f0-9]{64}$/;
const digest = filePath =>
  createHash("sha256").update(readFileSync(filePath)).digest("hex");

const results = blockedClaims.map(claim => {
  const claimRoot = resolve(evidenceRoot, claim.id);
  const manifestPath = resolve(claimRoot, "manifest.json");
  const errors = [];
  const warnings = [];
  let manifest;
  if (!isInside(evidenceRoot, claimRoot))
    errors.push("Claim evidence directory escapes evidence root.");
  if (!existsSync(manifestPath)) {
    errors.push("Missing manifest.json.");
    return {
      id: claim.id,
      claim: claim.claim,
      verified: false,
      errors,
      warnings,
    };
  }
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    errors.push("manifest.json is not valid JSON.");
    return {
      id: claim.id,
      claim: claim.claim,
      verified: false,
      errors,
      warnings,
    };
  }
  if (manifest.schemaVersion !== "1.0")
    errors.push("schemaVersion must equal 1.0.");
  if (manifest.claimId !== claim.id)
    errors.push("manifest claimId does not match claim register.");
  if (manifest.environment !== "production")
    errors.push(
      "Evidence environment must be production or an approved production pilot recorded as production evidence."
    );
  if (!manifest.completedAt || Number.isNaN(Date.parse(manifest.completedAt)))
    errors.push("completedAt must be an ISO timestamp.");
  if (
    !manifest.realDataAttestation?.nonSynthetic ||
    !manifest.realDataAttestation?.notMock
  )
    errors.push(
      "Real-data attestation must explicitly state nonSynthetic=true and notMock=true."
    );
  if (
    !manifest.realDataAttestation?.sourceSystem ||
    markerPattern.test(manifest.realDataAttestation.sourceSystem)
  )
    errors.push(
      "realDataAttestation.sourceSystem must identify a non-test evidence source."
    );
  if (
    !manifest.owner?.name ||
    !manifest.owner?.role ||
    !manifest.owner?.approvedAt
  )
    errors.push("Owner name, role, and approval timestamp are required.");
  if (
    !manifest.independentReviewer?.name ||
    !manifest.independentReviewer?.role ||
    !manifest.independentReviewer?.approvedAt
  )
    errors.push(
      "Independent reviewer name, role, and approval timestamp are required."
    );
  if (
    manifest.owner?.name &&
    manifest.owner.name === manifest.independentReviewer?.name
  )
    errors.push(
      "Independent reviewer must be different from the evidence owner."
    );
  const ownerAttestation = verifyAttestation({
    manifest,
    kind: "owner",
    trustStore,
  });
  const reviewerAttestation = verifyAttestation({
    manifest,
    kind: "independent_reviewer",
    trustStore,
  });
  for (const error of ownerAttestation.errors)
    errors.push(`Owner cryptographic attestation: ${error}`);
  for (const error of reviewerAttestation.errors)
    errors.push(`Independent reviewer cryptographic attestation: ${error}`);
  if (
    ownerAttestation.verified &&
    reviewerAttestation.verified &&
    (ownerAttestation.keyId === reviewerAttestation.keyId ||
      ownerAttestation.signerIdentity === reviewerAttestation.signerIdentity)
  )
    errors.push(
      "Owner and independent reviewer must use distinct verified signing identities and keys."
    );
  if (
    !Array.isArray(manifest.requirements) ||
    manifest.requirements.length !== claim.requiredExternalEvidence.length
  )
    errors.push(
      "Manifest requirements must cover each declared external-evidence requirement exactly once."
    );
  else {
    const declared = new Set(claim.requiredExternalEvidence);
    const supplied = new Set(
      manifest.requirements.map(requirement => requirement.requirement)
    );
    if (
      declared.size !== supplied.size ||
      [...declared].some(requirement => !supplied.has(requirement))
    )
      errors.push(
        "Manifest requirements do not exactly match the claim register's external-evidence requirements."
      );
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0)
    errors.push("At least one hashed artifact is required.");
  for (const artifact of manifest.artifacts ?? []) {
    if (!artifact.path || typeof artifact.path !== "string") {
      errors.push("Each artifact requires a relative path.");
      continue;
    }
    if (isAbsolute(artifact.path) || artifact.path.includes("..")) {
      errors.push(`Unsafe artifact path: ${artifact.path}`);
      continue;
    }
    const artifactPath = resolve(claimRoot, artifact.path);
    if (
      !isInside(claimRoot, artifactPath) ||
      !existsSync(artifactPath) ||
      !statSync(artifactPath).isFile()
    ) {
      errors.push(
        `Artifact is missing or outside claim root: ${artifact.path}`
      );
      continue;
    }
    if (!sha256Pattern.test(artifact.sha256 ?? ""))
      errors.push(`Artifact SHA-256 is invalid: ${artifact.path}`);
    else if (digest(artifactPath) !== artifact.sha256)
      errors.push(`Artifact SHA-256 mismatch: ${artifact.path}`);
    const artifactText = readFileSync(artifactPath)
      .subarray(0, 1024)
      .toString("utf8");
    if (markerPattern.test(artifact.path) || markerPattern.test(artifactText))
      errors.push(
        `Artifact contains a prohibited test/mock/placeholder marker: ${artifact.path}`
      );
  }
  for (const requirement of manifest.requirements ?? []) {
    if (
      !Array.isArray(requirement.artifactRefs) ||
      requirement.artifactRefs.length === 0
    )
      errors.push(
        `Requirement has no artifact references: ${requirement.requirement}`
      );
  }
  if (claim.type.includes("numeric")) {
    const metrics = manifest.metrics;
    if (
      !metrics?.metricName ||
      !Number.isFinite(metrics.value) ||
      !Number.isFinite(metrics.numerator) ||
      !Number.isFinite(metrics.denominator) ||
      metrics.denominator <= 0
    )
      errors.push(
        "Numeric claim requires finite value, numerator, and positive denominator metrics."
      );
    if (!metrics?.methodologyArtifact)
      errors.push("Numeric claim requires a methodology artifact reference.");
  }
  if (claim.type === "model" || claim.type === "numeric_model_outcome") {
    for (const field of [
      "modelArtifactSha256",
      "datasetSha256",
      "calibrationArtifact",
      "independentModelApprovalArtifact",
    ]) {
      if (!manifest.modelEvidence?.[field])
        errors.push(`Model claim is missing modelEvidence.${field}.`);
    }
  }
  if (
    claim.id === "DECK-03-CMS-SUBMISSION" ||
    claim.id === "DECK-14-FILE-TODAY"
  ) {
    for (const field of [
      "receiptId",
      "bundleSha256",
      "feedbackArtifact",
      "operatorAttestationArtifact",
    ]) {
      if (!manifest.cmsEvidence?.[field])
        errors.push(`CMS claim is missing cmsEvidence.${field}.`);
    }
  }
  return {
    id: claim.id,
    claim: claim.claim,
    verified: errors.length === 0,
    errors,
    warnings,
  };
});

const summary = {
  totalBlockedClaims: results.length,
  verifiedClaims: results.filter(result => result.verified).length,
  blockedClaims: results.filter(result => !result.verified).length,
  releaseSupported: results.every(result => result.verified),
};
const report = {
  generatedAt: new Date().toISOString(),
  evidenceRoot,
  trustStorePath,
  cryptographicAttestationVerification: "ed25519",
  summary,
  claims: results,
  verdict: summary.releaseSupported ? "SUPPORTED" : "NOT_SUPPORTED",
};
mkdirSync(resolve(outputPath, ".."), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
process.exit(summary.releaseSupported ? 0 : 2);
