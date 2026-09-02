import { afterEach, describe, expect, it } from "vitest";
import { assertProductionGates } from "./production-gates";

const originalEnv = { ...process.env };

function setProductionBaseline(): void {
  process.env.NODE_ENV = "production";
  process.env.PAYMENT_EXECUTION_MODE = "disabled";
  process.env.CMS_GATEWAY_URL = "https://cms.healthpoint.example";
  process.env.DOCUMENT_ANALYSIS_URL = "https://analysis.healthpoint.example";
  process.env.GEORGETOWN_MODEL_ID = "georgetown-idr";
  process.env.GOVERNED_OUTCOME_PREDICTIONS_ENABLED = "false";
  process.env.CMS_AUTOMATION_ENABLED = "false";
  process.env.TEMPORAL_EXECUTION_ENABLED = "false";
  process.env.EXTERNAL_INTEGRATION_RELEASE_APPROVED = "false";
}

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

describe("production external integration lockdown", () => {
  it("permits a production baseline with all unverified integrations disabled", () => {
    setProductionBaseline();
    expect(assertProductionGates).not.toThrow();
  });

  it("rejects live outcome predictions before protected release approval", () => {
    setProductionBaseline();
    process.env.GOVERNED_OUTCOME_PREDICTIONS_ENABLED = "true";
    expect(assertProductionGates).toThrow(
      "GOVERNED_OUTCOME_PREDICTIONS_ENABLED must remain disabled"
    );
  });

  it("rejects CMS and Temporal automation before protected release approval", () => {
    setProductionBaseline();
    process.env.CMS_AUTOMATION_ENABLED = "true";
    expect(assertProductionGates).toThrow(
      "CMS_AUTOMATION_ENABLED must remain false: only authenticated human portal handoff is supported"
    );

    setProductionBaseline();
    process.env.TEMPORAL_EXECUTION_ENABLED = "true";
    expect(assertProductionGates).toThrow(
      "TEMPORAL_EXECUTION_ENABLED must remain disabled"
    );
  });

  it("requires the Georgetown-only HTTPS runtime contract after protected release approval", () => {
    setProductionBaseline();
    process.env.EXTERNAL_INTEGRATION_RELEASE_APPROVED = "true";
    process.env.GOVERNED_OUTCOME_PREDICTIONS_ENABLED = "true";
    process.env.GOVERNED_OUTCOME_RUNTIME = "gpt-5";
    expect(assertProductionGates).toThrow(
      "GOVERNED_OUTCOME_RUNTIME must be georgetown"
    );

    process.env.GOVERNED_OUTCOME_RUNTIME = "georgetown";
    process.env.GEORGETOWN_MODEL_VERSION = "2026.01";
    process.env.GEORGETOWN_MODEL_URL =
      "http://model.healthpoint.example/predict";
    process.env.GEORGETOWN_MODEL_TOKEN = "strong-test-token";
    expect(assertProductionGates).toThrow(
      "GEORGETOWN_MODEL_URL must use HTTPS"
    );

    process.env.GEORGETOWN_MODEL_URL =
      "https://model.healthpoint.example/predict";
    expect(assertProductionGates).not.toThrow();
  });
});
