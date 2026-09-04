import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";

const root = process.cwd();
const args = process.argv.slice(2);
const argValue = name =>
  args.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1);
const output = resolve(
  root,
  argValue("--output") ||
    process.env.RELEASE_BLOCKER_REPORT ||
    "artifacts/external-release-blocker-validation.json"
);
const evidenceDirArg = argValue("--evidence-dir") || process.env.RELEASE_EVIDENCE_DIR;
const evidenceDir = evidenceDirArg
  ? resolve(root, evidenceDirArg)
  : undefined;
const placeholderPattern =
  /(?:placeholder|example\.com|synthetic|dummy|mock|fake|todo|tbd|changeme|local-integration)/i;
const sha256Pattern = /^[a-f0-9]{64}$/i;
const isoTimestamp = value =>
  typeof value === "string" && !Number.isNaN(Date.parse(value));
const truthy = value => ["true", "1", "yes"].includes(String(value).toLowerCase());

function fail(message) {
  const report = {
    valid: false,
    generatedAt: new Date().toISOString(),
    error: message,
  };
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.error(JSON.stringify(report, null, 2));
  process.exit(2);
}

if (process.env.EVIDENCE_EXECUTION !== "protected") {
  fail(
    "EVIDENCE_EXECUTION=protected is required; local, mock, and ad-hoc evidence validation is prohibited."
  );
}
if (!evidenceDir) {
  fail("RELEASE_EVIDENCE_DIR or --evidence-dir=<protected directory> is required.");
}
if (!existsSync(evidenceDir) || !statSync(evidenceDir).isDirectory()) {
  fail(`Evidence directory is missing or not a directory: ${evidenceDir}`);
}

function isInside(base, target) {
  const rel = relative(base, target);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function configuredPath(envName) {
  const configured = process.env[envName]?.trim();
  const defaultPath = resolve(evidenceDir, `${envName.toLowerCase()}.json`);
  const path = configured ? resolve(root, configured) : defaultPath;
  if (!isInside(evidenceDir, path)) {
    return {
      error: `${envName} must resolve inside the protected evidence directory`,
      path,
    };
  }
  return { path };
}

function fileEvidence(label, envName, requiredPatterns = []) {
  const configured = configuredPath(envName);
  if (configured.error) {
    return { label, envName, status: "blocked", ...configured };
  }
  const { path } = configured;
  if (!existsSync(path)) {
    return {
      label,
      envName,
      status: "blocked",
      path,
      reason: `Missing evidence file for ${envName}`,
    };
  }
  const stat = statSync(path);
  if (!stat.isFile() || stat.size === 0) {
    return {
      label,
      envName,
      status: "blocked",
      path,
      reason: "Evidence file is empty or not a regular file",
    };
  }
  const bytes = readFileSync(path);
  const text = bytes.toString("utf8");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (placeholderPattern.test(text) || placeholderPattern.test(path)) {
    return {
      label,
      envName,
      status: "blocked",
      path,
      sha256,
      reason: "Evidence appears to contain placeholder or non-production markers",
    };
  }
  const missing = requiredPatterns
    .filter(pattern => !pattern.test(text))
    .map(pattern => pattern.source);
  if (missing.length) {
    return {
      label,
      envName,
      status: "blocked",
      path,
      sha256,
      reason: "Required metadata is missing",
      missingPatterns: missing,
    };
  }
  return {
    label,
    envName,
    status: "verified",
    path,
    filename: basename(path),
    bytes: stat.size,
    sha256,
  };
}

function structuredJsonEvidence(label, envName, requiredPatterns, validate) {
  const evidence = fileEvidence(label, envName, requiredPatterns);
  if (evidence.status !== "verified") return evidence;
  let payload;
  try {
    payload = JSON.parse(readFileSync(evidence.path, "utf8"));
  } catch {
    return {
      ...evidence,
      status: "blocked",
      reason: "Evidence must be a valid structured JSON record",
    };
  }
  const errors = validate(payload);
  if (errors.length) {
    return {
      ...evidence,
      status: "blocked",
      reason: "Structured evidence failed acceptance checks",
      errors,
    };
  }
  return evidence;
}

function requireNonPlaceholder(value, field, errors) {
  if (typeof value !== "string" || !value.trim() || placeholderPattern.test(value)) {
    errors.push(`${field} must be a non-placeholder string`);
  }
}

function validateDataUseApproval(payload) {
  const errors = [];
  if (payload?.evidence_type !== "model_data_use_approval")
    errors.push("evidence_type must equal model_data_use_approval");
  if (payload?.schema_version !== "1.0")
    errors.push("schema_version must equal 1.0");
  const approval = payload?.approval;
  if (!approval || typeof approval !== "object") {
    errors.push("approval object is required");
    return errors;
  }
  for (const field of [
    "approval_id",
    "approved_scope",
    "data_controller",
    "privacy_reviewer_id",
    "legal_reviewer_id",
    "retention_policy_uri",
    "redaction_or_deidentification_method",
    "dataset_id",
    "stop_decision_reason",
  ]) {
    requireNonPlaceholder(approval[field], `approval.${field}`, errors);
  }
  if (approval.decision !== "approved")
    errors.push("approval.decision must equal approved");
  if (approval.approved_purpose !== "model_validation")
    errors.push("approval.approved_purpose must equal model_validation");
  if (approval.stop_decision !== "proceed")
    errors.push("approval.stop_decision must equal proceed");
  if (!isoTimestamp(approval.approved_at))
    errors.push("approval.approved_at must be an ISO timestamp");
  if (!isoTimestamp(approval.expires_at))
    errors.push("approval.expires_at must be an ISO timestamp");
  if (isoTimestamp(approval.expires_at) && new Date(approval.expires_at) <= new Date())
    errors.push("approval.expires_at must be in the future");
  if (!sha256Pattern.test(approval.dataset_sha256 || ""))
    errors.push("approval.dataset_sha256 must be a SHA-256 digest");
  const attestation = payload?.attestation;
  if (!attestation || typeof attestation !== "object") {
    errors.push("attestation object is required");
  } else {
    requireNonPlaceholder(attestation.owner_id, "attestation.owner_id", errors);
    requireNonPlaceholder(
      attestation.independent_reviewer_id,
      "attestation.independent_reviewer_id",
      errors
    );
    if (attestation.owner_id === attestation.independent_reviewer_id)
      errors.push("attestation owner and independent reviewer must be distinct");
    if (!isoTimestamp(attestation.attested_at))
      errors.push("attestation.attested_at must be an ISO timestamp");
    if (!isoTimestamp(attestation.independently_reviewed_at))
      errors.push("attestation.independently_reviewed_at must be an ISO timestamp");
  }
  return errors;
}

function validateCmsPilotAuthorization(payload) {
  const errors = [];
  if (payload?.evidence_type !== "cms_pilot_authorization")
    errors.push("evidence_type must equal cms_pilot_authorization");
  if (payload?.schema_version !== "1.0")
    errors.push("schema_version must equal 1.0");
  const pilot = payload?.pilot;
  if (!pilot || typeof pilot !== "object") {
    errors.push("pilot object is required");
    return errors;
  }
  for (const field of [
    "authorization_id",
    "approved_scope",
    "approved_by",
    "operator_id",
    "operator_training_record_uri",
    "operator_training_record_sha256",
    "sop_uri",
    "sop_sha256",
    "escalation_owner_id",
    "stop_decision_reason",
  ]) {
    requireNonPlaceholder(pilot[field], `pilot.${field}`, errors);
  }
  if (pilot.decision !== "approved")
    errors.push("pilot.decision must equal approved");
  if (pilot.stop_decision !== "proceed")
    errors.push("pilot.stop_decision must equal proceed");
  if (!isoTimestamp(pilot.approved_at))
    errors.push("pilot.approved_at must be an ISO timestamp");
  if (!isoTimestamp(pilot.expires_at))
    errors.push("pilot.expires_at must be an ISO timestamp");
  if (isoTimestamp(pilot.expires_at) && new Date(pilot.expires_at) <= new Date())
    errors.push("pilot.expires_at must be in the future");
  if (!sha256Pattern.test(pilot.operator_training_record_sha256 || ""))
    errors.push("pilot.operator_training_record_sha256 must be a SHA-256 digest");
  if (!sha256Pattern.test(pilot.sop_sha256 || ""))
    errors.push("pilot.sop_sha256 must be a SHA-256 digest");
  return errors;
}

const checks = [
  {
    id: "DATA_USE",
    description:
      "Approved, in-scope, unexpired data-use authorization for governed model validation",
    evidence: [
      structuredJsonEvidence(
        "data-use approval",
        "DATA_USE_APPROVAL_RECORD",
        [/model.?data.?use|approval|dataset|privacy|legal/i],
        validateDataUseApproval
      ),
    ],
  },
  {
    id: "GEORGETOWN",
    description:
      "Real Georgetown model artifact, governed dataset, reproducible validation, and independent approval",
    evidence: [
      fileEvidence("model artifact", "GEORGETOWN_MODEL_ARTIFACT", [
        /sha.?256|model.?version|artifact/i,
      ]),
      fileEvidence("validation dataset", "GEORGETOWN_VALIDATION_DATASET", [
        /license|provenance|row.?count|sha.?256/i,
      ]),
      fileEvidence("calibration report", "GEORGETOWN_CALIBRATION_REPORT", [
        /brier|ece|auc|uncertainty|calibration/i,
      ]),
      fileEvidence("independent approval", "GEORGETOWN_APPROVAL_RECORD", [
        /reviewer|approval|approved.?at|decision/i,
      ]),
    ],
  },
  {
    id: "CMS",
    description:
      "Authorized human CMS portal pilot, receipt, feedback reconciliation, and owner sign-off",
    evidence: [
      structuredJsonEvidence(
        "CMS pilot authorization",
        "CMS_PILOT_AUTHORIZATION_RECORD",
        [/cms.?pilot|authorization|operator|sop|escalation/i],
        validateCmsPilotAuthorization
      ),
      fileEvidence("portal submission evidence", "CMS_SUBMISSION_EVIDENCE", [
        /operator|submitted|bundle|sha.?256|timestamp/i,
      ]),
      fileEvidence("CMS receipt", "CMS_RECEIPT_EVIDENCE", [
        /receipt|reference|submission.?id|cms/i,
      ]),
      fileEvidence("feedback reconciliation", "CMS_FEEDBACK_EVIDENCE", [
        /event.?id|feedback|hmac|reconcili|workflow/i,
      ]),
      fileEvidence("CMS owner certification", "CMS_CERTIFICATION_RECORD", [
        /owner|certif|approved|environment|date/i,
      ]),
    ],
  },
  {
    id: "PAYMENT",
    description:
      "Certified provider rail, secure callbacks, ledger invariants, reconciliation, and approvals",
    evidence: [
      fileEvidence("provider certification", "PAYMENT_PROVIDER_CERTIFICATION", [
        /provider|environment|certif|operations/i,
      ]),
      fileEvidence("callback security evidence", "PAYMENT_CALLBACK_EVIDENCE", [
        /mtls|certificate|signature|replay|idempot/i,
      ]),
      fileEvidence("ledger invariant report", "PAYMENT_LEDGER_REPORT", [
        /debit|credit|balance|conserv|bigint|invariant/i,
      ]),
      fileEvidence("provider reconciliation", "PAYMENT_RECONCILIATION_REPORT", [
        /settlement|reconcili|discrepanc|refund/i,
      ]),
      fileEvidence("financial/security approval", "PAYMENT_APPROVAL_RECORD", [
        /finance|security|reviewer|approved|approval/i,
      ]),
    ],
  },
  {
    id: "OPERATIONS",
    description:
      "Authenticated staging evidence for identity, document analysis, recovery, and production operations",
    evidence: [
      fileEvidence("authenticated staging E2E evidence", "STAGING_E2E_EVIDENCE", [
        /keycloak|permify|authenticated|release|image/i,
      ]),
      fileEvidence("document analysis evidence", "DOCUMENT_ANALYSIS_EVIDENCE", [
        /quarantine|paddleocr|docling|job|audit/i,
      ]),
      fileEvidence("recovery and rollback evidence", "OPERATIONS_RECOVERY_EVIDENCE", [
        /backup|restore|rollback|rto|rpo/i,
      ]),
      fileEvidence("operations approval", "OPERATIONS_APPROVAL_RECORD", [
        /owner|security|approved|date|environment/i,
      ]),
    ],
  },
  {
    id: "COMPLIANCE",
    description:
      "Completed compliance, legal, regulatory-content, and claim-review evidence",
    evidence: [
      fileEvidence("HIPAA risk analysis", "HIPAA_RISK_ANALYSIS", [
        /risk|safeguard|owner|remediation/i,
      ]),
      fileEvidence("BAA or legal review", "BAA_OR_LEGAL_REVIEW", [
        /baa|legal|scope|decision|approved/i,
      ]),
      fileEvidence("assurance record", "ASSURANCE_RECORD", [
        /soc.?2|assurance|control|period|review/i,
      ]),
      fileEvidence("regulatory-content governance", "REGULATORY_CONTENT_GOVERNANCE", [
        /source|version|review|change|approval/i,
      ]),
      fileEvidence("compliance approval", "COMPLIANCE_APPROVAL_RECORD", [
        /compliance|legal|reviewer|approved|date/i,
      ]),
    ],
  },
];

for (const check of checks) {
  check.status = check.evidence.every(item => item.status === "verified")
    ? "verified"
    : "blocked";
}
const report = {
  valid: checks.every(check => check.status === "verified"),
  generatedAt: new Date().toISOString(),
  repository: root,
  evidenceDir,
  protectedExecution: truthy(process.env.EVIDENCE_EXECUTION === "protected"),
  checks,
  summary: {
    verified: checks.filter(check => check.status === "verified").length,
    blocked: checks.filter(check => check.status === "blocked").length,
    releaseApproved: checks.every(check => check.status === "verified"),
  },
};
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.summary.releaseApproved) process.exitCode = 2;
