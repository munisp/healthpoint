import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const script = resolve("scripts/verify-tigerbeetle-finality-trigger-failure-modes.sh");
const missingApprovalMarker = "/tmp/healthpoint-trigger-test-missing-approval-marker";

function invoke(environment = {}) {
  return spawnSync("bash", [script], {
    cwd: resolve("."),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "test",
      HEALTHPOINT_ENVIRONMENT: "",
      HEALTHPOINT_ALLOW_LOCAL_TRIGGER_TEST: "",
      HEALTHPOINT_LOCAL_TRIGGER_TEST_DATABASE: "healthpoint_migration_test",
      HEALTHPOINT_LOCAL_TRIGGER_TEST_APPROVAL_FILE: missingApprovalMarker,
      CI: "",
      GITHUB_ACTIONS: "",
      ...environment,
    },
  });
}

function assertPreIoRefusal(result, expectedDiagnostic) {
  assert.equal(result.error, undefined, "guard subprocess must start normally");
  assert.equal(result.signal, null, "guard subprocess must exit deliberately, not by signal");
  assert.equal(result.status, 2, "guard must return the dedicated refusal exit code");
  assert.equal(result.stdout, "", "guard must refuse before emitting SQL/psql output");
  assert.match(result.stderr, expectedDiagnostic, "guard must identify the refusing control");
}

test("four-trigger rollback suite refuses without explicit local-test opt-in before I/O", () => {
  assertPreIoRefusal(invoke({}), /HEALTHPOINT_ALLOW_LOCAL_TRIGGER_TEST=true is required/);
});

for (const prohibitedInvocation of [
  {
    name: "declared staging environment",
    environment: { HEALTHPOINT_ALLOW_LOCAL_TRIGGER_TEST: "true", HEALTHPOINT_ENVIRONMENT: "staging" },
  },
  {
    name: "declared production environment",
    environment: { HEALTHPOINT_ALLOW_LOCAL_TRIGGER_TEST: "true", HEALTHPOINT_ENVIRONMENT: "production" },
  },
  {
    name: "production Node runtime",
    environment: { HEALTHPOINT_ALLOW_LOCAL_TRIGGER_TEST: "true", NODE_ENV: "production" },
  },
  {
    name: "production Node runtime plus staging target declaration",
    environment: { HEALTHPOINT_ALLOW_LOCAL_TRIGGER_TEST: "true", NODE_ENV: "production", HEALTHPOINT_ENVIRONMENT: "staging" },
  },
]) {
  test(`four-trigger rollback suite refuses ${prohibitedInvocation.name} before PostgreSQL access`, () => {
    assertPreIoRefusal(invoke(prohibitedInvocation.environment), /outside an explicitly local test environment/);
  });
}

test("four-trigger rollback suite refuses execution from CI before PostgreSQL access", () => {
  assertPreIoRefusal(
    invoke({ HEALTHPOINT_ALLOW_LOCAL_TRIGGER_TEST: "true", CI: "true" }),
    /Refusing finality trigger test from CI/,
  );
});

test("four-trigger rollback suite refuses a database other than the exact disposable target", () => {
  assertPreIoRefusal(
    invoke({ HEALTHPOINT_ALLOW_LOCAL_TRIGGER_TEST: "true", HEALTHPOINT_LOCAL_TRIGGER_TEST_DATABASE: "healthpoint_staging" }),
    /only healthpoint_migration_test is permitted/,
  );
});

test("four-trigger rollback suite refuses an absent local approval marker before PostgreSQL access", () => {
  assertPreIoRefusal(
    invoke({ HEALTHPOINT_ALLOW_LOCAL_TRIGGER_TEST: "true" }),
    /required local approval marker is absent or unreadable/,
  );
});
