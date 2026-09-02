const forbiddenProductionValues = new Set([
  "mock",
  "stub",
  "simulate",
  "simulation",
  "demo",
  "test",
]);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value)
    throw new Error(`[production-gate] ${name} is required in production`);
  return value;
}

function enabled(name: string): boolean {
  return ["true", "1", "yes"].includes(
    (process.env[name] ?? "").trim().toLowerCase()
  );
}

function requireDisabledUntilExternalApproval(name: string): void {
  if (enabled(name) && !enabled("EXTERNAL_INTEGRATION_RELEASE_APPROVED")) {
    throw new Error(
      `[production-gate] ${name} must remain disabled until EXTERNAL_INTEGRATION_RELEASE_APPROVED=true is set by the protected release process`
    );
  }
}

export function assertProductionGates(): void {
  if (process.env.NODE_ENV !== "production") return;

  const paymentMode = required("PAYMENT_EXECUTION_MODE").toLowerCase();
  if (paymentMode !== "disabled" && paymentMode !== "sandbox") {
    throw new Error(
      "[production-gate] PAYMENT_EXECUTION_MODE must remain disabled or sandbox until payment evidence is approved"
    );
  }

  // Unverified external decision and automation paths are disabled by default.
  // The protected release workflow may permit them only after the independent
  // evidence validator has approved the associated artifact package.
  requireDisabledUntilExternalApproval("GOVERNED_OUTCOME_PREDICTIONS_ENABLED");
  // CMS has no authorized submission API. This capability remains a human-portal
  // handoff regardless of external release approval; automated HTTP delivery
  // must not be enabled or represented as a submission to the CMS IDR portal.
  if (enabled("CMS_AUTOMATION_ENABLED")) {
    throw new Error(
      "[production-gate] CMS_AUTOMATION_ENABLED must remain false: only authenticated human portal handoff is supported"
    );
  }
  requireDisabledUntilExternalApproval("DOCUMENT_ANALYSIS_REQUIRED");
  requireDisabledUntilExternalApproval("TEMPORAL_EXECUTION_ENABLED");
  if (enabled("GOVERNED_OUTCOME_PREDICTIONS_ENABLED")) {
    if ((process.env.GOVERNED_OUTCOME_RUNTIME ?? "").trim() !== "georgetown") {
      throw new Error(
        "[production-gate] GOVERNED_OUTCOME_RUNTIME must be georgetown when live outcome predictions are enabled"
      );
    }
    for (const name of [
      "GEORGETOWN_MODEL_ID",
      "GEORGETOWN_MODEL_VERSION",
      "GEORGETOWN_MODEL_URL",
      "GEORGETOWN_MODEL_TOKEN",
    ]) {
      required(name);
    }
    if (!/^https:\/\//i.test(process.env.GEORGETOWN_MODEL_URL ?? "")) {
      throw new Error(
        "[production-gate] GEORGETOWN_MODEL_URL must use HTTPS in production"
      );
    }
  }

  const simulatorFlags = [
    "CMS_SIMULATOR_ENABLED",
    "DOCUMENT_ANALYSIS_SIMULATOR_ENABLED",
    "GEORGETOWN_SIMULATOR_ENABLED",
    "FRAUD_SIMULATOR_ENABLED",
  ];
  for (const flag of simulatorFlags) {
    if (
      ["true", "1", "yes"].includes(
        (process.env[flag] ?? "").trim().toLowerCase()
      )
    ) {
      throw new Error(
        `[production-gate] ${flag} cannot be enabled in production`
      );
    }
  }

  if (enabled("DOCUMENT_ANALYSIS_REQUIRED")) {
    const value = required("DOCUMENT_ANALYSIS_URL");
    if (!/^https:\/\//i.test(value))
      throw new Error(
        "[production-gate] DOCUMENT_ANALYSIS_URL must use HTTPS in production"
      );
  }

  for (const name of ["DOCUMENT_ANALYSIS_URL", "GEORGETOWN_MODEL_ID"]) {
    const value = process.env[name]?.toLowerCase() ?? "";
    if (
      Array.from(forbiddenProductionValues).some(marker =>
        value.includes(marker)
      )
    ) {
      throw new Error(
        `[production-gate] ${name} appears to reference a mock/simulation endpoint or identifier`
      );
    }
  }
}
