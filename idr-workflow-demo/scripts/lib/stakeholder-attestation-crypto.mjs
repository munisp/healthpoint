import { createHash, createPublicKey, verify } from "node:crypto";

const sha256 = value => createHash("sha256").update(value).digest("hex");
const sha256Pattern = /^[a-f0-9]{64}$/;

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

export function attestationPayload(manifest, kind) {
  const party = kind === "owner" ? manifest?.owner : manifest?.independentReviewer;
  if (!party || typeof party !== "object") throw new Error(`${kind} party is required`);
  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts.map(item => ({ path: item.path, sha256: item.sha256, role: item.role ?? item.artifactRole ?? null })).sort((a, b) => String(a.path).localeCompare(String(b.path))) : [];
  const requirements = Array.isArray(manifest.requirements) ? manifest.requirements.map(item => ({ requirement: item.requirement, artifactRefs: [...(item.artifactRefs ?? [])].sort() })).sort((a, b) => String(a.requirement).localeCompare(String(b.requirement))) : [];
  return Buffer.from(canonicalize({
    version: "healthpoint-stakeholder-attestation-v1",
    kind,
    claimId: manifest?.claimId,
    claimStatement: manifest?.claimStatement,
    claimType: manifest?.claimType,
    environment: manifest?.environment,
    completedAt: manifest?.completedAt,
    manifestSha256: manifest?.manifestSha256 ?? null,
    party: {
      name: party.name,
      role: party.role,
      reviewerIdentity: party.reviewerIdentity,
      approvedAt: party.approvedAt,
      signingKeyId: party.signingKeyId,
    },
    artifacts,
    requirements,
  }));
}

function findKey(trustStore, keyId) {
  const keys = Array.isArray(trustStore?.keys) ? trustStore.keys : Array.isArray(trustStore) ? trustStore : [];
  return keys.find(key => key?.keyId === keyId);
}

export function verifyAttestation({ manifest, kind, trustStore, now = new Date() }) {
  const errors = [];
  const party = kind === "owner" ? manifest?.owner : manifest?.independentReviewer;
  if (!party || typeof party !== "object") return { verified: false, errors: [`${kind} party is missing`] };
  const keyId = party.signingKeyId;
  const signerIdentity = party.reviewerIdentity;
  if (typeof keyId !== "string" || !keyId) errors.push("signingKeyId is required");
  if (typeof signerIdentity !== "string" || !signerIdentity) errors.push("reviewerIdentity is required");
  if (typeof party.signatureBase64 !== "string" || !party.signatureBase64) errors.push("signatureBase64 is required");
  const key = findKey(trustStore, keyId);
  if (!key) errors.push("signing key is not in the trusted registry");
  if (key?.status !== "active") errors.push("signing key is not active");
  if (key?.subjectIdentity !== signerIdentity) errors.push("signing key subject does not match reviewer identity");
  if (!Array.isArray(key?.permittedAttestationKinds) || !key.permittedAttestationKinds.includes(kind)) errors.push("signing key is not permitted for this attestation kind");
  const validFrom = key?.validFrom == null ? undefined : new Date(key.validFrom);
  const validUntil = key?.validUntil == null ? undefined : new Date(key.validUntil);
  if (validFrom && Number.isNaN(validFrom.getTime())) errors.push("signing key validFrom is not a valid timestamp");
  else if (validFrom && validFrom > now) errors.push("signing key is not yet valid");
  if (validUntil && Number.isNaN(validUntil.getTime())) errors.push("signing key validUntil is not a valid timestamp");
  else if (validUntil && validUntil <= now) errors.push("signing key has expired");
  let payload;
  try { payload = attestationPayload(manifest, kind); } catch (error) { errors.push(error instanceof Error ? error.message : "failed to build canonical signed payload"); }
  if (payload && party.signedPayloadSha256 !== sha256(payload)) errors.push("signed payload SHA-256 does not match the canonical attestation payload");
  if (payload && typeof party.signatureBase64 === "string" && key?.publicKeyPem) {
    try {
      const signature = Buffer.from(party.signatureBase64, "base64");
      if (!signature.length || !verify(null, payload, createPublicKey(key.publicKeyPem), signature)) errors.push("Ed25519 signature did not verify");
    } catch {
      errors.push("signature or public key is invalid");
    }
  }
  return { verified: errors.length === 0, errors, keyId, signerIdentity, signedPayloadSha256: payload ? sha256(payload) : undefined };
}

export const SHA256_PATTERN = sha256Pattern;
