import { createHash, randomUUID } from "node:crypto";
import { decryptCredentials, encryptCredentials } from "./credential-crypto";

export class EmrSandboxSimulationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmrSandboxSimulationError";
  }
}

export type EmrSandboxSimulationResult = {
  simulationId: string;
  mode: "test-only";
  encryptedCredentialFingerprint: string;
  credentialKeysValidated: string[];
  externalConnectionAttempted: false;
};

/**
 * Exercises the credential-encryption lifecycle without contacting an EMR,
 * creating clinical records, or exposing plaintext credentials. This helper is
 * prohibited in production so it cannot be mistaken for an integration path.
 */
export function simulateEncryptedEmrCredentialLifecycle(
  credentials: Record<string, string>
): EmrSandboxSimulationResult {
  if (process.env.NODE_ENV === "production") {
    throw new EmrSandboxSimulationError("EMR sandbox simulation is prohibited in production");
  }
  if (!Object.keys(credentials).length || Object.values(credentials).some(value => !value)) {
    throw new EmrSandboxSimulationError("Simulation requires non-empty credential values");
  }

  const envelope = encryptCredentials(credentials);
  const recovered = decryptCredentials(envelope);
  const expectedKeys = Object.keys(credentials).sort();
  const recoveredKeys = Object.keys(recovered).sort();
  if (JSON.stringify(expectedKeys) !== JSON.stringify(recoveredKeys)) {
    throw new EmrSandboxSimulationError("Encrypted credential key set did not round-trip");
  }

  return {
    simulationId: randomUUID(),
    mode: "test-only",
    encryptedCredentialFingerprint: createHash("sha256").update(envelope).digest("hex"),
    credentialKeysValidated: recoveredKeys,
    externalConnectionAttempted: false,
  };
}
